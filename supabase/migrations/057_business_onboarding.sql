-- Separate businesses owned by one login. Never change the legacy profile:
-- its sync trigger would delete the user's other memberships.
BEGIN;
DROP INDEX IF EXISTS public.idx_accounts_one_per_owner;
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON public.accounts(owner_user_id);

CREATE TABLE public.business_onboarding (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  request_id UUID NOT NULL,
  industry TEXT NOT NULL CHECK (length(industry) BETWEEN 1 AND 80),
  requested_plan TEXT NOT NULL CHECK (requested_plan IN ('crm', 'managed', 'advanced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(created_by, request_id)
);
ALTER TABLE public.business_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_onboarding TO authenticated;
GRANT ALL ON public.business_onboarding TO service_role;
CREATE POLICY business_onboarding_read ON public.business_onboarding
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

CREATE FUNCTION public.create_business(
  p_name TEXT, p_industry TEXT, p_currency TEXT, p_requested_plan TEXT, p_request_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller UUID := auth.uid();
  business UUID;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80
    OR p_industry IS NULL OR length(btrim(p_industry)) NOT BETWEEN 1 AND 80
    OR p_currency IS NULL OR p_currency NOT IN ('USD','EUR','GBP','INR','AUD','CAD','BRL','JPY','CNY','AED','ZAR','NGN','SGD','MXN','COP')
    OR p_requested_plan IS NULL OR p_requested_plan NOT IN ('crm','managed','advanced')
    OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid business details' USING ERRCODE = '22023';
  END IF;
  -- Serializes concurrent creation and idempotent retries for this owner.
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  SELECT account_id INTO business FROM public.business_onboarding
    WHERE created_by = caller AND request_id = p_request_id;
  IF business IS NOT NULL THEN RETURN business; END IF;
  IF (SELECT count(*) FROM public.accounts WHERE owner_user_id = caller) >= 25 THEN
    RAISE EXCEPTION 'Business limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.accounts(name, owner_user_id, default_currency)
    VALUES (btrim(p_name), caller, p_currency) RETURNING id INTO business;
  INSERT INTO public.account_members(account_id, user_id, role) VALUES (business, caller, 'owner');
  INSERT INTO public.business_onboarding(account_id, created_by, request_id, industry, requested_plan)
    VALUES (business, caller, p_request_id, btrim(p_industry), p_requested_plan);
  -- Paid selection is a request only. No paid entitlements or editor license
  -- are granted here; subscription defaults are controlled by migration 056.
  RETURN business;
END;
$$;
REVOKE ALL ON FUNCTION public.create_business(TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business(TEXT,TEXT,TEXT,TEXT,UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
