-- A workspace can have one active Instagram and one active Facebook inbox.
-- Disconnected rows remain as historical records, but must not route webhooks.

BEGIN;

WITH ranked_connections AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id, channel
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS connection_rank
  FROM channel_accounts
  WHERE channel IN ('instagram', 'facebook')
    AND status = 'connected'
)
UPDATE channel_accounts AS channel_account
SET
  status = 'disconnected',
  access_token_encrypted = NULL,
  refresh_token_encrypted = NULL,
  token_expires_at = NULL
FROM ranked_connections
WHERE channel_account.id = ranked_connections.id
  AND ranked_connections.connection_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_one_active_social_connection
  ON channel_accounts (account_id, channel)
  WHERE channel IN ('instagram', 'facebook')
    AND status = 'connected';

COMMIT;
