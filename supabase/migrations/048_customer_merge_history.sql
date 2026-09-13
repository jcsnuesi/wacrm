-- ============================================================
-- 048_customer_merge_history.sql
--
-- Explicit, transactional Customer merge. The source profile is retained as
-- a merged audit record; identities and conversations move to the target.
-- Legacy contacts stay untouched during the compatibility phase.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_merge_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  target_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reason TEXT,
  score NUMERIC(4, 3) CHECK (score >= 0 AND score <= 1),
  snapshot JSONB NOT NULL,
  merged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_merge_history_customers_different CHECK (source_customer_id <> target_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_merge_history_account_merged_at
  ON customer_merge_history(account_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_merge_history_source
  ON customer_merge_history(source_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_merge_history_target
  ON customer_merge_history(target_customer_id);

ALTER TABLE customer_merge_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_merge_history_select ON customer_merge_history;
CREATE POLICY customer_merge_history_select ON customer_merge_history FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION merge_customers(
  source_customer UUID,
  target_customer UUID,
  merge_reason TEXT DEFAULT NULL,
  merge_score NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_row customers%ROWTYPE;
  target_row customers%ROWTYPE;
  merge_id UUID;
  merge_snapshot JSONB;
BEGIN
  IF source_customer = target_customer THEN
    RAISE EXCEPTION 'source and target customers must differ';
  END IF;

  SELECT * INTO source_row FROM customers WHERE id = source_customer FOR UPDATE;
  SELECT * INTO target_row FROM customers WHERE id = target_customer FOR UPDATE;
  IF NOT FOUND OR source_row.id IS NULL OR target_row.id IS NULL THEN
    RAISE EXCEPTION 'both customers must exist';
  END IF;
  IF source_row.account_id <> target_row.account_id THEN
    RAISE EXCEPTION 'customers must belong to the same account';
  END IF;
  IF source_row.status = 'merged' THEN
    RAISE EXCEPTION 'source customer is already merged';
  END IF;
  IF NOT is_account_member(source_row.account_id, 'agent') THEN
    RAISE EXCEPTION 'not authorized to merge customers';
  END IF;

  merge_snapshot := jsonb_build_object(
    'source_customer', to_jsonb(source_row),
    'target_customer', to_jsonb(target_row),
    'identity_count', (SELECT count(*) FROM contact_identities WHERE customer_id = source_customer),
    'conversation_count', (SELECT count(*) FROM conversations WHERE customer_id = source_customer)
  );

  INSERT INTO customer_merge_history (
    account_id, source_customer_id, target_customer_id, reason, score, snapshot, merged_by
  ) VALUES (
    source_row.account_id, source_customer, target_customer, merge_reason, merge_score,
    merge_snapshot, auth.uid()
  ) RETURNING id INTO merge_id;

  UPDATE contact_identities SET customer_id = target_customer WHERE customer_id = source_customer;
  UPDATE conversations SET customer_id = target_customer WHERE customer_id = source_customer;
  UPDATE customers SET status = 'merged', updated_at = NOW() WHERE id = source_customer;

  RETURN merge_id;
END;
$$;

ALTER FUNCTION merge_customers(UUID, UUID, TEXT, NUMERIC) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION merge_customers(UUID, UUID, TEXT, NUMERIC) TO authenticated, service_role;
