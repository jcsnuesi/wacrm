\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE account UUID:=(SELECT id FROM test_ids WHERE name='account'); staff UUID:=(SELECT id FROM test_ids WHERE name='professional');
  service UUID:=(SELECT id FROM test_ids WHERE name='service'); product UUID:=(SELECT id FROM test_ids WHERE name='product'); key UUID:=gen_random_uuid();
  payload JSONB; a JSONB; b JSONB; op UUID; proof UUID; cfg JSONB; working JSONB; other_staff UUID; res UUID;
BEGIN
  SELECT public.ops_dashboard(account)->'config' INTO cfg;
  PERFORM public.ops_command(account,'configure',cfg||'{"public_enabled":true}',gen_random_uuid());
  a:=public.ops_command(account,'resource','{"name":"Estación compartida"}',gen_random_uuid()); res:=(a->>'id')::uuid;
  SELECT jsonb_agg(jsonb_build_object('weekday',d,'start','09:00','end','18:00')) INTO working FROM generate_series(1,7)d;
  a:=public.ops_command(account,'professional',jsonb_build_object('name','Otro profesional','hours',working,'service_bps',1000,'product_bps',500),gen_random_uuid());
  other_staff:=(a->>'id')::uuid; INSERT INTO test_ids VALUES('other_staff',other_staff);
  PERFORM public.ops_command(account,'service',jsonb_build_object('id',service,'name','Servicio','price_minor',100000,'duration_minutes',30,'resource_id',res,'professional_ids',jsonb_build_array(staff,other_staff)),gen_random_uuid());
  payload:=jsonb_build_object('professional_id',staff,'service_ids',jsonb_build_array(service),'starts_at',(current_date+2)::text||'T10:00:00Z','client_name','Cliente idempotente','client_phone','+18095550002');
  a:=public.ops_command(account,'book',payload,key);b:=public.ops_command(account,'book',payload,key);
  IF a<>b THEN RAISE EXCEPTION 'Retry duplicated booking'; END IF;
  INSERT INTO test_ids VALUES('open_operation',(a->>'operation_id')::uuid);
  BEGIN
    PERFORM public.ops_command(account,'book',payload||jsonb_build_object('professional_id',other_staff),gen_random_uuid());
    RAISE EXCEPTION 'Shared resource double booked';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  a:=public.ops_command(account,'book',payload||jsonb_build_object('professional_id',other_staff,'starts_at',(current_date+2)::text||'T11:00:00Z'),gen_random_uuid());
  INSERT INTO test_ids VALUES('other_appointment',(a->>'id')::uuid);
  BEGIN
    PERFORM public.ops_command(account,'close',jsonb_build_object('client_name','Rollback','client_phone','+18095550100','items',jsonb_build_array(jsonb_build_object('kind','product','source_id',product,'quantity',100000,'professional_id',staff))),gen_random_uuid());
    RAISE EXCEPTION 'Insufficient stock accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Same confirmed document may not credit another operation.
  op:=(SELECT id FROM test_ids WHERE name='open_operation');
  a:=public.ops_command(account,'proof',jsonb_build_object('operation_id',op,'declared_minor',50000,'reference','OTHER','file_path',account::text||'/11111111-1111-4111-8111-111111111111/another.pdf','file_hash','testhash'),gen_random_uuid());
  proof:=(a->>'id')::uuid;
  IF NOT (a->>'duplicate_warning')::boolean THEN RAISE EXCEPTION 'Reused file not flagged'; END IF;
  BEGIN
    PERFORM public.ops_command(account,'review_proof',jsonb_build_object('id',proof,'decision','confirm','verified_minor',50000,'note','Duplicate'),gen_random_uuid());
    RAISE EXCEPTION 'Same confirmed file counted twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM public.ops_command(account,'review_proof',jsonb_build_object('id',proof,'decision','reject','note','Archivo reutilizado'),gen_random_uuid());
  PERFORM public.ops_command(account,'expense','{"amount_minor":1000,"category":"Operación","note":"Registro manual"}',gen_random_uuid());
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.ops_operations WHERE client_name='Rollback') THEN RAISE EXCEPTION 'Failed sale left partial records'; END IF; END $$;
SET ROLE authenticated;
SELECT set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
DO $$ DECLARE account UUID:=(SELECT id FROM test_ids WHERE name='account'); data JSONB; BEGIN
  data:=public.ops_dashboard(account);
  IF jsonb_array_length(data->'professionals')<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(data->'appointments')a WHERE a->>'id'=(SELECT id::text FROM test_ids WHERE name='other_appointment')) THEN RAISE EXCEPTION 'Other employee data leaked'; END IF;
  BEGIN PERFORM public.ops_command(account,'appointment_status',jsonb_build_object('id',(SELECT id FROM test_ids WHERE name='other_appointment'),'status','canceled'),gen_random_uuid()); RAISE EXCEPTION 'Other employee appointment modified'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ops_command(account,'expense','{"amount_minor":1,"category":"Forbidden"}',gen_random_uuid()); RAISE EXCEPTION 'Professional recorded expense'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Simulate service-role public transport; no customer/private data in catalog.
SELECT set_config('test.user_id','',false);
SET ROLE service_role;
DO $$ DECLARE slug TEXT; catalog JSONB; available JSONB; booked JSONB; key UUID:=gen_random_uuid(); account UUID; staff UUID; service UUID; BEGIN
  SELECT account_id,public_slug INTO account,slug FROM public.ops_config WHERE professional_label='Barbero';
  SELECT id INTO staff FROM public.ops_professionals WHERE account_id=account AND name='Otro profesional';
  SELECT id INTO service FROM public.ops_services WHERE account_id=account LIMIT 1;
  catalog:=public.ops_public_catalog(slug);
  IF catalog::text LIKE '%client_phone%' OR catalog::text LIKE '%commission%' OR catalog::text LIKE '%cost_minor%' OR catalog::text LIKE '%linked_email%' THEN RAISE EXCEPTION 'Public catalog leaked data'; END IF;
  available:=public.ops_public_slots(slug,service,staff,current_date+3);
  IF jsonb_array_length(available)=0 THEN RAISE EXCEPTION 'Public availability empty'; END IF;
  booked:=public.ops_public_book(slug,jsonb_build_object('professional_id',staff,'service_ids',jsonb_build_array(service),'starts_at',available->>0,'client_name','Cliente público','client_phone','+18095550004'),key);
  IF booked<>public.ops_public_book(slug,jsonb_build_object('professional_id',staff,'service_ids',jsonb_build_array(service),'starts_at',available->>0,'client_name','Cliente público','client_phone','+18095550004'),key) THEN RAISE EXCEPTION 'Public retry duplicated'; END IF;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.ops_public_catalog('anything'); RAISE EXCEPTION 'Anonymous direct privileged RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.ops_command(gen_random_uuid(),'configure','{}',gen_random_uuid()); RAISE EXCEPTION 'Anonymous mutation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Public booking, resource conflicts, retries, rollback, duplicate proofs, employee scopes and anonymous denial passed' AS result;
