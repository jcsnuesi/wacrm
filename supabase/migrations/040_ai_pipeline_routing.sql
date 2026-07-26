-- ============================================================
-- 040_ai_pipeline_routing.sql — AI intent → deal-stage routing
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_pipeline_routing_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  pipeline_id        uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_enabled         boolean NOT NULL DEFAULT true,
  auto_threshold     numeric(4,3) NOT NULL DEFAULT 0.900 CHECK (auto_threshold BETWEEN 0 AND 1),
  suggest_threshold  numeric(4,3) NOT NULL DEFAULT 0.650 CHECK (suggest_threshold BETWEEN 0 AND 1),
  create_deals       boolean NOT NULL DEFAULT true,
  forward_only       boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (suggest_threshold <= auto_threshold)
);

CREATE TABLE IF NOT EXISTS public.ai_pipeline_stage_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id    uuid NOT NULL REFERENCES public.ai_pipeline_routing_configs(id) ON DELETE CASCADE,
  stage_id     uuid NOT NULL UNIQUE REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  intent       text NOT NULL CHECK (intent IN (
    'new_customer', 'potential_customer', 'pending_evaluation',
    'evaluation', 'installation', 'maintenance', 'not_interested'
  )),
  description  text NOT NULL,
  examples     text[] NOT NULL DEFAULT '{}',
  is_enabled   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, intent)
);

CREATE TABLE IF NOT EXISTS public.ai_pipeline_routing_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  config_id             uuid NOT NULL REFERENCES public.ai_pipeline_routing_configs(id) ON DELETE CASCADE,
  source_message_id     uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id               uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  pipeline_id           uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  previous_stage_id     uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  previous_deal_status  text,
  proposed_stage_id     uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  applied_stage_id      uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  intent                text NOT NULL CHECK (intent IN (
    'new_customer', 'potential_customer', 'pending_evaluation',
    'evaluation', 'installation', 'maintenance', 'not_interested', 'unknown'
  )),
  confidence            numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rationale             text NOT NULL DEFAULT '',
  evidence_message_ids  uuid[] NOT NULL DEFAULT '{}',
  model                 text NOT NULL,
  status                text NOT NULL CHECK (status IN (
    'low_confidence', 'suggested', 'applied', 'ambiguous_deal',
    'blocked_regression', 'no_change', 'dismissed', 'undone', 'error'
  )),
  error_message         text,
  reviewed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_pipeline_routing_events_account_created
  ON public.ai_pipeline_routing_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_routing_events_conversation_created
  ON public.ai_pipeline_routing_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_routing_events_pending
  ON public.ai_pipeline_routing_events(account_id, status, created_at DESC)
  WHERE status IN ('suggested', 'ambiguous_deal', 'blocked_regression');

ALTER TABLE public.ai_pipeline_routing_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pipeline_stage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pipeline_routing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_pipeline_routing_configs_select ON public.ai_pipeline_routing_configs;
CREATE POLICY ai_pipeline_routing_configs_select ON public.ai_pipeline_routing_configs
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS ai_pipeline_routing_configs_modify ON public.ai_pipeline_routing_configs;
CREATE POLICY ai_pipeline_routing_configs_modify ON public.ai_pipeline_routing_configs
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_pipeline_stage_rules_select ON public.ai_pipeline_stage_rules;
CREATE POLICY ai_pipeline_stage_rules_select ON public.ai_pipeline_stage_rules
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.ai_pipeline_routing_configs c
    WHERE c.id = ai_pipeline_stage_rules.config_id AND is_account_member(c.account_id)
  ));
DROP POLICY IF EXISTS ai_pipeline_stage_rules_modify ON public.ai_pipeline_stage_rules;
CREATE POLICY ai_pipeline_stage_rules_modify ON public.ai_pipeline_stage_rules
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.ai_pipeline_routing_configs c
    WHERE c.id = ai_pipeline_stage_rules.config_id AND is_account_member(c.account_id, 'admin')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.ai_pipeline_routing_configs c
    WHERE c.id = ai_pipeline_stage_rules.config_id AND is_account_member(c.account_id, 'admin')
  ));

DROP POLICY IF EXISTS ai_pipeline_routing_events_select ON public.ai_pipeline_routing_events;
CREATE POLICY ai_pipeline_routing_events_select ON public.ai_pipeline_routing_events
  FOR SELECT USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.touch_ai_pipeline_routing_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_pipeline_routing_configs_updated ON public.ai_pipeline_routing_configs;
CREATE TRIGGER trg_ai_pipeline_routing_configs_updated
  BEFORE UPDATE ON public.ai_pipeline_routing_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_pipeline_routing_updated_at();
DROP TRIGGER IF EXISTS trg_ai_pipeline_stage_rules_updated ON public.ai_pipeline_stage_rules;
CREATE TRIGGER trg_ai_pipeline_stage_rules_updated
  BEFORE UPDATE ON public.ai_pipeline_stage_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_pipeline_routing_updated_at();
DROP TRIGGER IF EXISTS trg_ai_pipeline_routing_events_updated ON public.ai_pipeline_routing_events;
CREATE TRIGGER trg_ai_pipeline_routing_events_updated
  BEFORE UPDATE ON public.ai_pipeline_routing_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_pipeline_routing_updated_at();

-- Atomically resolves/creates the deal and applies, dismisses, or undoes a
-- routing event. SECURITY DEFINER is bounded by explicit membership and
-- account/pipeline checks because the webhook calls it as service_role.
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
  contact_name text;
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
      SET status = 'dismissed', reviewed_by = CASE WHEN caller_is_service THEN NULL ELSE auth.uid() END,
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
    UPDATE public.deals SET stage_id = e.previous_stage_id,
      status = COALESCE(e.previous_deal_status, status), updated_at = now()
      WHERE id = e.deal_id AND account_id = e.account_id;
    UPDATE public.ai_pipeline_routing_events SET status = 'undone', reviewed_by = auth.uid(), reviewed_at = now()
      WHERE id = e.id;
    RETURN jsonb_build_object('status', 'undone', 'deal_id', e.deal_id, 'stage_id', e.previous_stage_id);
  END IF;

  IF p_action <> 'apply' OR e.proposed_stage_id IS NULL THEN
    RAISE EXCEPTION 'invalid routing action';
  END IF;
  IF e.status NOT IN ('suggested', 'ambiguous_deal', 'blocked_regression') THEN
    RAISE EXCEPTION 'event cannot be applied from status %', e.status;
  END IF;
  SELECT * INTO cfg FROM public.ai_pipeline_routing_configs WHERE id = e.config_id;
  IF cfg.account_id <> e.account_id OR cfg.pipeline_id <> e.pipeline_id THEN
    RAISE EXCEPTION 'routing config tenant mismatch';
  END IF;
  SELECT position INTO target_position FROM public.pipeline_stages
    WHERE id = e.proposed_stage_id AND pipeline_id = e.pipeline_id;
  IF target_position IS NULL THEN RAISE EXCEPTION 'target stage not in pipeline'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations cv ON cv.id = m.conversation_id
    WHERE m.id = e.source_message_id
      AND m.conversation_id = e.conversation_id
      AND cv.account_id = e.account_id
      AND cv.contact_id = e.contact_id
  ) THEN
    RAISE EXCEPTION 'routing event source does not belong to account conversation';
  END IF;

  -- Serialize deal resolution for this account/contact/pipeline tuple. Without
  -- this lock, two different inbound messages arriving together could both
  -- observe no open deal and each create one.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    e.account_id::text || ':' || e.contact_id::text || ':' || e.pipeline_id::text,
    0
  ));

  IF p_deal_id IS NOT NULL THEN
    SELECT * INTO chosen FROM public.deals
      WHERE id = p_deal_id AND account_id = e.account_id AND pipeline_id = e.pipeline_id
        AND contact_id = e.contact_id AND status = 'open' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'selected deal is not eligible'; END IF;
  ELSE
    SELECT count(*) INTO candidate_count FROM public.deals
      WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
        AND contact_id = e.contact_id AND conversation_id = e.conversation_id
        AND status = 'open';

    IF candidate_count > 1 THEN
      UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
      RETURN jsonb_build_object('status', 'ambiguous_deal');
    ELSIF candidate_count = 1 THEN
      SELECT * INTO chosen FROM public.deals
        WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
          AND contact_id = e.contact_id AND conversation_id = e.conversation_id
          AND status = 'open'
        LIMIT 1 FOR UPDATE;
    END IF;

    IF candidate_count = 0 THEN
      SELECT count(*) INTO candidate_count FROM public.deals
        WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
          AND contact_id = e.contact_id AND status = 'open';
      IF candidate_count = 1 THEN
        SELECT * INTO chosen FROM public.deals
          WHERE account_id = e.account_id AND pipeline_id = e.pipeline_id
            AND contact_id = e.contact_id AND status = 'open'
          LIMIT 1 FOR UPDATE;
        IF chosen.conversation_id IS NULL THEN
          UPDATE public.deals SET conversation_id = e.conversation_id, updated_at = now() WHERE id = chosen.id;
        ELSE
          UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
          RETURN jsonb_build_object('status', 'ambiguous_deal');
        END IF;
      ELSIF candidate_count > 1 THEN
        UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
        RETURN jsonb_build_object('status', 'ambiguous_deal');
      ELSIF cfg.create_deals THEN
        SELECT id INTO first_stage_id FROM public.pipeline_stages
          WHERE pipeline_id = e.pipeline_id ORDER BY position, created_at LIMIT 1;
        SELECT name INTO contact_name FROM public.contacts
          WHERE id = e.contact_id AND account_id = e.account_id;
        SELECT default_currency INTO account_currency FROM public.accounts WHERE id = e.account_id;
        INSERT INTO public.deals (
          account_id, user_id, pipeline_id, stage_id, contact_id, conversation_id,
          title, value, currency, status
        ) VALUES (
          e.account_id, COALESCE((SELECT created_by FROM public.ai_pipeline_routing_configs WHERE id = e.config_id),
            (SELECT user_id FROM public.conversations WHERE id = e.conversation_id)),
          e.pipeline_id, first_stage_id, e.contact_id, e.conversation_id,
          'WhatsApp - ' || COALESCE(contact_name, 'Contact'), 0,
          COALESCE(account_currency, 'USD'), 'open'
        ) RETURNING * INTO chosen;
      ELSE
        UPDATE public.ai_pipeline_routing_events SET status = 'ambiguous_deal' WHERE id = e.id;
        RETURN jsonb_build_object('status', 'ambiguous_deal');
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

REVOKE ALL ON FUNCTION public.review_ai_pipeline_routing_event(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_ai_pipeline_routing_event(uuid, text, uuid)
  TO authenticated, service_role;

ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'intent_routing'));

-- Initial editable configuration for the requested Stage pipeline. These
-- definitions are data, not classifier code; admins can edit them later.
INSERT INTO public.ai_pipeline_routing_configs (
  account_id, pipeline_id, created_by, is_enabled, auto_threshold,
  suggest_threshold, create_deals, forward_only
)
SELECT p.account_id, p.id, p.user_id, true, 0.900, 0.650, true, true
FROM public.pipelines p
WHERE lower(trim(p.name)) = lower('Prótesis Capillar')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO public.ai_pipeline_stage_rules (config_id, stage_id, intent, description, examples)
SELECT c.id, s.id, x.intent, x.description, x.examples
FROM public.ai_pipeline_routing_configs c
JOIN public.pipeline_stages s ON s.pipeline_id = c.pipeline_id
JOIN (VALUES
  ('nuevo cliente', 'new_customer', 'Saludo o primer contacto sin una señal comercial clara.', ARRAY['hola','buenas']::text[]),
  ('cliente potencial', 'potential_customer', 'Pregunta por precio, duración, resultados o muestra interés.', ARRAY['cuánto cuesta','quiero información']::text[]),
  ('pendiente evaluación', 'pending_evaluation', 'Solicita evaluación, comparte fotos o propone disponibilidad.', ARRAY['quiero una evaluación','puedo ir mañana']::text[]),
  ('evaluación', 'evaluation', 'La evaluación fue confirmada, está en curso o se completó.', ARRAY['confirmamos tu evaluación','ya me evaluaron']::text[]),
  ('instalación', 'installation', 'Decidió instalar, confirmó depósito/pago o acordó instalación.', ARRAY['quiero instalarla','ya hice el depósito']::text[]),
  ('mantenimiento', 'maintenance', 'Cliente existente solicita mantenimiento, ajuste o reporta desprendimiento.', ARRAY['necesito mantenimiento','se está despegando']::text[]),
  ('no interesado', 'not_interested', 'Rechazo o cancelación explícita; no incluye frases ambiguas como lo voy a pensar.', ARRAY['no me interesa','quiero cancelar']::text[])
) AS x(stage_name, intent, description, examples)
  ON lower(trim(s.name)) = x.stage_name
ON CONFLICT (stage_id) DO NOTHING;
