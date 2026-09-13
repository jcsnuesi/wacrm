-- ============================================================
-- 049_social_channel_runtime.sql
--
-- Let provider-native customers exist without manufacturing a legacy
-- WhatsApp contact. The old columns remain available for WhatsApp and all
-- existing records; they are simply no longer required for new channels.
-- ============================================================

ALTER TABLE contact_identities ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN user_id DROP NOT NULL;

-- An external identity belongs to a connected channel account, not merely a
-- provider type. One person can message two Instagram business accounts.
ALTER TABLE contact_identities
  DROP CONSTRAINT IF EXISTS contact_identities_account_channel_external_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_identities_account_channel_account_external_unique
  ON contact_identities(account_id, channel, channel_account_id, external_id)
  WHERE channel_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_identities_legacy_channel_external_unique
  ON contact_identities(account_id, channel, external_id)
  WHERE channel_account_id IS NULL;

-- Meta retries events. The canonical inbound pipeline is idempotent per
-- conversation and external message id, while legacy WhatsApp continues to
-- use its current persistence path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_external_message_unique
  ON messages(conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_channel_external_unique
  ON conversations(channel_account_id, external_conversation_id)
  WHERE channel_account_id IS NOT NULL
    AND external_conversation_id IS NOT NULL;
