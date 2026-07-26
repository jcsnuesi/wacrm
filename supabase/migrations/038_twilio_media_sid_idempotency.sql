-- Twilio uses SM... for ordinary messages and MM... for some inbound media
-- records. Both identify one webhook event and must be idempotent under
-- concurrent retries.
DROP INDEX IF EXISTS idx_messages_twilio_sid_unique;

CREATE UNIQUE INDEX idx_messages_twilio_sid_unique
  ON messages (message_id)
  WHERE message_id ~ '^M[SM][0-9A-Fa-f]{32}$';
