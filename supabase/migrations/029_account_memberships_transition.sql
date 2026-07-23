-- ============================================================
-- 029_account_memberships_transition.sql
--
-- Transition step for multi-account-per-user support with zero-breakage:
--   1) Add canonical membership table: account_members
--   2) Backfill from profiles.account_id/account_role
--   3) Keep profiles as legacy fallback during migration
--   4) Redefine is_account_member() to read both sources
--   5) Add profile->membership sync trigger for compatibility
--
-- This migration is intentionally backward-compatible: existing code
-- paths that read profiles continue to work unchanged.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_members (
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        account_role_enum NOT NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

-- Fast lookup for "all accounts for this user".
CREATE INDEX IF NOT EXISTS idx_account_members_user
  ON account_members(user_id);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- Minimal policy set for the transition: a user can read their own
-- memberships. Write paths are handled by security-definer helpers/
-- triggers for now.
DROP POLICY IF EXISTS account_members_select_own ON account_members;
CREATE POLICY account_members_select_own ON account_members FOR SELECT
  USING (auth.uid() = user_id);

-- Backfill canonical memberships from existing profile tenancy.
INSERT INTO account_members (account_id, user_id, role)
SELECT p.account_id, p.user_id, p.account_role
FROM profiles p
WHERE p.account_id IS NOT NULL
  AND p.account_role IS NOT NULL
ON CONFLICT (account_id, user_id)
DO UPDATE SET role = EXCLUDED.role;

-- Keep account_members in sync while legacy code still writes
-- profile.account_id/account_role.
CREATE OR REPLACE FUNCTION public.sync_profile_account_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NULL OR NEW.account_role IS NULL THEN
    DELETE FROM account_members
    WHERE user_id = NEW.user_id;
    RETURN NEW;
  END IF;

  INSERT INTO account_members (account_id, user_id, role)
  VALUES (NEW.account_id, NEW.user_id, NEW.account_role)
  ON CONFLICT (account_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  -- If account changed, remove stale memberships for this user that
  -- originated from legacy single-account profile storage.
  DELETE FROM account_members
  WHERE user_id = NEW.user_id
    AND account_id <> NEW.account_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_account_membership ON profiles;
CREATE TRIGGER trg_sync_profile_account_membership
AFTER INSERT OR UPDATE OF account_id, account_role
ON profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_account_membership();

-- Redefine membership helper to support both canonical memberships
-- and legacy profile columns during rollout.
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_candidates AS (
    SELECT am.role
    FROM account_members am
    WHERE am.user_id = auth.uid()
      AND am.account_id = target_account_id

    UNION ALL

    SELECT p.account_role AS role
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.account_role IS NOT NULL
  ),
  max_level AS (
    SELECT MAX(
      CASE role
        WHEN 'owner'  THEN 4
        WHEN 'admin'  THEN 3
        WHEN 'agent'  THEN 2
        WHEN 'viewer' THEN 1
      END
    ) AS lvl
    FROM role_candidates
  )
  SELECT COALESCE((SELECT lvl FROM max_level), 0)
    >=
    CASE min_role
      WHEN 'owner'  THEN 4
      WHEN 'admin'  THEN 3
      WHEN 'agent'  THEN 2
      WHEN 'viewer' THEN 1
    END;
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum)
  TO authenticated, service_role;
