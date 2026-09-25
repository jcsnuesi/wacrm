-- ============================================================
-- 053_meta_capi_attribution.sql
--
-- Foundation for Meta Conversions API. This migration only stores
-- account-scoped connection settings and immutable Click-to-WhatsApp
-- attribution. It does not send events to Meta.
-- ============================================================

BEGIN;

-- Redundant composite keys let child rows prove tenant ownership in the
-- database instead of relying only on application code or RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_id_account_id_unique'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_config
      ADD CONSTRAINT whatsapp_config_id_account_id_unique UNIQUE (id, account_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_id_account_id_unique'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_id_account_id_unique UNIQUE (id, account_id);
  END IF;

END $$;

CREATE TABLE IF NOT EXISTS public.meta_capi_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES public.whatsapp_config(id) ON DELETE SET NULL,
  business_portfolio_id TEXT,
  ad_account_id TEXT,
  waba_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  access_token_encrypted TEXT,
  graph_api_version TEXT NOT NULL DEFAULT 'v25.0',
  test_event_code TEXT,
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'testing', 'active', 'error')),
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_capi_connections_whatsapp_config_account_fk
    FOREIGN KEY (whatsapp_config_id, account_id)
    REFERENCES public.whatsapp_config(id, account_id) ON DELETE CASCADE,
  CONSTRAINT meta_capi_connections_waba_not_blank
    CHECK (length(btrim(waba_id)) > 0),
  CONSTRAINT meta_capi_connections_dataset_not_blank
    CHECK (length(btrim(dataset_id)) > 0),
  CONSTRAINT meta_capi_connections_graph_version_format
    CHECK (graph_api_version ~ '^v[0-9]+\\.[0-9]+$'),
  CONSTRAINT meta_capi_connections_account_waba_dataset_unique
    UNIQUE (account_id, waba_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_connections_account_status
  ON public.meta_capi_connections(account_id, status);

ALTER TABLE public.meta_capi_connections ENABLE ROW LEVEL SECURITY;

-- No authenticated-client policy is intentional: this row can contain an
-- encrypted token and is only accessed by service-role server routes. A
-- future settings endpoint must return an explicitly sanitized projection.

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_capi_connections;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meta_capi_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.meta_attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  whatsapp_config_id UUID NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'click_to_whatsapp'
    CHECK (source_type = 'click_to_whatsapp'),
  ctwa_clid TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  waba_id TEXT,
  source_id TEXT,
  source_url TEXT,
  referral_source_type TEXT,
  attributed_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_attributions_customer_account_fk
    FOREIGN KEY (customer_id, account_id)
    REFERENCES public.customers(id, account_id) ON DELETE CASCADE,
  CONSTRAINT meta_attributions_conversation_account_fk
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES public.conversations(id, account_id) ON DELETE CASCADE,
  CONSTRAINT meta_attributions_ctwa_clid_not_blank
    CHECK (length(btrim(ctwa_clid)) > 0),
  CONSTRAINT meta_attributions_external_message_id_not_blank
    CHECK (length(btrim(external_message_id)) > 0),
  CONSTRAINT meta_attributions_account_ctwa_unique
    UNIQUE (account_id, ctwa_clid),
  CONSTRAINT meta_attributions_account_message_unique
    UNIQUE (account_id, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_attributions_customer_time
  ON public.meta_attributions(account_id, customer_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_attributions_conversation
  ON public.meta_attributions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_meta_attributions_deal
  ON public.meta_attributions(deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE public.meta_attributions ENABLE ROW LEVEL SECURITY;

-- No authenticated-client policy is intentional. Click IDs are advertising
-- identifiers and browser clients neither need their raw value nor should be
-- able to forge or reassign it. Server routes use the service role and future
-- UI surfaces must expose an explicitly sanitized projection.

COMMIT;
