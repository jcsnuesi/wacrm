-- Run after activity-operations.sql and operations-edges.sql in an isolated DB.
\set ON_ERROR_STOP on
ALTER TABLE auth.users ADD COLUMN invited_at TIMESTAMPTZ, ADD COLUMN email_confirmed_at TIMESTAMPTZ, ADD COLUMN raw_user_meta_data JSONB DEFAULT '{}';
UPDATE auth.users SET email_confirmed_at=now();
ALTER TABLE public.profiles ADD COLUMN full_name TEXT NOT NULL DEFAULT '', ADD COLUMN email TEXT NOT NULL DEFAULT '';
\ir 030_profile_membership_sync_non_destructive.sql
\ir 062_employee_access.sql
-- Match production: the signup trigger belongs to the non-superuser postgres.
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT SELECT ON auth.users TO postgres;
GRANT INSERT,SELECT ON public.profiles,public.accounts TO postgres;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('66666666-6666-4666-8666-666666666666','normal-signup@example.com','{"full_name":"Normal signup","account_role":"professional"}');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id='66666666-6666-4666-8666-666666666666' AND account_role='owner' AND full_name='Normal signup') THEN RAISE EXCEPTION 'Normal signup changed or client metadata granted an employee role'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE a UUID:=(SELECT id FROM test_ids WHERE name='account'); employee UUID; result JSONB;
BEGIN
 result:=public.ops_command(a,'professional','{"name":"Nuevo empleado","hours":[],"service_bps":3000,"product_bps":0}',gen_random_uuid());
 employee:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('new_employee',employee);
 result:=public.ops_employee_prepare(a,employee,'new-employee@example.com',ARRAY['appointments'],'save',repeat('a',64),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 IF result->>'status'<>'pending' OR NOT (result->>'send_required')::boolean THEN RAISE EXCEPTION 'Invitation was not prepared'; END IF;
 -- Retrying preserves the invitation, rather than invalidating its link.
 result:=public.ops_employee_prepare(a,employee,'new-employee@example.com',ARRAY['appointments'],'save',repeat('b',64),'ffffffff-ffff-4fff-8fff-ffffffffffff');
 IF result->>'token_hash'<>repeat('a',64) THEN RAISE EXCEPTION 'Retry invalidated invitation'; END IF;
 BEGIN PERFORM public.ops_employee_prepare(a,employee,'new-employee@example.com',ARRAY['made_up'],'save',repeat('b',64),gen_random_uuid()); RAISE EXCEPTION 'Unimplemented module granted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
DO $$ DECLARE before_count INTEGER:=jsonb_array_length(public.ops_dashboard((SELECT id FROM test_ids WHERE name='account'))->'professionals'); BEGIN
 BEGIN
  PERFORM public.ops_employee_save((SELECT id FROM test_ids WHERE name='account'),'{"name":"Must roll back","hours":[],"service_bps":0,"product_bps":0}',
    '{"mode":"save","email":"rollback@example.com","modules":["unimplemented"]}',gen_random_uuid(),repeat('c',64));
  RAISE EXCEPTION 'Invalid access configuration accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF jsonb_array_length(public.ops_dashboard((SELECT id FROM test_ids WHERE name='account'))->'professionals')<>before_count THEN RAISE EXCEPTION 'Failed access save left an orphan professional'; END IF;
END $$;
RESET ROLE;
UPDATE public.ops_employee_access SET provision_user_id='55555555-5555-4555-8555-555555555555' WHERE email='new-employee@example.com';
DO $$ DECLARE before_count BIGINT:=(SELECT count(*) FROM accounts); BEGIN
 INSERT INTO auth.users(id,email,invited_at,email_confirmed_at,raw_user_meta_data) VALUES('55555555-5555-4555-8555-555555555555','new-employee@example.com',NULL,NULL,'{"full_name":"Nuevo empleado"}');
 IF (SELECT count(*) FROM accounts)<>before_count THEN RAISE EXCEPTION 'Employee invitation created an unwanted personal business'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id='55555555-5555-4555-8555-555555555555' AND account_role='professional') THEN RAISE EXCEPTION 'Employee profile not provisioned'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('test.user_id','55555555-5555-4555-8555-555555555555',false);
DO $$ BEGIN
 BEGIN PERFORM public.ops_employee_accept(repeat('a',64)); RAISE EXCEPTION 'Unverified user accepted invitation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id='55555555-5555-4555-8555-555555555555';
SET ROLE authenticated;
SELECT set_config('test.user_id','55555555-5555-4555-8555-555555555555',false);
DO $$ DECLARE a UUID; data JSONB; BEGIN
 a:=public.ops_employee_accept(repeat('a',64));
 IF a<>public.ops_employee_accept(repeat('a',64)) THEN RAISE EXCEPTION 'Acceptance is not idempotent'; END IF;
 data:=public.ops_dashboard(a);
 IF data->'allowed_modules'<>'["appointments"]'::jsonb OR data->'commissions'<>'[]'::jsonb OR data->'products'<>'[]'::jsonb OR data ? 'employee_modules' THEN RAISE EXCEPTION 'Disabled module data leaked'; END IF;
 BEGIN PERFORM public.ops_command(a,'close','{}',gen_random_uuid()); RAISE EXCEPTION 'Disabled sales action allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ops_command_core(a,'professional','{}',gen_random_uuid()); RAISE EXCEPTION 'Core bypass allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.ops_employee_access; RAISE EXCEPTION 'Invitation table readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ops_employee_prepare(a,(SELECT id FROM test_ids WHERE name='new_employee'),'new-employee@example.com',ARRAY['sales'],'save',repeat('b',64),gen_random_uuid()); RAISE EXCEPTION 'Employee changed own grants'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
SELECT public.ops_employee_prepare((SELECT id FROM test_ids WHERE name='account'),(SELECT id FROM test_ids WHERE name='new_employee'),'new-employee@example.com',ARRAY['appointments','commissions'],'save',repeat('b',64),gen_random_uuid());
SELECT set_config('test.user_id','55555555-5555-4555-8555-555555555555',false);
DO $$ DECLARE data JSONB:=public.ops_dashboard((SELECT id FROM test_ids WHERE name='account')); BEGIN
 IF NOT data->'allowed_modules' ? 'commissions' THEN RAISE EXCEPTION 'Permission update did not affect existing session'; END IF;
END $$;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
SELECT public.ops_employee_prepare((SELECT id FROM test_ids WHERE name='account'),(SELECT id FROM test_ids WHERE name='new_employee'),NULL,NULL,'suspend',NULL,gen_random_uuid());
SELECT set_config('test.user_id','55555555-5555-4555-8555-555555555555',false);
DO $$ BEGIN
 BEGIN PERFORM public.ops_dashboard((SELECT id FROM test_ids WHERE name='account')); RAISE EXCEPTION 'Suspended session retains access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ops_employee_accept(repeat('a',64)); RAISE EXCEPTION 'Revoked invite reused'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- A user who already owns another business can accept without losing it.
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
DO $$ DECLARE a UUID:=(SELECT id FROM test_ids WHERE name='account'); id UUID; data JSONB; BEGIN
 data:=public.ops_command(a,'professional','{"name":"Existing owner","hours":[],"service_bps":0,"product_bps":0}',gen_random_uuid());
 id:=(data->>'id')::uuid;
 PERFORM public.ops_employee_prepare(a,id,'other-owner@example.com',ARRAY['sales'],'save',repeat('d',64),gen_random_uuid());
END $$;
RESET ROLE;
INSERT INTO public.accounts(name,owner_user_id,default_currency) VALUES('Existing unrelated business','44444444-4444-4444-8444-444444444444','USD');
INSERT INTO public.account_members(account_id,user_id,role) SELECT id,owner_user_id,'owner' FROM public.accounts WHERE name='Existing unrelated business';
SET ROLE authenticated;
SELECT set_config('test.user_id','44444444-4444-4444-8444-444444444444',false);
SELECT public.ops_employee_accept(repeat('d',64));
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.account_members WHERE user_id=auth.uid() AND role='owner') THEN RAISE EXCEPTION 'Other business membership was lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account_members WHERE user_id=auth.uid() AND role='professional') THEN RAISE EXCEPTION 'Employee membership was not added'; END IF;
END $$;
RESET ROLE;
SELECT 'Employee provisioning, verification, module grants, private tables, immediate suspension and invite revocation passed' AS result;
