-- ============================================================
-- 052_pipeline_customer_channels.sql
--
-- Make AI pipeline routing canonical-customer based so social inbox
-- conversations can create and advance deals without a legacy contact.
-- ============================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_channel TEXT;

UPDATE public.deals AS deal
SET customer_id = contact.customer_id
FROM public.contacts AS contact
WHERE deal.contact_id = contact.id
  AND deal.customer_id IS NULL;

UPDATE public.deals AS deal
SET source_channel = COALESCE(channel_account.channel, 'whatsapp')
FROM public.conversations AS conversation
LEFT JOIN public.channel_accounts AS channel_account
  ON channel_account.id = conversation.channel_account_id
WHERE deal.conversation_id = conversation.id
  AND deal.source_channel IS NULL;

UPDATE public.deals
SET source_channel = 'whatsapp'
WHERE source_channel IS NULL;

ALTER TABLE public.ai_pipeline_routing_events
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.ai_pipeline_routing_events
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE;

UPDATE public.ai_pipeline_routing_events AS event
SET customer_id = contact.customer_id
FROM public.contacts AS contact
WHERE event.contact_id = contact.id
  AND event.customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_customer_pipeline_open
  ON public.deals(account_id, customer_id, pipeline_id)
  WHERE status = 'open' AND customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_routing_events_customer
  ON public.ai_pipeline_routing_events(account_id, customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.review_ai_pipeline_routing_event(
  p_event_id uuid,
  p_action text,
  p_deal_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.ai_pipeline_routing_events%ROWTYPE;
  cfg public.ai_pipeline_routing_configs%ROWTYPE;
  chosen public.deals%ROWTYPE;
  target_position integer;
  current_position integer;
  candidate_count integer;
  first_stage_id uuid;
  customer_name text;
  source_channel text;
  account_currency text;
  caller_is_service boolean := auth.role() = 'service_role';
BEGIN
  SELECT * INTO e FROM public.ai_pipeline_routing_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'routing event not found'; END IF;
  IF NOT caller_is_service AND NOT is_account_member(e.account_id, 'agent') THEN
    RAISE EXCEPTION 'insufficient role';
  END IF;

  IF p_action = 'dismiss' THEN
    IF e.status NOT IN ('suggested', 'ambiguous_deal', 'blocked_regression') THEN
      RAISE EXCEPTION 'event cannot be dismissed from status %', e.status;
    END IF;
    UPDATE public.ai_pipeline_routing_events
      SET status = 'dismissed',
          reviewed_by = CASE WHEN caller_is_service THEN NULL ELSE auth.uid() END,
          reviewed_at = now()
      WHERE id = e.id;
    RETURN jsonb_build_object('status', 'dismissed');
  END IF;

  IF p_action = 'undo' THEN
    IF caller_is_service OR e.status <> 'applied' OR e.deal_id IS NULL OR e.previous_stage_id IS NULL THEN
      RAISE EXCEPTION 'event cannot be undone';
    END IF;
    SELECT * INTO chosen FROM public.deals
      WHERE id = e.deal_id AND account_id = e.account_id FOR UPDATE;
    IF NOT FOUND OR chosen.stage_id IS DISTINCT FROM e.applied_stage_id THEN
      RAISE EXCEPTION 'deal changed after routing event; undo is unsafe';
    END IF;
    UPDATE public.deals
      SET stage_id = e.previous_stage_id,
          status = COALESCE(e.previous_deal_status, status),
          updated_at = now()
      WHERE id = chosen.id;
    UPDATE public.ai_pipeline_routing_events
      SET status = 'undone', reviewed_by = auth.uid(), reviewed_at = now()
      WHERE id = e.id;
    RETURN jsonb_build_object('status', 'undone', 'deal_id', e.deal_id, 'stage_id', e.previous_stage_id);
  END IF;

  IF p_action <> 'apply' OR e.proposed_stage_id IS NULL OR e.customer_id IS NULL THEN
    RAISE EXCEPTION 'invalid routing event';
  END IF;
  IF e.status NOT IN ('suggested', 'ambiguous_deal', 'blocked_regression') THEN
    RAISE EXCEPTION 'event cannot be applied from status %', e.status;
  END IF;

  SELECT * INTO cfg FROM public.ai_pipeline_routing_configs WHERE id = e.config_id;
  IF NOT FOUND OR cfg.account_id <> e.account_id OR cfg.pipeline_id <> e.pipeline_id THEN
    RAISE EXCEPTION 'routing config tenant mismatch';
  END IF;
  SELECT position INTO target_position FROM public.pipeline_stages
    WHERE id = e.proposed_stage_id AND pipeline_id = e.pipeline_id;
  IF target_position IS NULL THEN RAISE EXCEPTION 'target stage not in pipeline'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.messages AS message
    JOIN public.conversations AS conversation ON conversation.id = message.conversation_id
    WHERE message.id = e.source_message_id
      AND message.conversation_id = e.conversation_id
      AND conversation.account_id = e.account_id
      AND conversation.customer_id = e.customer_id
  ) THEN
    RAISE EXCEPTION 'routing event source does not belong to canonical customer';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    e.account_id::text || ':' || e.customer_id::text || ':' || e.pipeline_id::text, 0
  ));

  IF p_deal_id IS NOT NULL THEN
    SELECT * INTO chosen FROM public.deals
      WHERE id = p_deal_id AND account_id = e.account_id AND pipeline_id = e.pipeline_id
        AND customer_id = e.customer_id AND status = 'open'
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'selected deal is not eligible'; END IF;
  ELSE
    SELECT count(*) INTO candidate_count FROM public.deals
      WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
        AND customer_id = e.customer_id AND conversation_id = e.conversation_id
        AND status = 'open';
    IF candidate_count > 1 THEN
      UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
      RETURN jsonb_build_object('status', 'ambiguous_deal');
    ELSIF candidate_count = 1 THEN
      SELECT * INTO chosen FROM public.deals
        WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
          AND customer_id = e.customer_id AND conversation_id = e.conversation_id
          AND status = 'open'
        LIMIT 1 FOR UPDATE;
    ELSE
      SELECT count(*) INTO candidate_count FROM public.deals
        WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
          AND customer_id = e.customer_id AND status = 'open';
      IF candidate_count = 1 THEN
        SELECT * INTO chosen FROM public.deals
          WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
            AND customer_id = e.customer_id AND status = 'open'
          LIMIT 1 FOR UPDATE;
        IF chosen.conversation_id IS NULL THEN
          UPDATE public.deals SET conversation_id = e.conversation_id, updated_at = now()
            WHERE id = chosen.id;
        ELSE
          UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
          RETURN jsonb_build_object('status', 'ambiguous_deal');
        END IF;
      ELSIF candidate_count > 1 OR NOT cfg.create_deals THEN
        UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
        RETURN jsonb_build_object('status', 'ambiguous_deal');
      ELSE
        SELECT id INTO first_stage_id FROM public.pipeline_stages
          WHERE pipeline_id = e.pipeline_id ORDER BY position, created_at LIMIT 1;
        SELECT display_name INTO customer_name FROM public.customers
          WHERE id = e.customer_id AND account_id = e.account_id;
        SELECT COALESCE(channel_account.channel, 'whatsapp') INTO source_channel
          FROM public.conversations AS conversation
          LEFT JOIN public.channel_accounts AS channel_account
            ON channel_account.id = conversation.channel_account_id
          WHERE conversation.id = e.conversation_id;
        SELECT default_currency INTO account_currency FROM public.accounts WHERE id = e.account_id;
        INSERT INTO public.deals (
          account_id, user_id, pipeline_id, stage_id, contact_id, customer_id,
          conversation_id, title, value, currency, status, source_channel
        ) VALUES (
          e.account_id,
          COALESCE(cfg.created_by, (SELECT user_id FROM public.conversations WHERE id = e.conversation_id)),
          e.pipeline_id, first_stage_id, e.contact_id, e.customer_id,
          e.conversation_id,
          initcap(COALESCE(source_channel, 'whatsapp')) || ' - ' || COALESCE(customer_name, 'Customer'),
          0, COALESCE(account_currency, 'USD'), 'open', lower(COALESCE(source_channel, 'whatsapp'))
        ) RETURNING * INTO chosen;
      END IF;
    END IF;
  END IF;

  SELECT position INTO current_position FROM public.pipeline_stages
    WHERE id = chosen.stage_id AND pipeline_id = e.pipeline_id;
  IF target_position = current_position AND e.intent <> 'not_interested' THEN
    UPDATE public.ai_pipeline_routing_events
      SET deal_id = chosen.id, previous_stage_id = chosen.stage_id,
          previous_deal_status = chosen.status, applied_stage_id = chosen.stage_id,
          status = 'no_change'
      WHERE id = e.id;
    RETURN jsonb_build_object('status', 'no_change', 'deal_id', chosen.id, 'stage_id', chosen.stage_id);
  END IF;
  IF caller_is_service AND cfg.forward_only AND target_position < current_position THEN
    UPDATE public.ai_pipeline_routing_events
      SET deal_id = chosen.id, previous_stage_id = chosen.stage_id,
          previous_deal_status = chosen.status, status = 'blocked_regression'
      WHERE id = e.id;
    RETURN jsonb_build_object('status', 'blocked_regression', 'deal_id', chosen.id);
  END IF;

  UPDATE public.ai_pipeline_routing_events
    SET deal_id = chosen.id, previous_stage_id = chosen.stage_id,
        previous_deal_status = chosen.status
    WHERE id = e.id;
  UPDATE public.deals
    SET stage_id = e.proposed_stage_id,
        status = CASE WHEN e.intent = 'not_interested' THEN 'lost' ELSE status END,
        updated_at = now()
    WHERE id = chosen.id AND account_id = e.account_id;
  UPDATE public.ai_pipeline_routing_events
    SET applied_stage_id = e.proposed_stage_id, status = 'applied',
        reviewed_by = CASE WHEN caller_is_service THEN NULL ELSE auth.uid() END,
        reviewed_at = CASE WHEN caller_is_service THEN NULL ELSE now() END
    WHERE id = e.id;
  RETURN jsonb_build_object('status', 'applied', 'deal_id', chosen.id, 'stage_id', e.proposed_stage_id);
END;
$$;
