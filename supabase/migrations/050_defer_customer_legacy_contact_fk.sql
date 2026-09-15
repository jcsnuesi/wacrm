-- ============================================================
-- 050_defer_customer_legacy_contact_fk.sql
--
-- The legacy-contact compatibility trigger creates the canonical customer
-- from a BEFORE INSERT trigger on contacts. At that point NEW.id has been
-- assigned, but the contacts row is not visible to an immediate foreign-key
-- check yet. Defer the reverse customers -> contacts reference until commit,
-- when both sides of the compatibility bridge exist.
-- ============================================================

BEGIN;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_legacy_contact_id_fkey;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_legacy_contact_id_fkey
  FOREIGN KEY (legacy_contact_id)
  REFERENCES public.contacts(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED
  NOT VALID;

COMMIT;

-- Existing rows were valid under the previous immediate constraint. Validate
-- separately so installing the replacement does not require a full table scan
-- while holding the stronger ALTER TABLE lock.
ALTER TABLE public.customers
  VALIDATE CONSTRAINT customers_legacy_contact_id_fkey;
