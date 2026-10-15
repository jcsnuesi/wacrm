-- Isolated PostgreSQL only; mock prerequisites do not replace staging tests.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE TABLE auth.users(id UUID PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.accounts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, owner_user_id UUID REFERENCES auth.users(id), default_currency TEXT);
CREATE UNIQUE INDEX idx_accounts_one_per_owner ON public.accounts(owner_user_id);
CREATE TABLE public.account_members(account_id UUID REFERENCES public.accounts(id), user_id UUID REFERENCES auth.users(id), role TEXT, PRIMARY KEY(account_id,user_id));
CREATE FUNCTION public.is_account_member(target UUID) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM account_members WHERE account_id=target AND user_id=auth.uid()) $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
\ir 056_account_subscriptions.sql
\ir 057_business_onboarding.sql
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111', false);
DO $$
DECLARE first UUID; second UUID; retry UUID;
BEGIN
  first := public.create_business('Academia Horizonte','Educación','USD','advanced','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  retry := public.create_business('Academia Horizonte','Educación','USD','advanced','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF first <> retry THEN RAISE EXCEPTION 'Retry duplicated business'; END IF;
  second := public.create_business('Tienda Norte','Comercio','EUR','crm','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  IF first = second THEN RAISE EXCEPTION 'Business not separated'; END IF;
  IF (SELECT count(*) FROM business_onboarding) <> 2 THEN RAISE EXCEPTION 'Owner memberships missing'; END IF;
  IF EXISTS(SELECT 1 FROM account_subscriptions WHERE plan_key <> 'crm' OR workflow_editor_licensed) THEN RAISE EXCEPTION 'Paid self activation'; END IF;
  BEGIN
    PERFORM public.create_business('Invalid','Test','USD','unlimited',gen_random_uuid());
    RAISE EXCEPTION 'Invalid plan accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('test.user_id','22222222-2222-4222-8222-222222222222', false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM business_onboarding) OR EXISTS(SELECT 1 FROM account_subscriptions) THEN RAISE EXCEPTION 'Cross business data leak'; END IF; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.create_business('Forbidden','Test','USD','crm',gen_random_uuid()); RAISE EXCEPTION 'Anonymous creation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Atomic onboarding, idempotency, ownership, isolation and paid access protection passed' AS result;
