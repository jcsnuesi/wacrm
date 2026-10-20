-- Fresh isolated database only. Earlier fixtures supply minimal legacy schemas.
\set ON_ERROR_STOP on
\ir business-templates.sql
CREATE TYPE public.account_role_enum AS ENUM('owner','admin','agent','viewer');
\ir 059_professional_role.sql
ALTER TABLE public.account_members ALTER COLUMN role TYPE public.account_role_enum USING role::public.account_role_enum;
ALTER TABLE auth.users ADD COLUMN email TEXT;
INSERT INTO auth.users(id,email) VALUES('33333333-3333-4333-8333-333333333333','professional@example.com'),('44444444-4444-4444-8444-444444444444','other-owner@example.com');
CREATE TABLE public.profiles(user_id UUID PRIMARY KEY,account_id UUID,account_role public.account_role_enum);
CREATE TABLE public.deals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID REFERENCES public.accounts(id),pipeline_id UUID REFERENCES public.pipelines(id),stage_id UUID REFERENCES public.pipeline_stages(id),title TEXT,status TEXT DEFAULT 'open',value NUMERIC DEFAULT 0,currency TEXT DEFAULT 'USD',created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID REFERENCES public.accounts(id));
CREATE TABLE public.messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID REFERENCES public.conversations(id),content_type TEXT,media_url TEXT);
\ir 060_activity_operations.sql
\ir 061_fix_unconfigured_operations_dashboard.sql
CREATE TABLE test_ids(name TEXT PRIMARY KEY,id UUID NOT NULL);
GRANT ALL ON test_ids TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE account UUID; professional UUID; service UUID; product UUID; input UUID; booked JSONB; op UUID; proof UUID; result JSONB; working JSONB;
BEGIN
  account:=public.create_business('Sin configurar','General','USD','crm',gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF result->'config' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unconfigured business must return config:null'; END IF;
  account:=public.create_activity_business('Servicios y productos','Servicios','USD','crm',gen_random_uuid(),'generic','schedule',1,'["Consulta","Finalizado"]','services','["products"]','UTC','Barbero');
  INSERT INTO test_ids VALUES('account',account);
  SELECT jsonb_agg(jsonb_build_object('weekday',d,'start','09:00','end','18:00')) INTO working FROM generate_series(1,7) d;
  result:=public.ops_command(account,'professional',jsonb_build_object('name','Profesional Uno','linked_email','professional@example.com','hours',working,'service_bps',5000,'product_bps',1000),gen_random_uuid());
  professional:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('professional',professional);
  result:=public.ops_command(account,'product','{"name":"Producto vendido","price_minor":50000,"cost_minor":20000,"initial_stock":10}',gen_random_uuid());
  product:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('product',product);
  result:=public.ops_command(account,'product','{"name":"Insumo","price_minor":0,"cost_minor":10000,"initial_stock":20,"sellable":false}',gen_random_uuid());
  input:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('input',input);
  result:=public.ops_command(account,'service',jsonb_build_object('name','Servicio','price_minor',100000,'duration_minutes',30,'professional_ids',jsonb_build_array(professional),'inputs',jsonb_build_array(jsonb_build_object('product_id',input,'quantity',0.1))),gen_random_uuid());
  service:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('service',service);
  booked:=public.ops_command(account,'book',jsonb_build_object('professional_id',professional,'service_ids',jsonb_build_array(service),'starts_at',(current_date+1)::text||'T10:00:00Z','client_name','Cliente prueba','client_phone','+18095550000'),gen_random_uuid());
  op:=(booked->>'operation_id')::uuid; INSERT INTO test_ids VALUES('operation',op),('appointment',(booked->>'id')::uuid);
  -- Booking snapshots survive later catalog changes to price/duration/inputs.
  PERFORM public.ops_command(account,'service',jsonb_build_object('id',service,'name','Servicio actualizado','price_minor',120000,'duration_minutes',40,'professional_ids',jsonb_build_array(professional),'inputs',jsonb_build_array(jsonb_build_object('product_id',input,'quantity',0.2))),gen_random_uuid());
  BEGIN
    PERFORM public.ops_command(account,'book',jsonb_build_object('professional_id',professional,'service_ids',jsonb_build_array(service),'starts_at',(current_date+1)::text||'T10:15:00Z','client_name','Otro cliente','client_phone','+18095550001'),gen_random_uuid());
    RAISE EXCEPTION 'Overlapping booking accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  PERFORM public.ops_command(account,'payment',jsonb_build_object('operation_id',op,'amount_minor',50000,'method','cash'),gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF jsonb_array_length(result->'commissions')<>0 THEN RAISE EXCEPTION 'Advance generated commission before service'; END IF;
  PERFORM public.ops_command(account,'close',jsonb_build_object('operation_id',op,'items',jsonb_build_array(jsonb_build_object('kind','product','source_id',product,'quantity',1,'professional_id',professional))),gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF (result->'finance'->>'sales_minor')::bigint<>150000 OR (result->'finance'->>'receivable_minor')::bigint<>100000 THEN RAISE EXCEPTION 'Completed sale mistaken for full payment'; END IF;
  PERFORM public.ops_command(account,'payment',jsonb_build_object('operation_id',op,'amount_minor',40000,'method','cash'),gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF (result->'finance'->>'commission_minor')::bigint<>33000 OR (result->'finance'->>'receivable_minor')::bigint<>60000 THEN RAISE EXCEPTION 'Partial-payment commission mismatch'; END IF;
  result:=public.ops_command(account,'proof',jsonb_build_object('operation_id',op,'declared_minor',60000,'reference','BANK-1','file_path',account::text||'/11111111-1111-4111-8111-111111111111/example.pdf','file_hash','testhash'),gen_random_uuid());
  proof:=(result->>'id')::uuid; INSERT INTO test_ids VALUES('proof',proof);
  result:=public.ops_dashboard(account);
  IF (result->'finance'->>'collected_minor')::bigint<>90000 THEN RAISE EXCEPTION 'Pending proof credited cash'; END IF;
  PERFORM public.ops_command(account,'review_proof',jsonb_build_object('id',proof,'decision','confirm','verified_minor',60000,'note','Verificado en banco'),gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF (result->'finance'->>'commission_minor')::bigint<>55000 THEN RAISE EXCEPTION 'Confirmed proof not reflected'; END IF;
  PERFORM public.ops_command(account,'settle',jsonb_build_object('professional_id',professional,'amount_minor',55000,'reference','Liquidación manual'),gen_random_uuid());
  -- Rates change only for future operations; earlier snapshots remain 50%/10%.
  PERFORM public.ops_command(account,'professional',jsonb_build_object('id',professional,'name','Profesional Uno','linked_email','professional@example.com','hours',working,'service_bps',9000,'product_bps',9000),gen_random_uuid());
  result:=public.ops_dashboard(account);
  PERFORM public.ops_command(account,'refund',jsonb_build_object('operation_id',op,'refund_minor',50000,'note','Producto devuelto','lines',jsonb_build_array(jsonb_build_object('id',(SELECT (v->>'id')::uuid FROM jsonb_array_elements((SELECT x->'lines' FROM jsonb_array_elements(result->'operations') x WHERE x->>'id'=op::text)) v WHERE v->>'kind'='product'),'credit_minor',50000,'restock_quantity',1))),gen_random_uuid());
  result:=public.ops_dashboard(account);
  IF (result->'finance'->>'commission_minor')::bigint<>50000 OR (result->'professionals'->0->>'commission_balance')::bigint<>-5000 THEN RAISE EXCEPTION 'Refund did not create settlement adjustment'; END IF;
  -- Closing twice never repeats inventory or commission movements.
  PERFORM public.ops_command(account,'close',jsonb_build_object('operation_id',op,'items','[]'::jsonb),gen_random_uuid());
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT stock FROM ops_products WHERE id=(SELECT id FROM test_ids WHERE name='product'))<>10 OR (SELECT stock FROM ops_products WHERE id=(SELECT id FROM test_ids WHERE name='input'))<>19.9 THEN RAISE EXCEPTION 'Inventory duplicated or consumption incorrect'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
DO $$ DECLARE account UUID:=(SELECT id FROM test_ids WHERE name='account'); data JSONB; BEGIN
  data:=public.ops_dashboard(account);
  IF data->>'role'<>'professional' OR data ? 'finance' OR jsonb_array_length(data->'professionals')<>1 OR jsonb_array_length(data->'expenses')<>0 OR data->'products'->0->>'cost_minor' IS NOT NULL THEN RAISE EXCEPTION 'Professional saw global finances'; END IF;
  BEGIN PERFORM public.ops_command(account,'payment','{}',gen_random_uuid()); RAISE EXCEPTION 'Professional confirmed a payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.ops_payments; RAISE EXCEPTION 'Direct private table access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
DO $$ BEGIN
  BEGIN PERFORM public.ops_dashboard((SELECT id FROM test_ids WHERE name='account')); RAISE EXCEPTION 'Cross-business access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Operational lifecycle, partial payments, proofs, refunds, historical rates, stock and professional isolation passed' AS result;
