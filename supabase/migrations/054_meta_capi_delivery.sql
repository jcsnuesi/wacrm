-- Durable CRM -> Meta CAPI delivery. Deal changes are captured in the
-- database so events are not lost when they originate outside the UI.
BEGIN;

CREATE TABLE public.meta_capi_stage_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  deal_status TEXT,
  event_name TEXT NOT NULL,
  include_value BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_capi_mapping_target CHECK (
    (stage_id IS NOT NULL AND deal_status IS NULL) OR
    (stage_id IS NULL AND deal_status IS NOT NULL)
  ),
  CONSTRAINT meta_capi_mapping_event_not_blank CHECK (length(btrim(event_name)) > 0)
);
CREATE UNIQUE INDEX meta_capi_mapping_stage_unique
  ON public.meta_capi_stage_mappings(account_id, stage_id)
  WHERE stage_id IS NOT NULL;
CREATE UNIQUE INDEX meta_capi_mapping_status_unique
  ON public.meta_capi_stage_mappings(account_id, deal_status)
  WHERE deal_status IS NOT NULL;
ALTER TABLE public.meta_capi_stage_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account members can read CAPI mappings"
  ON public.meta_capi_stage_mappings FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY "Admins can manage CAPI mappings"
  ON public.meta_capi_stage_mappings FOR ALL
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP TRIGGER IF EXISTS set_updated_at ON public.meta_capi_stage_mappings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_capi_stage_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.deal_stage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  previous_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  new_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  previous_status TEXT,
  new_status TEXT,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_stage_events_deal_time
  ON public.deal_stage_events(account_id, deal_id, occurred_at DESC);
ALTER TABLE public.deal_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account members can read deal history"
  ON public.deal_stage_events FOR SELECT
  USING (public.is_account_member(account_id));

CREATE TABLE public.meta_capi_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_key TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.meta_capi_connections(id) ON DELETE CASCADE,
  attribution_id UUID NOT NULL REFERENCES public.meta_attributions(id) ON DELETE CASCADE,
  deal_stage_event_id UUID NOT NULL REFERENCES public.deal_stage_events(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_meta_capi_outbox_due
  ON public.meta_capi_outbox(status, next_attempt_at)
  WHERE status IN ('pending', 'retry');
ALTER TABLE public.meta_capi_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account members can read CAPI delivery status"
  ON public.meta_capi_outbox FOR SELECT
  USING (public.is_account_member(account_id));
DROP TRIGGER IF EXISTS set_updated_at ON public.meta_capi_outbox;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_capi_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.capture_deal_capi_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  history_id UUID;
  attr public.meta_attributions%ROWTYPE;
  conn public.meta_capi_connections%ROWTYPE;
  mapping public.meta_capi_stage_mappings%ROWTYPE;
  unix_time BIGINT := floor(extract(epoch from NOW()));
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.deal_stage_events (
    account_id, deal_id, customer_id, previous_stage_id, new_stage_id,
    previous_status, new_status, value, currency
  ) VALUES (
    NEW.account_id, NEW.id, NEW.customer_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
    NEW.stage_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status, COALESCE(NEW.value, 0), COALESCE(NEW.currency, 'USD')
  ) RETURNING id INTO history_id;

  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO attr FROM public.meta_attributions
   WHERE account_id = NEW.account_id AND customer_id = NEW.customer_id
   ORDER BY attributed_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO conn FROM public.meta_capi_connections
   WHERE account_id = NEW.account_id
     AND status IN ('testing', 'active')
     AND waba_id = attr.waba_id
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- A status rule has priority, preventing a Won-stage + won-status update
  -- from producing two Purchase events.
  SELECT * INTO mapping FROM public.meta_capi_stage_mappings
   WHERE account_id = NEW.account_id AND is_enabled
     AND deal_status = NEW.status
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO mapping FROM public.meta_capi_stage_mappings
     WHERE account_id = NEW.account_id AND is_enabled
       AND stage_id = NEW.stage_id
       AND (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id)
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN NEW; END IF;

  event_payload := jsonb_build_object(
    'data', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'event_name', mapping.event_name,
      'event_time', unix_time,
      'event_id', history_id::text || ':' || mapping.id::text,
      'action_source', 'business_messaging',
      'messaging_channel', 'whatsapp',
      'user_data', jsonb_build_object(
        'whatsapp_business_account_id', conn.waba_id,
        'ctwa_clid', attr.ctwa_clid
      ),
      'custom_data', CASE WHEN mapping.include_value THEN jsonb_build_object(
        'currency', upper(COALESCE(NEW.currency, 'USD')),
        'value', COALESCE(NEW.value, 0)
      ) ELSE NULL END
    )))
  );

  INSERT INTO public.meta_capi_outbox (
    event_key, account_id, connection_id, attribution_id,
    deal_stage_event_id, event_name, payload
  ) VALUES (
    history_id::text || ':' || mapping.id::text, NEW.account_id, conn.id,
    attr.id, history_id, mapping.event_name, event_payload
  ) ON CONFLICT (event_key) DO NOTHING;

  UPDATE public.meta_attributions SET deal_id = NEW.id
   WHERE id = attr.id AND deal_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_capture_capi_event ON public.deals;
CREATE TRIGGER deals_capture_capi_event
  AFTER INSERT OR UPDATE OF stage_id, status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.capture_deal_capi_event();

-- Safe defaults: lead creation and closed-won revenue. They remain inert until
-- a connection is explicitly switched to testing or active.
INSERT INTO public.meta_capi_stage_mappings
  (account_id, pipeline_id, stage_id, event_name, include_value)
SELECT p.account_id, s.pipeline_id, s.id, 'LeadSubmitted', FALSE
FROM public.pipeline_stages s JOIN public.pipelines p ON p.id = s.pipeline_id
WHERE s.position = (SELECT min(s2.position) FROM public.pipeline_stages s2 WHERE s2.pipeline_id = s.pipeline_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.meta_capi_stage_mappings
  (account_id, deal_status, event_name, include_value)
SELECT id, 'won', 'Purchase', TRUE FROM public.accounts
ON CONFLICT DO NOTHING;

COMMIT;
