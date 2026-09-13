-- ============================================================
-- 047_identity_match_review.sql
--
-- Auditable review queue for uncertain identity resolution. Deterministic
-- external-id, phone, and email matches are handled by the resolver; this
-- table is deliberately for candidates requiring a human decision.
-- ============================================================

CREATE TABLE IF NOT EXISTS identity_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_identity_id UUID NOT NULL REFERENCES contact_identities(id) ON DELETE CASCADE,
  candidate_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  match_score NUMERIC(4, 3) NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
  match_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('AUTO_MATCHED', 'PENDING_REVIEW', 'CONFIRMED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT identity_matches_source_candidate_unique UNIQUE (source_identity_id, candidate_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_matches_account_status
  ON identity_matches(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_matches_source ON identity_matches(source_identity_id);
CREATE INDEX IF NOT EXISTS idx_identity_matches_candidate ON identity_matches(candidate_customer_id);

ALTER TABLE identity_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_matches_select ON identity_matches;
DROP POLICY IF EXISTS identity_matches_modify ON identity_matches;
CREATE POLICY identity_matches_select ON identity_matches FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY identity_matches_modify ON identity_matches FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
