-- Foundation only: no checkout, automatic charges, or global suspension.
-- Clients may read their business plan but cannot grant themselves features.
BEGIN;

CREATE TABLE public.account_subscriptions (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL DEFAULT 'crm' CHECK (plan_key IN ('crm', 'managed', 'advanced')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'suspended', 'canceled')),
  access_until TIMESTAMPTZ,
  workflow_editor_licensed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status NOT IN ('trialing', 'past_due') OR access_until IS NOT NULL)
);
ALTER TABLE public.account_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.account_subscriptions TO authenticated;
GRANT ALL ON public.account_subscriptions TO service_role;
CREATE POLICY account_subscriptions_read ON public.account_subscriptions FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Preserve existing CRM installations. No advanced plan or editor is granted.
INSERT INTO public.account_subscriptions(account_id) SELECT id FROM public.accounts;

CREATE FUNCTION public.initialize_account_subscription() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.account_subscriptions(account_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_account_subscription() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER initialize_account_subscription AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.initialize_account_subscription();

COMMIT;
