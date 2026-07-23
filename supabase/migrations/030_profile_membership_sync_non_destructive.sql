-- ============================================================
-- 030_profile_membership_sync_non_destructive.sql
--
-- Make profile->account_members sync non-destructive so users can
-- hold true multi-account memberships.
--
-- Why:
--   Migration 029's sync_profile_account_membership() removed all
--   other memberships for a user whenever profiles.account_id changed
--   (and deleted all memberships when account_id/account_role became
--   NULL). That re-imposes single-account behavior.
--
-- This migration keeps legacy compatibility (profile writes still
-- mirror into account_members) but never deletes existing memberships.
-- ============================================================

-- Re-converge canonical rows from legacy profile fields in case
-- profile updates happened before this patch migration is applied.
INSERT INTO account_members (account_id, user_id, role)
SELECT p.account_id, p.user_id, p.account_role
FROM profiles p
WHERE p.account_id IS NOT NULL
  AND p.account_role IS NOT NULL
ON CONFLICT (account_id, user_id)
DO UPDATE SET role = EXCLUDED.role;

CREATE OR REPLACE FUNCTION public.sync_profile_account_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy profiles writes can still update canonical membership, but
  -- we must never delete other memberships for this user.
  IF NEW.account_id IS NULL OR NEW.account_role IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO account_members (account_id, user_id, role)
  VALUES (NEW.account_id, NEW.user_id, NEW.account_role)
  ON CONFLICT (account_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN NEW;
END;
$$;

-- Keep trigger wiring explicit and idempotent.
DROP TRIGGER IF EXISTS trg_sync_profile_account_membership ON profiles;
CREATE TRIGGER trg_sync_profile_account_membership
AFTER INSERT OR UPDATE OF account_id, account_role
ON profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_account_membership();
