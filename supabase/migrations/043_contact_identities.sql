-- ============================================================
-- 043_contact_identities.sql
--
-- Add provider-neutral, account-scoped contact identities without
-- replacing the existing WhatsApp contact columns. Legacy fields remain
-- the active WhatsApp compatibility path while all current identities are
-- backfilled into this table for later channel adapters.
-- ============================================================

-- PostgreSQL requires the referenced composite key to be unique. This is a
-- redundant compatibility constraint alongside contacts.id's primary key,
-- but it lets the identity row enforce same-account ownership at the DB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_id_account_id_unique'
      AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_id_account_id_unique UNIQUE (id, account_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contact_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  external_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_identities_external_id_not_blank CHECK (length(btrim(external_id)) > 0),
  CONSTRAINT contact_identities_contact_account_unique UNIQUE (id, account_id),
  CONSTRAINT contact_identities_account_channel_external_unique UNIQUE (account_id, channel, external_id),
  CONSTRAINT contact_identities_contact_fk
    FOREIGN KEY (contact_id, account_id) REFERENCES contacts(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
  ON contact_identities (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_account_channel
  ON contact_identities (account_id, channel);

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_identities_select ON contact_identities;
DROP POLICY IF EXISTS contact_identities_modify ON contact_identities;
CREATE POLICY contact_identities_select ON contact_identities FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_identities_modify ON contact_identities FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON contact_identities;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON contact_identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Backfill phone and BSUID identities separately: one contact can have both.
-- `ON CONFLICT DO NOTHING` makes the migration safe to re-run and never
-- reassigns an identity to another contact during a migration.
INSERT INTO contact_identities (
  account_id, contact_id, channel, external_id, display_name, phone, metadata
)
SELECT
  account_id,
  id,
  'whatsapp',
  regexp_replace(phone, '\\D', '', 'g'),
  name,
  phone,
  jsonb_build_object('identity_type', 'phone', 'backfilled', true)
FROM contacts
WHERE phone IS NOT NULL
  AND regexp_replace(phone, '\\D', '', 'g') <> ''
ON CONFLICT (account_id, channel, external_id) DO NOTHING;

INSERT INTO contact_identities (
  account_id, contact_id, channel, external_id, username, display_name, phone, avatar_url, metadata
)
SELECT
  account_id,
  id,
  'whatsapp',
  btrim(whatsapp_user_id),
  whatsapp_username,
  name,
  phone,
  avatar_url,
  jsonb_build_object('identity_type', 'bsuid', 'backfilled', true)
FROM contacts
WHERE whatsapp_user_id IS NOT NULL
  AND btrim(whatsapp_user_id) <> ''
ON CONFLICT (account_id, channel, external_id) DO NOTHING;
