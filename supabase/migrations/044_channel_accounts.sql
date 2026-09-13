-- ============================================================
-- 044_channel_accounts.sql
--
-- Account-scoped connected-channel inventory. This is additive: the
-- existing whatsapp_config table remains the active WhatsApp runtime
-- configuration until its adapter is migrated in a later phase.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT,
  username TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('connected', 'disconnected', 'expired', 'error', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_accounts_external_id_not_blank CHECK (length(btrim(external_account_id)) > 0),
  CONSTRAINT channel_accounts_account_channel_external_unique
    UNIQUE (account_id, channel, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_account_channel
  ON channel_accounts (account_id, channel, status);

ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_accounts_select ON channel_accounts;
DROP POLICY IF EXISTS channel_accounts_modify ON channel_accounts;
CREATE POLICY channel_accounts_select ON channel_accounts FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY channel_accounts_modify ON channel_accounts FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON channel_accounts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON channel_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Existing encrypted WhatsApp tokens are copied as-is; this migration never
-- decrypts credentials. The legacy whatsapp_config row stays authoritative
-- for sends/webhooks during the incremental adapter transition.
INSERT INTO channel_accounts (
  account_id, channel, provider, external_account_id, display_name,
  access_token_encrypted, metadata, status, created_at, updated_at
)
SELECT
  account_id,
  'whatsapp',
  provider,
  COALESCE(NULLIF(phone_number_id, ''), NULLIF(sender_phone, '')),
  COALESCE(NULLIF(sender_phone, ''), NULLIF(phone_number_id, '')),
  access_token,
  jsonb_build_object(
    'whatsapp_config_id', id,
    'waba_id', waba_id,
    'legacy_provider', provider,
    'backfilled', true
  ),
  CASE WHEN status = 'connected' THEN 'connected' ELSE 'disconnected' END,
  created_at,
  updated_at
FROM whatsapp_config
WHERE COALESCE(NULLIF(phone_number_id, ''), NULLIF(sender_phone, '')) IS NOT NULL
ON CONFLICT (account_id, channel, external_account_id) DO NOTHING;
