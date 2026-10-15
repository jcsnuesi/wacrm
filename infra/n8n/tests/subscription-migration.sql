-- Run only in a newly-created, isolated test database.
-- Minimal prerequisites stand in for earlier Supabase migrations.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.accounts(id UUID PRIMARY KEY);
CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE FUNCTION public.is_account_member(account UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT account::TEXT = current_setting('test.account_id', TRUE);
$$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
INSERT INTO public.accounts VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
\ir 056_account_subscriptions.sql

SET ROLE authenticated;
SELECT set_config('test.account_id', '11111111-1111-4111-8111-111111111111', FALSE);
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.account_subscriptions) <> 1 THEN
    RAISE EXCEPTION 'Subscriptions leaked between businesses';
  END IF;
  BEGIN
    UPDATE public.account_subscriptions SET plan_key = 'advanced', workflow_editor_licensed = TRUE;
    RAISE EXCEPTION 'Member granted own paid features';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.account_subscriptions(account_id) VALUES ('22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'Member created own subscription';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.account_subscriptions;
    RAISE EXCEPTION 'Anonymous subscription access accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SET ROLE service_role;
UPDATE public.account_subscriptions SET plan_key = 'managed'
 WHERE account_id = '11111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  BEGIN
    UPDATE public.account_subscriptions SET status = 'past_due', access_until = NULL;
    RAISE EXCEPTION 'Unbounded payment grace accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
RESET ROLE;
INSERT INTO public.accounts VALUES ('33333333-3333-4333-8333-333333333333');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.account_subscriptions
    WHERE account_id = '33333333-3333-4333-8333-333333333333'
      AND plan_key = 'crm' AND NOT workflow_editor_licensed) THEN
    RAISE EXCEPTION 'New business did not receive isolated CRM subscription';
  END IF;
END;
$$;
SELECT 'Subscription migration isolation and privileges passed' AS result;
