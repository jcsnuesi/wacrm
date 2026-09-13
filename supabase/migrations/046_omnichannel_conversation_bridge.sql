-- ============================================================
-- 046_omnichannel_conversation_bridge.sql
--
-- Add canonical Customer/Channel references to the active inbox tables.
-- Legacy contact_id and whatsapp_config_id remain authoritative for the
-- current WhatsApp paths until provider adapters are moved incrementally.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS customer_identity_id UUID REFERENCES contact_identities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS external_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

UPDATE conversations conversation
SET customer_id = contact.customer_id,
    started_at = COALESCE(conversation.started_at, conversation.created_at)
FROM contacts contact
WHERE contact.id = conversation.contact_id
  AND conversation.customer_id IS NULL;

-- Existing configurations are represented in 044 metadata. The lookup is
-- exact and only fills rows that can be mapped without guessing.
UPDATE conversations conversation
SET channel_account_id = channel_account.id
FROM channel_accounts channel_account
WHERE channel_account.account_id = conversation.account_id
  AND channel_account.channel = 'whatsapp'
  AND channel_account.metadata->>'whatsapp_config_id' = conversation.whatsapp_config_id::text
  AND conversation.channel_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel_account ON conversations(channel_account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_external_id
  ON conversations(channel_account_id, external_conversation_id)
  WHERE external_conversation_id IS NOT NULL;

-- Keep current WhatsApp inserts canonical without changing its routes.
CREATE OR REPLACE FUNCTION set_customer_for_legacy_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT customer_id INTO NEW.customer_id
    FROM contacts
    WHERE id = NEW.contact_id AND account_id = NEW.account_id;
  END IF;

  IF NEW.channel_account_id IS NULL AND NEW.whatsapp_config_id IS NOT NULL THEN
    SELECT id INTO NEW.channel_account_id
    FROM channel_accounts
    WHERE account_id = NEW.account_id
      AND channel = 'whatsapp'
      AND metadata->>'whatsapp_config_id' = NEW.whatsapp_config_id::text
    LIMIT 1;
  END IF;

  NEW.started_at := COALESCE(NEW.started_at, NEW.created_at, NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_customer_for_legacy_conversation ON conversations;
CREATE TRIGGER ensure_customer_for_legacy_conversation
  BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_customer_for_legacy_conversation();

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS external_message_id TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  ADD COLUMN IF NOT EXISTS sender_identity_id UUID REFERENCES contact_identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

UPDATE messages
SET external_message_id = message_id,
    direction = CASE WHEN sender_type = 'customer' THEN 'INBOUND' ELSE 'OUTBOUND' END,
    sent_at = COALESCE(sent_at, created_at)
WHERE external_message_id IS NULL OR direction IS NULL OR sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_external_message_id
  ON messages(external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_external_message
  ON messages(conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
