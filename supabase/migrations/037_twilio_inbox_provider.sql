-- Native Twilio provider support for the shared WhatsApp inbox.
-- Legacy rows remain Meta rows; conversations become line-scoped.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS sender_phone TEXT;

ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check
      CHECK (provider IN ('meta', 'twilio'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_fields_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_fields_check
      CHECK (
        (provider = 'meta' AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
        OR
        (provider = 'twilio' AND sender_phone ~ '^\+[1-9][0-9]{7,14}$')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_twilio_sender
  ON whatsapp_config (sender_phone)
  WHERE provider = 'twilio' AND sender_phone IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_whatsapp_config_id_fkey'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_whatsapp_config_id_fkey
      FOREIGN KEY (whatsapp_config_id) REFERENCES whatsapp_config(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Existing conversations predate provider-aware routing. Attach each one to
-- the active line, falling back to the most recently updated saved line.
UPDATE conversations c
SET whatsapp_config_id = (
  SELECT wc.id
  FROM whatsapp_config wc
  WHERE wc.account_id = c.account_id
  ORDER BY wc.is_active DESC, wc.updated_at DESC NULLS LAST, wc.created_at DESC
  LIMIT 1
)
WHERE c.whatsapp_config_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_line
  ON conversations (account_id, contact_id, whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- Provider-generated content used for in-session quick replies/list pickers.
CREATE TABLE IF NOT EXISTS twilio_content_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  content_sid TEXT NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('buttons', 'list')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, payload_hash)
);

ALTER TABLE twilio_content_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS twilio_content_cache_select ON twilio_content_cache;
DROP POLICY IF EXISTS twilio_content_cache_insert ON twilio_content_cache;
CREATE POLICY twilio_content_cache_select ON twilio_content_cache FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY twilio_content_cache_insert ON twilio_content_cache FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Twilio media URLs require server credentials and must never be exposed to
-- the browser. media_url stores the authenticated local proxy path instead.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider_media_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_error TEXT;

-- Twilio Message SIDs are unique within the configured project. This closes
-- the concurrent webhook retry race without changing Meta's intentionally
-- non-unique message_id semantics across phone-number IDs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_twilio_sid_unique
  ON messages (message_id)
  WHERE message_id ~ '^SM[0-9A-Fa-f]{32}$';
