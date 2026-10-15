-- Run only in a fresh isolated database with onboarding prerequisites.
\set ON_ERROR_STOP on
\ir business-onboarding.sql
CREATE TABLE public.pipelines(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users(id), account_id UUID REFERENCES public.accounts(id), name TEXT);
CREATE TABLE public.pipeline_stages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pipeline_id UUID REFERENCES public.pipelines(id), name TEXT CHECK(name<>'Force failure'), position INTEGER);
CREATE TABLE public.custom_fields(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users(id), account_id UUID REFERENCES public.accounts(id), field_name TEXT, field_type TEXT);
\ir 058_business_templates.sql
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE business UUID; retry UUID; blank UUID;
BEGIN
  business := public.create_business_with_template('Inmobiliaria Norte','Inmobiliaria','USD','advanced','cccccccc-cccc-4ccc-8ccc-cccccccccccc','real_estate','rent',1,'["Consulta","Visita","Cierre"]');
  retry := public.create_business_with_template('Inmobiliaria Norte','Inmobiliaria','USD','advanced','cccccccc-cccc-4ccc-8ccc-cccccccccccc','real_estate','rent',1,'["Consulta","Visita","Cierre"]');
  IF business<>retry THEN RAISE EXCEPTION 'Duplicate retry'; END IF;
  blank := public.create_business_with_template('Negocio vacío','Otro','EUR','crm','dddddddd-dddd-4ddd-8ddd-dddddddddddd','blank','sell',1,'[]');
  IF (SELECT count(*) FROM public.account_template_config)<>2 THEN RAISE EXCEPTION 'Config assignments missing'; END IF;
  IF (SELECT objective FROM public.account_template_config WHERE account_id=business)<>'rent' THEN RAISE EXCEPTION 'Objective not persisted'; END IF;
  IF (SELECT pipeline_id FROM public.account_template_config WHERE account_id=blank) IS NOT NULL THEN RAISE EXCEPTION 'Blank seeded a pipeline'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_subscriptions WHERE plan_key<>'crm' OR workflow_editor_licensed) THEN RAISE EXCEPTION 'Paid entitlements were granted'; END IF;
  BEGIN
    PERFORM public.create_business_with_template('Invalid','Otro','USD','crm',gen_random_uuid(),'generic','rent',1,'["Uno","Dos"]');
    RAISE EXCEPTION 'Unsupported objective accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.create_business_with_template('Invalid','Otro','USD','crm',gen_random_uuid(),'generic','sell',1,'["Uno"," uno "]');
    RAISE EXCEPTION 'Duplicate stages accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.create_business_with_template('Rollback negocio','Otro','USD','crm',gen_random_uuid(),'generic','sell',1,'["Uno","Force failure"]');
    RAISE EXCEPTION 'Failure was not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.pipelines)<>1 OR (SELECT count(*) FROM public.pipeline_stages)<>3 OR (SELECT count(*) FROM public.custom_fields)<>4 THEN RAISE EXCEPTION 'Resource duplicates or partial seed'; END IF;
  IF EXISTS(SELECT 1 FROM public.accounts WHERE name='Rollback negocio') THEN RAISE EXCEPTION 'Partial account after failure'; END IF;
  IF EXISTS(SELECT 1 FROM public.custom_fields f JOIN public.account_template_config c ON f.account_id=c.account_id WHERE f.user_id<>c.applied_by) THEN RAISE EXCEPTION 'Foreign creator'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.account_template_config) THEN RAISE EXCEPTION 'Template config leaked'; END IF;
  BEGIN UPDATE public.business_template_catalog SET fields='["Forged"]'; RAISE EXCEPTION 'User changed catalogue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Template transaction, objective, blank, retry, rollback, isolation and entitlements passed' AS result;
