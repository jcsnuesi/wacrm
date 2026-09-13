-- ============================================================
-- 045_customer_360_core.sql
--
-- Add the canonical Customer 360 model without changing the active
-- WhatsApp contact, conversation, or message paths. `contacts` remains the
-- compatibility projection during the gradual cutover; every legacy contact
-- receives exactly one canonical customer and its existing identities are
-- linked to that customer.
-- ============================================================

-- Global provider catalogue. Accounts own the connections in channel_accounts.
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE CHECK (code IN ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK')),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'social',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO channels (code, name, type, capabilities)
VALUES
  ('WHATSAPP', 'WhatsApp', 'messaging', '{"receive_messages": true, "send_messages": true, "media": true, "comments": false, "profile_lookup": true}'::jsonb),
  ('INSTAGRAM', 'Instagram', 'social', '{"receive_messages": true, "send_messages": true, "media": true, "comments": true, "profile_lookup": true}'::jsonb),
  ('FACEBOOK', 'Facebook', 'social', '{"receive_messages": true, "send_messages": true, "media": true, "comments": true, "profile_lookup": true}'::jsonb),
  ('TIKTOK', 'TikTok', 'social', '{"receive_messages": false, "send_messages": false, "media": false, "comments": false, "profile_lookup": false}'::jsonb)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    capabilities = EXCLUDED.capabilities,
    updated_at = NOW();

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channels_select ON channels;
CREATE POLICY channels_select ON channels FOR SELECT TO authenticated USING (TRUE);

DROP TRIGGER IF EXISTS set_updated_at ON channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Customer is the provider-neutral, account-scoped person record. The
-- legacy_contact_id is deliberately retained as a one-way bridge until every
-- existing contact-dependent feature reads Customer directly.
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  legacy_contact_id UUID UNIQUE REFERENCES contacts(id) ON DELETE SET NULL,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_id_account_unique UNIQUE (id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_account ON customers(account_id);
CREATE INDEX IF NOT EXISTS idx_customers_account_phone ON customers(account_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_account_email ON customers(account_id, lower(email)) WHERE email IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_modify ON customers;
CREATE POLICY customers_select ON customers FOR SELECT USING (is_account_member(account_id));
CREATE POLICY customers_modify ON customers FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON customers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Backfill one canonical Customer per legacy contact. No legacy row is
-- changed or deleted; repeat runs only fill missing mappings.
INSERT INTO customers (
  account_id, legacy_contact_id, first_name, last_name, display_name,
  email, phone, created_at, updated_at
)
SELECT
  c.account_id,
  c.id,
  NULLIF(split_part(btrim(COALESCE(c.name, '')), ' ', 1), ''),
  NULLIF(btrim(regexp_replace(COALESCE(c.name, ''), '^\\S+\\s*', '')), ''),
  NULLIF(btrim(c.name), ''),
  NULLIF(btrim(c.email), ''),
  NULLIF(btrim(c.phone), ''),
  c.created_at,
  c.updated_at
FROM contacts c
WHERE NOT EXISTS (
  SELECT 1 FROM customers customer WHERE customer.legacy_contact_id = c.id
);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
UPDATE contacts c
SET customer_id = customer.id
FROM customers customer
WHERE customer.legacy_contact_id = c.id
  AND c.customer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_customer_id_unique
  ON contacts(customer_id) WHERE customer_id IS NOT NULL;

-- The legacy WhatsApp webhook still inserts into contacts. This trigger keeps
-- every future legacy contact mapped to a Customer until writes move to the
-- canonical service, with no change required to the active webhook.
CREATE OR REPLACE FUNCTION create_customer_for_legacy_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  customer_id_result UUID;
BEGIN
  IF NEW.customer_id IS NULL THEN
    INSERT INTO customers (
      account_id, legacy_contact_id, first_name, last_name, display_name,
      email, phone, created_at, updated_at
    ) VALUES (
      NEW.account_id,
      NEW.id,
      NULLIF(split_part(btrim(COALESCE(NEW.name, '')), ' ', 1), ''),
      NULLIF(btrim(regexp_replace(COALESCE(NEW.name, ''), '^\\S+\\s*', '')), ''),
      NULLIF(btrim(NEW.name), ''),
      NULLIF(btrim(NEW.email), ''),
      NULLIF(btrim(NEW.phone), ''),
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (legacy_contact_id) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
    RETURNING id INTO customer_id_result;

    NEW.customer_id := customer_id_result;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_customer_for_legacy_contact ON contacts;
CREATE TRIGGER ensure_customer_for_legacy_contact
  BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION create_customer_for_legacy_contact();

-- Evolve the existing provider-neutral identity table in place. contact_id
-- stays during compatibility mode so current WhatsApp code has no behaviour
-- change; customer_id is the canonical association for all new adapters.
ALTER TABLE contact_identities
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE contact_identities identity
SET customer_id = c.customer_id,
    first_seen_at = COALESCE(identity.first_seen_at, identity.created_at),
    last_seen_at = COALESCE(identity.last_seen_at, identity.updated_at)
FROM contacts c
WHERE c.id = identity.contact_id
  AND identity.customer_id IS NULL;

-- Existing syncWhatsAppContactIdentities writes the compatibility contact_id
-- only. Derive the canonical association in the database during the cutover.
CREATE OR REPLACE FUNCTION set_customer_for_legacy_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    SELECT customer_id INTO NEW.customer_id
    FROM contacts
    WHERE id = NEW.contact_id AND account_id = NEW.account_id;
  END IF;
  NEW.first_seen_at := COALESCE(NEW.first_seen_at, NEW.created_at, NOW());
  NEW.last_seen_at := COALESCE(NEW.last_seen_at, NEW.updated_at, NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_customer_for_legacy_identity ON contact_identities;
CREATE TRIGGER ensure_customer_for_legacy_identity
  BEFORE INSERT OR UPDATE ON contact_identities
  FOR EACH ROW EXECUTE FUNCTION set_customer_for_legacy_identity();

ALTER TABLE contact_identities ALTER COLUMN customer_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_identities_customer_account_fk'
      AND conrelid = 'contact_identities'::regclass
  ) THEN
    ALTER TABLE contact_identities
      ADD CONSTRAINT contact_identities_customer_account_fk
      FOREIGN KEY (customer_id, account_id) REFERENCES customers(id, account_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contact_identities_customer
  ON contact_identities(customer_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_channel_account_external
  ON contact_identities(channel_account_id, external_id)
  WHERE channel_account_id IS NOT NULL;

-- ChannelAccount keeps its existing lowercase compatibility column; this FK
-- makes the catalogue canonical without rewriting active settings/routes.
ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE RESTRICT;
UPDATE channel_accounts ca
SET channel_id = channel.id
FROM channels channel
WHERE channel.code = upper(ca.channel)
  AND ca.channel_id IS NULL;
ALTER TABLE channel_accounts ALTER COLUMN channel_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_accounts_channel_id ON channel_accounts(channel_id);

COMMENT ON TABLE customers IS 'Canonical Customer 360 profile. contacts remains the temporary legacy compatibility projection.';
COMMENT ON COLUMN contact_identities.customer_id IS 'Canonical Customer association; contact_id is retained during the legacy compatibility phase.';
