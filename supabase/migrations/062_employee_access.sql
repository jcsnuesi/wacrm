-- Employee invitations and editable module grants. Only registered, implemented
-- modules can be granted; adding a module requires its server-side integration.
BEGIN;

CREATE TABLE public.employee_module_catalog (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  position INTEGER NOT NULL, available BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO public.employee_module_catalog VALUES
 ('appointments','Mi agenda','Consultar y atender sus propias citas.',10,true),
 ('sales','Mis operaciones','Consultar y completar sus propias operaciones.',20,true),
 ('commissions','Mis comisiones','Consultar sus comisiones y liquidaciones.',30,true),
 ('proofs','Comprobantes','Adjuntar y consultar comprobantes de sus operaciones.',40,true),
 ('catalog','Catálogo','Consultar servicios asignados y productos disponibles, sin costos.',50,true);
ALTER TABLE public.employee_module_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_module_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.employee_module_catalog TO authenticated;
GRANT ALL ON public.employee_module_catalog TO postgres,service_role;
CREATE POLICY employee_modules_read ON public.employee_module_catalog FOR SELECT TO authenticated USING(true);

CREATE TABLE public.ops_employee_access (
  account_id UUID NOT NULL, professional_id UUID PRIMARY KEY,
  email TEXT NOT NULL CHECK(email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  status TEXT NOT NULL CHECK(status IN ('pending','active','suspended')),
  modules TEXT[] NOT NULL DEFAULT ARRAY['appointments','sales','commissions'],
  token_hash TEXT UNIQUE CHECK(token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  invitation_request_id UUID, expires_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  provision_user_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  accepted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(account_id,professional_id) REFERENCES public.ops_professionals(account_id,id),
  UNIQUE(account_id,email)
);
ALTER TABLE public.ops_employee_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_employee_access FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ops_employee_access TO postgres,service_role;
-- Existing linked professionals retain their current operational access.
INSERT INTO public.ops_employee_access(account_id,professional_id,email,status,modules,accepted_at)
 SELECT p.account_id,p.id,lower(u.email),'active',ARRAY['appointments','sales','commissions','proofs','catalog'],now()
 FROM public.ops_professionals p JOIN auth.users u ON u.id=p.linked_user_id WHERE u.email IS NOT NULL;

CREATE FUNCTION public.ops_employee_can(p_account UUID,p_module TEXT) RETURNS BOOLEAN
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.ops_employee_access e
 JOIN public.ops_professionals p ON p.id=e.professional_id AND p.account_id=e.account_id
 JOIN public.account_members m ON m.account_id=e.account_id AND m.user_id=p.linked_user_id
 JOIN public.employee_module_catalog c ON c.id=p_module AND c.available
 WHERE e.account_id=p_account AND p.linked_user_id=auth.uid() AND p.active
 AND m.role::text='professional' AND e.status='active' AND p_module=ANY(e.modules));
$$;
REVOKE ALL ON FUNCTION public.ops_employee_can(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ops_employee_can(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ops_role(p_account UUID) RETURNS TEXT
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN m.role::text='professional' AND NOT EXISTS(
   SELECT 1 FROM public.ops_professionals p JOIN public.ops_employee_access e ON e.professional_id=p.id AND e.account_id=p.account_id
   WHERE p.account_id=p_account AND p.linked_user_id=auth.uid() AND p.active AND e.status='active'
 ) THEN NULL ELSE m.role::text END
 FROM public.account_members m WHERE m.account_id=p_account AND m.user_id=auth.uid();
$$;

CREATE FUNCTION public.ops_employee_prepare(
 p_account UUID,p_professional UUID,p_email TEXT,p_modules TEXT[],p_mode TEXT,p_hash TEXT,p_request UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account,NULL,true); staff public.ops_professionals;
 e public.ops_employee_access; target_email TEXT:=lower(btrim(p_email)); renewal BOOLEAN;
BEGIN
 IF p_request IS NULL OR p_mode NOT IN ('save','invite','suspend') OR p_mode IS NULL THEN RAISE EXCEPTION 'Invalid access request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,42));
 SELECT * INTO staff FROM public.ops_professionals WHERE account_id=p_account AND id=p_professional FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Professional not found' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.ops_employee_access WHERE professional_id=p_professional FOR UPDATE;
 IF p_mode='suspend' THEN
   UPDATE public.ops_employee_access SET status='suspended',token_hash=NULL,expires_at=NULL,updated_at=now() WHERE professional_id=p_professional;
   INSERT INTO public.ops_audit(account_id,actor_id,action,resource_id) VALUES(p_account,auth.uid(),'employee_suspend',p_professional);
   RETURN jsonb_build_object('status','suspended','send_required',false);
 END IF;
 IF target_email IS NULL OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'Indica un correo válido para el empleado.' USING ERRCODE='22023'; END IF;
 IF p_modules IS NULL OR cardinality(p_modules)>32 OR EXISTS(SELECT 1 FROM unnest(p_modules) v WHERE v IS NULL OR NOT EXISTS(SELECT 1 FROM public.employee_module_catalog c WHERE c.id=v AND c.available)) OR cardinality(p_modules)<>(SELECT count(DISTINCT v) FROM unnest(p_modules) v) THEN RAISE EXCEPTION 'Selecciona módulos disponibles, sin duplicados.' USING ERRCODE='22023'; END IF;
 IF NOT staff.active THEN RAISE EXCEPTION 'Activa el perfil antes de habilitar su acceso.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users u JOIN public.account_members m ON m.user_id=u.id WHERE lower(u.email)=target_email AND m.account_id=p_account AND m.role::text<>'professional') THEN RAISE EXCEPTION 'Ese correo ya tiene otro rol en este negocio; sus permisos no se modificarán.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.ops_professionals p JOIN auth.users u ON u.id=p.linked_user_id WHERE p.account_id=p_account AND p.id<>p_professional AND lower(u.email)=target_email) THEN RAISE EXCEPTION 'Ese correo ya está vinculado a otro profesional.' USING ERRCODE='22023'; END IF;
 renewal:=e.professional_id IS NULL OR e.email<>target_email OR e.status='suspended' OR (p_mode='invite' AND e.status='pending' AND e.invitation_request_id IS DISTINCT FROM p_request);
 IF renewal THEN
   IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE='22023'; END IF;
   IF staff.linked_user_id IS NOT NULL THEN
     DELETE FROM public.account_members WHERE account_id=p_account AND user_id=staff.linked_user_id AND role::text='professional';
     UPDATE public.ops_professionals SET linked_user_id=NULL WHERE id=p_professional;
   END IF;
   INSERT INTO public.ops_employee_access(account_id,professional_id,email,status,modules,token_hash,invitation_request_id,expires_at)
   VALUES(p_account,p_professional,target_email,'pending',p_modules,p_hash,p_request,now()+interval '7 days')
   ON CONFLICT(professional_id) DO UPDATE SET email=EXCLUDED.email,status='pending',modules=EXCLUDED.modules,token_hash=EXCLUDED.token_hash,invitation_request_id=EXCLUDED.invitation_request_id,expires_at=EXCLUDED.expires_at,provision_user_id=EXCLUDED.provision_user_id,sent_at=NULL,accepted_at=NULL,updated_at=now();
 ELSE
   UPDATE public.ops_employee_access SET modules=p_modules,updated_at=now() WHERE professional_id=p_professional;
 END IF;
 SELECT * INTO e FROM public.ops_employee_access WHERE professional_id=p_professional;
 INSERT INTO public.ops_audit(account_id,actor_id,action,resource_id) VALUES(p_account,auth.uid(),'employee_'||p_mode,p_professional);
 RETURN jsonb_build_object('status',e.status,'email',e.email,'send_required',e.status='pending' AND e.sent_at IS NULL,'token_hash',e.token_hash,
 'request_id',e.invitation_request_id,'provision_user_id',e.provision_user_id,
 'auth_user_exists',EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e.email),
 'auth_user_confirmed',EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e.email AND email_confirmed_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.ops_employee_prepare(UUID,UUID,TEXT,TEXT[],TEXT,TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ops_employee_prepare(UUID,UUID,TEXT,TEXT[],TEXT,TEXT,UUID) TO authenticated;

CREATE FUNCTION public.ops_employee_delivery(p_account UUID,p_professional UUID,p_hash TEXT) RETURNS VOID
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.ops_assert(p_account,NULL,true);
 UPDATE public.ops_employee_access SET sent_at=now() WHERE account_id=p_account AND professional_id=p_professional AND token_hash=p_hash AND status='pending';
END $$;
REVOKE ALL ON FUNCTION public.ops_employee_delivery(UUID,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ops_employee_delivery(UUID,UUID,TEXT) TO authenticated;

CREATE FUNCTION public.ops_employee_accept(p_hash TEXT) RETURNS UUID
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.ops_employee_access; caller UUID:=auth.uid(); verified_email TEXT;
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'Inicia sesión para activar tu acceso.' USING ERRCODE='42501'; END IF;
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=caller AND email_confirmed_at IS NOT NULL;
 SELECT * INTO e FROM public.ops_employee_access WHERE token_hash=p_hash;
 IF NOT FOUND OR verified_email IS DISTINCT FROM e.email THEN RAISE EXCEPTION 'El enlace no corresponde a tu correo verificado.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.account_id::text,42));
 SELECT * INTO e FROM public.ops_employee_access WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR e.status='suspended' OR (e.status='pending' AND e.expires_at<=now()) OR NOT EXISTS(SELECT 1 FROM public.ops_professionals WHERE id=e.professional_id AND account_id=e.account_id AND active) THEN RAISE EXCEPTION 'El enlace expiró o el acceso fue suspendido. Solicita una nueva invitación.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_members WHERE account_id=e.account_id AND user_id=caller AND role::text<>'professional') THEN RAISE EXCEPTION 'Ya tienes otro rol en este negocio.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.ops_professionals WHERE id=e.professional_id AND linked_user_id IS NOT NULL AND linked_user_id<>caller) THEN RAISE EXCEPTION 'El acceso ya está vinculado.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.account_members(account_id,user_id,role) VALUES(e.account_id,caller,'professional') ON CONFLICT(account_id,user_id) DO NOTHING;
 UPDATE public.ops_professionals SET linked_user_id=caller WHERE id=e.professional_id;
 UPDATE public.ops_employee_access SET status='active',accepted_at=COALESCE(accepted_at,now()),updated_at=now() WHERE professional_id=e.professional_id;
 INSERT INTO public.ops_audit(account_id,actor_id,action,resource_id) VALUES(e.account_id,caller,'employee_activate',e.professional_id);
 RETURN e.account_id;
END $$;
REVOKE ALL ON FUNCTION public.ops_employee_accept(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ops_employee_accept(TEXT) TO authenticated;

-- Only Auth-admin creation using a private, reserved user ID may bootstrap an
-- employee profile. Public signup cannot choose its Auth ID. Auth sets metadata
-- and invited_at after INSERT, so neither is used to authorize provisioning.
CREATE OR REPLACE FUNCTION public.ops_guard_legacy_profile() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.account_role::text='professional' THEN
   IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM auth.users u JOIN public.ops_employee_access e ON e.email=lower(u.email)
     WHERE u.id=NEW.user_id AND u.id=e.provision_user_id AND e.account_id=NEW.account_id AND e.status='pending' AND e.expires_at>now()) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Vincula profesionales desde Operación, conservando sus otros negocios.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE full_name TEXT:=COALESCE(NEW.raw_user_meta_data->>'full_name',''); staff_name TEXT; business UUID;
BEGIN
   SELECT e.account_id,p.name INTO business,staff_name FROM public.ops_employee_access e JOIN public.ops_professionals p ON p.id=e.professional_id
   WHERE e.provision_user_id=NEW.id AND e.email=lower(NEW.email) AND e.status='pending' AND e.expires_at>now() ORDER BY e.updated_at,e.professional_id LIMIT 1;
 IF business IS NOT NULL THEN
   INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role) VALUES(NEW.id,staff_name,NEW.email,business,'professional');
   -- Activation links bind the user only after email verification.
   RETURN NEW;
 END IF;
 INSERT INTO public.accounts(name,owner_user_id) VALUES(COALESCE(NULLIF(full_name,''),NEW.email,'My account'),NEW.id) RETURNING id INTO business;
 INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role) VALUES(NEW.id,full_name,NEW.email,business,'owner');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

-- Core implementations and checked wrappers are appended below.
-- Stable record IDs make a failed multi-step save safe to retry. This is an ID,
-- not an authorization secret; invitation tokens use the server's keyed HMAC.
CREATE FUNCTION public.ops_employee_professional_id(p_account UUID,p_request UUID) RETURNS UUID
 LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT (substr(h,1,12)||'4'||substr(h,14,3)||'8'||substr(h,18,15))::uuid FROM (SELECT md5(p_account::text||p_request::text) h) q;
$$;
REVOKE ALL ON FUNCTION public.ops_employee_professional_id(UUID,UUID) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ops_command_core(p_account UUID,p_action TEXT,p_payload JSONB,p_request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account); admin_action BOOLEAN; result JSONB; saved public.ops_requests;
  resource UUID; linked UUID; old_link UUID; op public.ops_operations; proof public.ops_proofs;
  staff public.ops_professionals; product public.ops_products; appt public.ops_appointments; item JSONB; ids UUID[]; v_uuid UUID;
  amount BIGINT; paid BIGINT; note TEXT; qty NUMERIC; total_credit BIGINT:=0; total_cost BIGINT:=0; old_line public.ops_lines; delta_cost BIGINT;
BEGIN
  IF p_request_id IS NULL OR p_action IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  admin_action:=p_action=ANY(ARRAY['configure','professional','service','product','resource','stock','payment','review_proof','refund','settle','expense']);
  IF admin_action AND r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  IF r='viewer' THEN RAISE EXCEPTION 'Read only' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,42));
  SELECT * INTO saved FROM public.ops_requests WHERE account_id=p_account AND request_id=p_request_id;
  IF FOUND THEN
    IF saved.user_id IS DISTINCT FROM auth.uid() OR saved.action<>p_action THEN RAISE EXCEPTION 'Request key belongs to another action' USING ERRCODE='42501'; END IF;
    RETURN saved.result;
  END IF;
  resource:=NULL;
  CASE p_action
  WHEN 'configure' THEN
    IF p_payload->>'primary_activity' NOT IN ('services','products') OR p_payload->>'primary_activity' IS NULL THEN RAISE EXCEPTION 'Invalid activity' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(COALESCE(p_payload->'additional_activities','[]'))<>'array' OR jsonb_array_length(COALESCE(p_payload->'additional_activities','[]'))>1
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'additional_activities','[]')) a WHERE a NOT IN ('services','products') OR a=p_payload->>'primary_activity') THEN RAISE EXCEPTION 'Invalid additional activities' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_payload->>'timezone') THEN RAISE EXCEPTION 'Invalid timezone' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(COALESCE(p_payload->'disabled_modules','[]'))<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'disabled_modules','[]')) m WHERE m NOT IN ('appointments','products')) THEN RAISE EXCEPTION 'Solo agenda y venta de productos son módulos opcionales; finanzas e inventario conservan la integridad de la operación.' USING ERRCODE='22023'; END IF;
    IF p_payload->>'closing_stage_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id WHERE s.id=(p_payload->>'closing_stage_id')::uuid AND p.account_id=p_account) THEN RAISE EXCEPTION 'Invalid closing stage' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_config(account_id,primary_activity,additional_activities,timezone,professional_label,public_enabled,disabled_modules,closing_stage_id,currency)
      VALUES(p_account,p_payload->>'primary_activity',ARRAY(SELECT value FROM jsonb_array_elements_text(COALESCE(p_payload->'additional_activities','[]'))),p_payload->>'timezone',btrim(COALESCE(p_payload->>'professional_label','Profesional')),COALESCE((p_payload->>'public_enabled')::boolean,false),ARRAY(SELECT value FROM jsonb_array_elements_text(COALESCE(p_payload->'disabled_modules','[]'))),(p_payload->>'closing_stage_id')::uuid,(SELECT default_currency FROM public.accounts WHERE id=p_account))
      ON CONFLICT(account_id) DO UPDATE SET primary_activity=excluded.primary_activity,additional_activities=excluded.additional_activities,timezone=excluded.timezone,professional_label=excluded.professional_label,public_enabled=excluded.public_enabled,disabled_modules=excluded.disabled_modules,closing_stage_id=excluded.closing_stage_id;
    result:=jsonb_build_object('id',p_account);
  WHEN 'professional' THEN
    PERFORM public.ops_assert(p_account,'professionals',true);
    resource:=COALESCE((p_payload->>'id')::uuid,public.ops_employee_professional_id(p_account,p_request_id));
    SELECT linked_user_id INTO old_link FROM public.ops_professionals WHERE id=resource AND account_id=p_account;
    IF p_payload->>'id' IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Invalid professional' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(p_payload->'hours')<>'array' OR jsonb_array_length(p_payload->'hours')>7 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'hours') h WHERE (h->>'weekday')::int NOT BETWEEN 1 AND 7 OR h->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR h->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (h->>'start')::time >= (h->>'end')::time OR h->>'weekday' IS NULL OR h->>'start' IS NULL OR h->>'end' IS NULL)
      OR (SELECT count(DISTINCT h->>'weekday') FROM jsonb_array_elements(p_payload->'hours') h)<>jsonb_array_length(p_payload->'hours') THEN RAISE EXCEPTION 'Invalid working hours' USING ERRCODE='22023'; END IF;
    linked:=old_link;
    IF p_payload ? 'linked_email' THEN linked:=NULL; END IF;
    IF COALESCE(p_payload->>'linked_email','')<>'' THEN
      SELECT id INTO linked FROM auth.users WHERE lower(email)=lower(btrim(p_payload->>'linked_email'));
      IF NOT FOUND THEN RAISE EXCEPTION 'El profesional debe registrarse antes de vincular su correo.' USING ERRCODE='22023'; END IF;
      IF EXISTS(SELECT 1 FROM public.account_members WHERE account_id=p_account AND user_id=linked AND role::text<>'professional') OR EXISTS(SELECT 1 FROM public.profiles WHERE account_id=p_account AND user_id=linked AND account_role::text<>'professional') THEN RAISE EXCEPTION 'El usuario ya tiene otro rol en este negocio; no se cambiará su acceso automáticamente.' USING ERRCODE='22023'; END IF;
    END IF;
    IF COALESCE(p_payload->>'photo_url','')<>'' AND p_payload->>'photo_url' !~ '^https://' THEN RAISE EXCEPTION 'Usa una URL HTTPS para la foto.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_professionals(id,account_id,name,specialty,linked_user_id,active,service_bps,product_bps,hours,photo_url)
      VALUES(resource,p_account,btrim(p_payload->>'name'),left(COALESCE(p_payload->>'specialty',''),200),linked,COALESCE((p_payload->>'active')::boolean,true),(p_payload->>'service_bps')::int,(p_payload->>'product_bps')::int,p_payload->'hours',NULLIF(p_payload->>'photo_url',''))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,specialty=excluded.specialty,linked_user_id=excluded.linked_user_id,active=excluded.active,service_bps=excluded.service_bps,product_bps=excluded.product_bps,hours=excluded.hours,photo_url=excluded.photo_url;
    IF old_link IS NOT NULL AND old_link IS DISTINCT FROM linked THEN DELETE FROM public.account_members WHERE account_id=p_account AND user_id=old_link AND role::text='professional'; END IF;
    IF linked IS NOT NULL THEN INSERT INTO public.account_members(account_id,user_id,role) VALUES(p_account,linked,'professional') ON CONFLICT(account_id,user_id) DO NOTHING; END IF;
    result:=jsonb_build_object('id',resource);
  WHEN 'resource' THEN
    PERFORM public.ops_assert(p_account,'services',true);
    resource:=COALESCE((p_payload->>'id')::uuid,gen_random_uuid());
    IF p_payload->>'id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ops_resources WHERE id=resource AND account_id=p_account) THEN RAISE EXCEPTION 'Invalid resource' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_resources(id,account_id,name,active) VALUES(resource,p_account,btrim(p_payload->>'name'),COALESCE((p_payload->>'active')::boolean,true))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active;
    result:=jsonb_build_object('id',resource);
  WHEN 'service' THEN
    PERFORM public.ops_assert(p_account,'services',true);
    resource:=COALESCE((p_payload->>'id')::uuid,gen_random_uuid());
    IF p_payload->>'id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ops_services WHERE id=resource AND account_id=p_account) THEN RAISE EXCEPTION 'Invalid service' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_services(id,account_id,name,price_minor,duration_minutes,resource_id,active)
      VALUES(resource,p_account,btrim(p_payload->>'name'),(p_payload->>'price_minor')::bigint,(p_payload->>'duration_minutes')::int,(p_payload->>'resource_id')::uuid,COALESCE((p_payload->>'active')::boolean,true))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_minor=excluded.price_minor,duration_minutes=excluded.duration_minutes,resource_id=excluded.resource_id,active=excluded.active;
    DELETE FROM public.ops_professional_services WHERE account_id=p_account AND service_id=resource;
    FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'professional_ids','[]')) LOOP
      INSERT INTO public.ops_professional_services(account_id,professional_id,service_id) VALUES(p_account,(item#>>'{}')::uuid,resource);
    END LOOP;
    DELETE FROM public.ops_service_inputs WHERE account_id=p_account AND service_id=resource;
    FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'inputs','[]')) LOOP
      INSERT INTO public.ops_service_inputs(account_id,service_id,product_id,quantity) VALUES(p_account,resource,(item->>'product_id')::uuid,(item->>'quantity')::numeric);
    END LOOP;
    result:=jsonb_build_object('id',resource);
  WHEN 'product' THEN
    PERFORM public.ops_assert(p_account,'inventory',true);
    IF COALESCE((p_payload->>'initial_stock')::numeric,0)<0 THEN RAISE EXCEPTION 'La existencia inicial no puede ser negativa.' USING ERRCODE='22023'; END IF;
    resource:=COALESCE((p_payload->>'id')::uuid,gen_random_uuid());
    IF p_payload->>'id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ops_products WHERE id=resource AND account_id=p_account) THEN RAISE EXCEPTION 'Invalid product' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_products(id,account_id,name,sku,price_minor,cost_minor,sellable,active)
      VALUES(resource,p_account,btrim(p_payload->>'name'),left(COALESCE(p_payload->>'sku',''),80),(p_payload->>'price_minor')::bigint,(p_payload->>'cost_minor')::bigint,COALESCE((p_payload->>'sellable')::boolean,true),COALESCE((p_payload->>'active')::boolean,true))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,price_minor=excluded.price_minor,cost_minor=excluded.cost_minor,sellable=excluded.sellable,active=excluded.active;
    IF p_payload->>'id' IS NULL AND COALESCE((p_payload->>'initial_stock')::numeric,0)>0 THEN PERFORM public.ops_move_stock(p_account,resource,(p_payload->>'initial_stock')::numeric,'entry',NULL,NULL,'Existencia inicial'); END IF;
    result:=jsonb_build_object('id',resource);
  WHEN 'stock' THEN
    PERFORM public.ops_assert(p_account,'inventory',true);
    IF length(btrim(COALESCE(p_payload->>'note','')))=0 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
    PERFORM public.ops_move_stock(p_account,(p_payload->>'product_id')::uuid,(p_payload->>'quantity')::numeric,CASE WHEN (p_payload->>'quantity')::numeric>0 THEN 'entry' ELSE 'adjustment' END,NULL,NULL,p_payload->>'note');
    result:=jsonb_build_object('id',p_payload->>'product_id');
  WHEN 'book' THEN
    PERFORM public.ops_assert(p_account,'appointments'); result:=public.ops_book(p_account,p_payload,false);
  WHEN 'appointment_status' THEN
    PERFORM public.ops_assert(p_account,'appointments');
    SELECT * INTO appt FROM public.ops_appointments WHERE account_id=p_account AND id=(p_payload->>'id')::uuid;
    IF NOT FOUND OR (r='professional' AND NOT EXISTS(SELECT 1 FROM public.ops_professionals WHERE id=appt.professional_id AND linked_user_id=auth.uid() AND active)) THEN RAISE EXCEPTION 'Not your appointment' USING ERRCODE='42501'; END IF;
    IF p_payload->>'status' NOT IN ('in_progress','canceled','no_show') OR p_payload->>'status' IS NULL OR appt.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Invalid appointment transition' USING ERRCODE='22023'; END IF;
    IF p_payload->>'status' IN ('canceled','no_show') AND (SELECT COALESCE(sum(p.amount_minor),0) FROM public.ops_payments p JOIN public.ops_operations o ON o.id=p.operation_id WHERE o.appointment_id=appt.id)>0 THEN RAISE EXCEPTION 'Registra la devolución del anticipo antes de cancelar.' USING ERRCODE='22023'; END IF;
    UPDATE public.ops_appointments SET status=p_payload->>'status' WHERE id=appt.id;
    IF p_payload->>'status' IN ('canceled','no_show') THEN UPDATE public.ops_operations SET status='void' WHERE appointment_id=appt.id; END IF;
    result:=jsonb_build_object('id',appt.id);
  WHEN 'close' THEN result:=public.ops_close(p_account,p_payload);
  WHEN 'payment' THEN
    PERFORM public.ops_assert(p_account,'finance',true);
    SELECT * INTO op FROM public.ops_operations WHERE account_id=p_account AND id=(p_payload->>'operation_id')::uuid FOR UPDATE;
    IF NOT FOUND OR op.status='void' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
    amount:=(p_payload->>'amount_minor')::bigint;
    SELECT COALESCE(sum(amount_minor),0) INTO paid FROM public.ops_payments WHERE operation_id=op.id;
    IF amount IS NULL OR amount<=0 OR amount>op.total_minor-paid OR p_payload->>'method' IS NULL OR p_payload->>'method' NOT IN ('cash','transfer','card') THEN RAISE EXCEPTION 'Importe o método inválido; el cobro no puede superar el saldo.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_payments(account_id,operation_id,amount_minor,method,reference,confirmed_by)
      VALUES(p_account,op.id,amount,p_payload->>'method',left(COALESCE(p_payload->>'reference',''),100),auth.uid()) RETURNING id INTO resource;
    PERFORM public.ops_recalculate(op.id); result:=jsonb_build_object('id',resource);
  WHEN 'proof' THEN
    PERFORM public.ops_assert(p_account,'finance');
    SELECT * INTO op FROM public.ops_operations WHERE account_id=p_account AND id=(p_payload->>'operation_id')::uuid;
    IF NOT FOUND OR op.status='void' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
    IF r='professional' AND NOT EXISTS(SELECT 1 FROM public.ops_appointments a JOIN public.ops_professionals s ON s.id=a.professional_id WHERE a.id=op.appointment_id AND s.linked_user_id=auth.uid() AND s.active) AND NOT EXISTS(SELECT 1 FROM public.ops_lines l JOIN public.ops_professionals s ON s.id=l.professional_id WHERE l.operation_id=op.id AND s.linked_user_id=auth.uid() AND s.active) THEN RAISE EXCEPTION 'Not your operation' USING ERRCODE='42501'; END IF;
    IF p_payload->>'file_path' IS NOT NULL AND left(p_payload->>'file_path',74)<>p_account::text||'/'||auth.uid()::text||'/' THEN RAISE EXCEPTION 'Invalid private file' USING ERRCODE='42501'; END IF;
    IF r='professional' AND p_payload->>'source_message_id' IS NOT NULL THEN RAISE EXCEPTION 'Sube tu propio comprobante; no tienes acceso al inbox general.' USING ERRCODE='42501'; END IF;
    IF p_payload->>'source_message_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE m.id=(p_payload->>'source_message_id')::uuid AND c.account_id=p_account AND m.content_type IN ('image','document')) THEN RAISE EXCEPTION 'Invalid source message' USING ERRCODE='42501'; END IF;
    IF length(COALESCE(p_payload->>'reference',''))>100 OR length(COALESCE(p_payload->>'bank',''))>100 THEN RAISE EXCEPTION 'Reference too long' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_proofs(account_id,operation_id,submitted_by,declared_minor,reference,bank,declared_date,file_path,file_hash,source_message_id)
      VALUES(p_account,op.id,auth.uid(),(p_payload->>'declared_minor')::bigint,COALESCE(p_payload->>'reference',''),COALESCE(p_payload->>'bank',''),(p_payload->>'declared_date')::date,p_payload->>'file_path',p_payload->>'file_hash',(p_payload->>'source_message_id')::uuid) RETURNING id INTO resource;
    result:=jsonb_build_object('id',resource,'status','pending','duplicate_warning',EXISTS(SELECT 1 FROM public.ops_proofs q WHERE q.account_id=p_account AND q.id<>resource AND ((q.file_hash=p_payload->>'file_hash' AND q.file_hash IS NOT NULL) OR (q.reference=p_payload->>'reference' AND q.reference<>''))));
  WHEN 'review_proof' THEN
    PERFORM public.ops_assert(p_account,'finance',true);
    SELECT * INTO proof FROM public.ops_proofs WHERE account_id=p_account AND id=(p_payload->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR proof.status<>'pending' THEN RAISE EXCEPTION 'Comprobante ya revisado o inexistente' USING ERRCODE='22023'; END IF;
    IF length(btrim(COALESCE(p_payload->>'note','')))=0 OR p_payload->>'decision' IS NULL OR p_payload->>'decision' NOT IN ('confirm','reject') THEN RAISE EXCEPTION 'Review decision and note required' USING ERRCODE='22023'; END IF;
    IF p_payload->>'decision'='confirm' THEN
      IF EXISTS(SELECT 1 FROM public.ops_proofs q WHERE q.account_id=p_account AND q.id<>proof.id AND q.status='confirmed' AND ((q.file_hash=proof.file_hash AND proof.file_hash IS NOT NULL) OR (q.source_message_id=proof.source_message_id AND proof.source_message_id IS NOT NULL))) THEN RAISE EXCEPTION 'Este archivo o mensaje ya acredita otro cobro.' USING ERRCODE='23505'; END IF;
      IF proof.reference<>'' AND EXISTS(SELECT 1 FROM public.ops_proofs q WHERE q.account_id=p_account AND q.id<>proof.id AND q.reference=proof.reference) AND NOT COALESCE((p_payload->>'acknowledge_duplicate')::boolean,false) THEN RAISE EXCEPTION 'Revisa la referencia repetida y confirma explícitamente que es otro pago.' USING ERRCODE='22023'; END IF;
      SELECT * INTO op FROM public.ops_operations WHERE id=proof.operation_id FOR UPDATE;
      SELECT COALESCE(sum(amount_minor),0) INTO paid FROM public.ops_payments WHERE operation_id=op.id;
      amount:=(p_payload->>'verified_minor')::bigint;
      IF op.status='void' OR amount IS NULL OR amount<=0 OR amount>op.total_minor-paid THEN RAISE EXCEPTION 'El importe verificado supera el saldo o no es válido.' USING ERRCODE='22023'; END IF;
      INSERT INTO public.ops_payments(account_id,operation_id,amount_minor,method,reference,confirmed_by) VALUES(p_account,op.id,amount,'transfer',proof.reference,auth.uid()) RETURNING id INTO resource;
      UPDATE public.ops_proofs SET status='confirmed',reviewed_by=auth.uid(),reviewed_at=now(),payment_id=resource,review_note=left(p_payload->>'note',500) WHERE id=proof.id;
      PERFORM public.ops_recalculate(op.id);
    ELSE UPDATE public.ops_proofs SET status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_payload->>'note',500) WHERE id=proof.id; END IF;
    result:=jsonb_build_object('id',proof.id);
  WHEN 'refund' THEN
    PERFORM public.ops_assert(p_account,'finance',true);
    SELECT * INTO op FROM public.ops_operations WHERE account_id=p_account AND id=(p_payload->>'operation_id')::uuid FOR UPDATE;
    IF NOT FOUND OR op.status='void' OR length(btrim(COALESCE(p_payload->>'note','')))=0 THEN RAISE EXCEPTION 'Operation and reason required' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(sum(amount_minor),0) INTO paid FROM public.ops_payments WHERE operation_id=op.id;
    amount:=COALESCE((p_payload->>'refund_minor')::bigint,0);
    IF amount<0 OR amount>paid THEN RAISE EXCEPTION 'La devolución supera lo cobrado.' USING ERRCODE='22023'; END IF;
    IF op.status='open' THEN
      IF amount=0 OR jsonb_array_length(COALESCE(p_payload->'lines','[]'))<>0 THEN RAISE EXCEPTION 'Invalid advance refund' USING ERRCODE='22023'; END IF;
    ELSE
      IF jsonb_array_length(COALESCE(p_payload->'lines','[]'))=0 THEN RAISE EXCEPTION 'Indica los conceptos que se devuelven.' USING ERRCODE='22023'; END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
        SELECT * INTO old_line FROM public.ops_lines WHERE account_id=p_account AND operation_id=op.id AND id=(item->>'id')::uuid FOR UPDATE;
        IF NOT FOUND OR (item->>'credit_minor')::bigint IS NULL OR (item->>'credit_minor')::bigint<=0 OR (item->>'credit_minor')::bigint>old_line.net_minor-old_line.credited_minor THEN RAISE EXCEPTION 'Invalid credit line' USING ERRCODE='22023'; END IF;
        qty:=COALESCE((item->>'restock_quantity')::numeric,0); delta_cost:=0;
        IF qty<0 OR qty>old_line.quantity-old_line.returned_quantity OR (old_line.kind<>'product' AND qty<>0) THEN RAISE EXCEPTION 'Invalid physical return' USING ERRCODE='22023'; END IF;
        IF qty>0 THEN
          PERFORM public.ops_move_stock(p_account,old_line.source_id,qty,'return',op.id,old_line.professional_id,p_payload->>'note',round(old_line.cost_minor/old_line.quantity)::bigint);
          delta_cost:=LEAST(old_line.cost_minor-old_line.credited_cost_minor,round(old_line.cost_minor*qty/old_line.quantity)::bigint);
        END IF;
        UPDATE public.ops_lines SET credited_minor=credited_minor+(item->>'credit_minor')::bigint,returned_quantity=returned_quantity+qty,credited_cost_minor=credited_cost_minor+delta_cost WHERE id=old_line.id;
        total_credit:=total_credit+(item->>'credit_minor')::bigint; total_cost:=total_cost+delta_cost;
      END LOOP;
      IF amount>total_credit OR paid-amount>op.total_minor-total_credit THEN RAISE EXCEPTION 'El crédito y la devolución deben mantener el saldo consistente.' USING ERRCODE='22023'; END IF;
      UPDATE public.ops_operations SET total_minor=total_minor-total_credit WHERE id=op.id;
      INSERT INTO public.ops_adjustments(account_id,operation_id,amount_minor,cost_minor,note,created_by,details) VALUES(p_account,op.id,total_credit,total_cost,left(p_payload->>'note',500),auth.uid(),p_payload->'lines');
    END IF;
    IF amount>0 THEN INSERT INTO public.ops_payments(account_id,operation_id,amount_minor,method,reference,confirmed_by) VALUES(p_account,op.id,-amount,'refund',left(p_payload->>'note',100),auth.uid()) RETURNING id INTO resource; END IF;
    PERFORM public.ops_recalculate(op.id); result:=jsonb_build_object('id',op.id);
  WHEN 'settle' THEN
    PERFORM public.ops_assert(p_account,'commissions',true);
    SELECT * INTO staff FROM public.ops_professionals WHERE id=(p_payload->>'professional_id')::uuid AND account_id=p_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid professional' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(sum(amount_minor),0) INTO paid FROM public.ops_commissions WHERE account_id=p_account AND professional_id=staff.id;
    paid:=paid-(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_settlements WHERE account_id=p_account AND professional_id=staff.id);
    amount:=(p_payload->>'amount_minor')::bigint;
    IF amount IS NULL OR amount<=0 OR amount>paid OR length(btrim(COALESCE(p_payload->>'reference','')))=0 THEN RAISE EXCEPTION 'La liquidación debe ser positiva y no superar la comisión pendiente.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_settlements(account_id,professional_id,amount_minor,reference,recorded_by) VALUES(p_account,staff.id,amount,left(p_payload->>'reference',100),auth.uid()) RETURNING id INTO resource;
    result:=jsonb_build_object('id',resource);
  WHEN 'expense' THEN
    PERFORM public.ops_assert(p_account,'finance',true);
    IF length(btrim(COALESCE(p_payload->>'category','')))=0 THEN RAISE EXCEPTION 'Expense category required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_expenses(account_id,amount_minor,category,note,recorded_by) VALUES(p_account,(p_payload->>'amount_minor')::bigint,left(p_payload->>'category',80),left(COALESCE(p_payload->>'note',''),500),auth.uid()) RETURNING id INTO resource;
    result:=jsonb_build_object('id',resource);
  ELSE RAISE EXCEPTION 'Unknown operation command' USING ERRCODE='22023'; END CASE;
  INSERT INTO public.ops_requests(account_id,request_id,user_id,action,result) VALUES(p_account,p_request_id,auth.uid(),p_action,result);
  INSERT INTO public.ops_audit(account_id,actor_id,action,resource_id) VALUES(p_account,auth.uid(),p_action,COALESCE(resource,(result->>'id')::uuid));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ops_command_core(UUID,TEXT,JSONB,UUID) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ops_dashboard_core(p_account UUID,p_month TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account); cfg public.ops_config; staff_id UUID; month_start TIMESTAMPTZ; month_end TIMESTAMPTZ; m TEXT; admin BOOLEAN:=r IN ('owner','admin'); result JSONB;
BEGIN
  SELECT * INTO cfg FROM public.ops_config WHERE account_id=p_account;
  m:=COALESCE(p_month,to_char(now() AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo'),'YYYY-MM'));
  IF m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023'; END IF;
  month_start:=(m||'-01')::timestamp AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo');
  month_end:=((m||'-01')::date+interval '1 month') AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo');
  IF r='professional' THEN SELECT id INTO staff_id FROM public.ops_professionals WHERE account_id=p_account AND linked_user_id=auth.uid() AND active; END IF;
  result:=jsonb_build_object('role',r,'account_id',p_account,'month',m,'config',CASE WHEN cfg.account_id IS NULL THEN NULL ELSE to_jsonb(cfg) END,
    'currency',(SELECT default_currency FROM public.accounts WHERE id=p_account),
    'professionals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'specialty',s.specialty,'photo_url',s.photo_url,'active',s.active,'hours',s.hours,
      'service_bps',CASE WHEN admin OR s.id=staff_id THEN s.service_bps END,'product_bps',CASE WHEN admin OR s.id=staff_id THEN s.product_bps END,
      'linked_email',CASE WHEN admin THEN (SELECT email FROM auth.users WHERE id=s.linked_user_id) END,
      'service_count',(SELECT COALESCE(sum(l.quantity),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE l.professional_id=s.id AND l.kind='service' AND o.closed_at>=month_start AND o.closed_at<month_end),
      'product_count',(SELECT COALESCE(sum(l.quantity),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE l.professional_id=s.id AND l.kind='product' AND o.closed_at>=month_start AND o.closed_at<month_end),
      'commission_month',CASE WHEN admin OR s.id=staff_id THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_commissions WHERE professional_id=s.id AND created_at>=month_start AND created_at<month_end) END,
      'commission_balance',CASE WHEN admin OR s.id=staff_id THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_commissions WHERE professional_id=s.id)-(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_settlements WHERE professional_id=s.id) END,
      'collected_month',CASE WHEN admin OR s.id=staff_id THEN (SELECT COALESCE(sum(public.ops_line_collected(l.id)),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE l.professional_id=s.id AND o.closed_at>=month_start AND o.closed_at<month_end) END
    ) ORDER BY s.name) FROM public.ops_professionals s WHERE s.account_id=p_account AND (r<>'professional' OR s.id=staff_id)),'[]'),
    'services',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('professional_ids',COALESCE((SELECT jsonb_agg(professional_id) FROM public.ops_professional_services WHERE service_id=s.id),'[]'),
      'inputs',CASE WHEN admin THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity)) FROM public.ops_service_inputs WHERE service_id=s.id),'[]') ELSE '[]'::jsonb END) ORDER BY s.name) FROM public.ops_services s WHERE s.account_id=p_account),'[]'),
    'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'stock',stock,'price_minor',price_minor,'cost_minor',CASE WHEN admin THEN cost_minor END,'active',active,'sellable',sellable) ORDER BY name) FROM public.ops_products WHERE account_id=p_account),'[]'),
    'resources',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY name) FROM public.ops_resources x WHERE account_id=p_account),'[]'),
    'appointments',COALESCE((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('operation_id',o.id) ORDER BY a.starts_at) FROM (SELECT * FROM public.ops_appointments WHERE account_id=p_account AND starts_at>=month_start AND starts_at<month_end AND (r<>'professional' OR professional_id=staff_id) ORDER BY starts_at LIMIT 500) a JOIN public.ops_operations o ON o.appointment_id=a.id),'[]'),
    'operations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'appointment_id',o.appointment_id,'client_name',o.client_name,'status',o.status,'currency',o.currency,'closed_at',o.closed_at,'created_at',o.created_at,
      'total_minor',CASE WHEN r<>'professional' OR o.status='open' THEN o.total_minor ELSE (SELECT COALESCE(sum(net_minor-credited_minor),0) FROM public.ops_lines WHERE operation_id=o.id AND professional_id=staff_id) END,
      'collected_minor',CASE WHEN r<>'professional' OR o.status='open' THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_payments WHERE operation_id=o.id) ELSE CASE WHEN o.total_minor>0 THEN round((SELECT COALESCE(sum(amount_minor),0) FROM public.ops_payments WHERE operation_id=o.id)::numeric*(SELECT COALESCE(sum(net_minor-credited_minor),0) FROM public.ops_lines WHERE operation_id=o.id AND professional_id=staff_id)/o.total_minor) ELSE 0 END END,
      'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l)-CASE WHEN admin THEN '' ELSE 'cost_minor' END-'credited_cost_minor') FROM public.ops_lines l WHERE l.operation_id=o.id AND (r<>'professional' OR l.professional_id=staff_id)),'[]')
    ) ORDER BY o.created_at DESC) FROM (SELECT x.* FROM public.ops_operations x WHERE x.account_id=p_account AND
      (x.status='open' OR (x.closed_at>=month_start AND x.closed_at<month_end)) AND (r<>'professional' OR EXISTS(SELECT 1 FROM public.ops_appointments a WHERE a.id=x.appointment_id AND a.professional_id=staff_id) OR EXISTS(SELECT 1 FROM public.ops_lines l WHERE l.operation_id=x.id AND l.professional_id=staff_id)) ORDER BY created_at DESC LIMIT 500) o),'[]'),
    'proofs',COALESCE((SELECT jsonb_agg((to_jsonb(q)-'file_path'-'file_hash')||jsonb_build_object('duplicate_warning',EXISTS(SELECT 1 FROM public.ops_proofs other WHERE other.account_id=p_account AND other.id<>q.id AND ((other.file_hash=q.file_hash AND q.file_hash IS NOT NULL) OR (other.reference=q.reference AND q.reference<>''))))) FROM (SELECT * FROM public.ops_proofs WHERE account_id=p_account AND (r<>'professional' OR submitted_by=auth.uid()) ORDER BY created_at DESC LIMIT 200) q),'[]'),
    'payments',CASE WHEN r<>'professional' THEN COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.ops_payments WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end ORDER BY created_at DESC LIMIT 500) q),'[]') ELSE '[]'::jsonb END,
    'commissions',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.ops_commissions WHERE account_id=p_account AND (admin OR professional_id=staff_id) AND created_at>=month_start AND created_at<month_end ORDER BY created_at DESC LIMIT 500) q),'[]'),
    'settlements',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.ops_settlements WHERE account_id=p_account AND (admin OR professional_id=staff_id) AND created_at>=month_start AND created_at<month_end ORDER BY created_at DESC LIMIT 500) q),'[]'),
    'stock_movements',COALESCE((SELECT jsonb_agg(to_jsonb(q)-CASE WHEN admin THEN '' ELSE 'unit_cost_minor' END) FROM (SELECT * FROM public.ops_stock_movements WHERE account_id=p_account AND (r<>'professional' OR professional_id=staff_id) AND created_at>=month_start AND created_at<month_end ORDER BY created_at DESC LIMIT 500) q),'[]'),
    'expenses',CASE WHEN admin THEN COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.ops_expenses WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end ORDER BY created_at DESC LIMIT 500) q),'[]') ELSE '[]'::jsonb END,
    'stages',CASE WHEN admin THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',p.name||' · '||s.name)) FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id WHERE p.account_id=p_account),'[]') ELSE '[]'::jsonb END,
    'deals',CASE WHEN r IN ('owner','admin','agent') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title)) FROM (SELECT * FROM public.deals WHERE account_id=p_account AND status='open' ORDER BY created_at DESC LIMIT 100) d),'[]') ELSE '[]'::jsonb END
  );
  IF r<>'professional' THEN result:=result||jsonb_build_object('finance',jsonb_build_object(
    'sales_minor',(SELECT COALESCE(sum(l.net_minor),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE o.account_id=p_account AND o.closed_at>=month_start AND o.closed_at<month_end),
    'credits_minor',(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_adjustments WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end),
    'collected_minor',(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_payments WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end),
    'receivable_minor',(SELECT COALESCE(sum(o.total_minor-(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_payments WHERE operation_id=o.id)),0) FROM public.ops_operations o WHERE o.account_id=p_account AND o.status='completed'),
    'advances_minor',(SELECT COALESCE(sum(p.amount_minor),0) FROM public.ops_payments p JOIN public.ops_operations o ON o.id=p.operation_id WHERE o.account_id=p_account AND o.status='open'),
    'cost_minor',CASE WHEN admin THEN (SELECT COALESCE(sum(l.cost_minor),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE o.account_id=p_account AND o.closed_at>=month_start AND o.closed_at<month_end)-(SELECT COALESCE(sum(cost_minor),0) FROM public.ops_adjustments WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end) END,
    'commission_minor',CASE WHEN admin THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_commissions WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end) END,
    'expense_minor',CASE WHEN admin THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_expenses WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end) END,
    'settled_minor',CASE WHEN admin THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_settlements WHERE account_id=p_account AND created_at>=month_start AND created_at<month_end) END
  )); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ops_dashboard_core(UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ops_command(p_account UUID,p_action TEXT,p_payload JSONB,p_request_id UUID)
 RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account); needed TEXT;
BEGIN
 IF p_action='professional' AND p_payload ? 'linked_email' THEN RAISE EXCEPTION 'Gestiona el correo desde Acceso y permisos.' USING ERRCODE='22023'; END IF;
 IF r='professional' THEN
   needed:=CASE p_action WHEN 'book' THEN 'appointments' WHEN 'appointment_status' THEN 'appointments' WHEN 'close' THEN 'sales' WHEN 'proof' THEN 'proofs' END;
   IF needed IS NULL OR NOT public.ops_employee_can(p_account,needed) THEN RAISE EXCEPTION 'Tu acceso no permite esta acción.' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN public.ops_command_core(p_account,p_action,p_payload,p_request_id);
END $$;

CREATE FUNCTION public.ops_employee_save(p_account UUID,p_payload JSONB,p_access JSONB,p_request UUID,p_hash TEXT)
 RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account,NULL,true); professional JSONB; access JSONB; modules TEXT[];
BEGIN
 IF jsonb_typeof(p_access) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Revisa el acceso del empleado.' USING ERRCODE='22023'; END IF;
 professional:=public.ops_command_core(p_account,'professional',p_payload-'linked_email'-'employee_access',p_request);
 IF p_access->>'mode'<>'suspend' THEN modules:=ARRAY(SELECT jsonb_array_elements_text(p_access->'modules')); END IF;
 access:=public.ops_employee_prepare(p_account,(professional->>'id')::uuid,p_access->>'email',modules,p_access->>'mode',p_hash,p_request);
 RETURN jsonb_build_object('professional',professional,'access',access);
END $$;
REVOKE ALL ON FUNCTION public.ops_employee_save(UUID,JSONB,JSONB,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ops_employee_save(UUID,JSONB,JSONB,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ops_dashboard(p_account UUID,p_month TEXT DEFAULT NULL)
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB:=public.ops_dashboard_core(p_account,p_month); e public.ops_employee_access; staff UUID; allowed TEXT[];
BEGIN
 IF result->>'role'='professional' THEN
   SELECT p.id INTO staff FROM public.ops_professionals p WHERE p.account_id=p_account AND p.linked_user_id=auth.uid() AND p.active;
   SELECT * INTO e FROM public.ops_employee_access WHERE professional_id=staff;
   SELECT COALESCE(array_agg(c.id ORDER BY c.position),'{}') INTO allowed FROM public.employee_module_catalog c WHERE c.available AND c.id=ANY(e.modules);
   result:=result||jsonb_build_object('allowed_modules',allowed);
   IF NOT 'appointments'=ANY(allowed) THEN result:=result||'{"appointments":[]}'::jsonb; END IF;
   IF NOT 'sales'=ANY(allowed) AND NOT 'proofs'=ANY(allowed) THEN result:=result||'{"operations":[]}'::jsonb; END IF;
   IF NOT 'proofs'=ANY(allowed) THEN result:=result||'{"proofs":[]}'::jsonb; END IF;
   result:=result||'{"stock_movements":[],"resources":[],"deals":[],"stages":[]}'::jsonb;
   IF NOT 'commissions'=ANY(allowed) THEN
     result:=result||'{"commissions":[],"settlements":[]}'::jsonb;
     result:=jsonb_set(result,'{professionals}',COALESCE((SELECT jsonb_agg(p||'{"service_bps":null,"product_bps":null,"commission_month":null,"commission_balance":null,"collected_month":null}') FROM jsonb_array_elements(result->'professionals') p),'[]'));
     result:=jsonb_set(result,'{operations}',COALESCE((SELECT jsonb_agg(jsonb_set(o,'{lines}',COALESCE((SELECT jsonb_agg(l-'commission_bps') FROM jsonb_array_elements(o->'lines') l),'[]'))) FROM jsonb_array_elements(result->'operations') o),'[]'));
   END IF;
   IF 'catalog'=ANY(allowed) OR 'appointments'=ANY(allowed) OR 'sales'=ANY(allowed) THEN
     result:=jsonb_set(result,'{services}',COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(result->'services') s WHERE s->'professional_ids' ? staff::text),'[]'));
   ELSE result:=result||'{"services":[]}'::jsonb; END IF;
   IF NOT 'catalog'=ANY(allowed) AND NOT 'sales'=ANY(allowed) THEN result:=result||'{"products":[]}'::jsonb; END IF;
 ELSE
   result:=result||jsonb_build_object('employee_modules',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description) ORDER BY position) FROM public.employee_module_catalog WHERE available),'[]'));
   IF result->>'role' IN ('owner','admin') THEN
     result:=jsonb_set(result,'{professionals}',COALESCE((SELECT jsonb_agg(p||jsonb_build_object('access',
       (SELECT jsonb_build_object('email',a.email,'status',a.status,'modules',a.modules,'sent_at',a.sent_at,'expires_at',a.expires_at)
        FROM public.ops_employee_access a WHERE a.professional_id=(p->>'id')::uuid AND a.account_id=p_account)))
       FROM jsonb_array_elements(result->'professionals') p),'[]'));
   END IF;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.ops_proof_file(p_account UUID,p_id UUID) RETURNS JSONB
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account,'finance'); proof public.ops_proofs;
BEGIN
 IF r='professional' AND NOT public.ops_employee_can(p_account,'proofs') THEN RAISE EXCEPTION 'Comprobantes no habilitados.' USING ERRCODE='42501'; END IF;
 SELECT * INTO proof FROM public.ops_proofs WHERE account_id=p_account AND id=p_id;
 IF NOT FOUND OR (r NOT IN ('owner','admin') AND proof.submitted_by<>auth.uid()) THEN RAISE EXCEPTION 'Comprobante no disponible' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('file_path',proof.file_path,'source_url',(SELECT media_url FROM public.messages WHERE id=proof.source_message_id));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
