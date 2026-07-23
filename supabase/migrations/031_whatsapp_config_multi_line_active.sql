-- ============================================================
-- whatsapp_config: allow multiple WhatsApp lines per account
-- while keeping exactly one active line for runtime sends.
--
-- Why:
-- - Existing model enforced UNIQUE(account_id), so saving a new line
--   overwrote the previous one.
-- - Product now needs multiple saved lines + explicit active switch.
--
-- This migration:
-- 1) drops UNIQUE(account_id)
-- 2) adds is_active boolean
-- 3) enforces at most one active row per account via partial unique index
-- 4) backfills one active row per account
-- ============================================================

-- 1) Remove single-row-per-account constraint.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- 2) Add active marker.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Ensure one active row per account (at most one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_active_per_account
  ON whatsapp_config(account_id)
  WHERE is_active = true;

-- 4) Backfill: if an account has no active row, mark its most recently
-- updated row active.
WITH ranked AS (
  SELECT
    id,
    account_id,
    row_number() OVER (
      PARTITION BY account_id
      ORDER BY
        COALESCE(updated_at, created_at) DESC,
        created_at DESC,
        id DESC
    ) AS rn,
    max(CASE WHEN is_active THEN 1 ELSE 0 END) OVER (
      PARTITION BY account_id
    ) AS has_active
  FROM whatsapp_config
)
UPDATE whatsapp_config wc
SET is_active = true
FROM ranked r
WHERE wc.id = r.id
  AND r.has_active = 0
  AND r.rn = 1;

-- 5) Helpful index for account-scoped list UI.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_account_updated
  ON whatsapp_config(account_id, updated_at DESC);
