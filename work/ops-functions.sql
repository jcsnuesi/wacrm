\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION public.ops_role(p_account UUID) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN m.role::text='professional' AND NOT EXISTS(SELECT 1 FROM public.ops_professionals s WHERE s.account_id=p_account AND s.linked_user_id=auth.uid() AND s.active) THEN NULL ELSE m.role::text END
  FROM public.account_members m WHERE m.account_id=p_account AND m.user_id=auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.ops_crm_active(p_account UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.account_subscriptions s WHERE s.account_id=p_account AND
    s.status IN ('active','trialing','past_due') AND (s.access_until IS NULL OR s.access_until>now())
    AND (s.status='active' OR s.access_until IS NOT NULL));
$$;
CREATE OR REPLACE FUNCTION public.ops_assert(p_account UUID,p_module TEXT DEFAULT NULL,p_admin BOOLEAN DEFAULT false) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_role(p_account); c public.ops_config;
BEGIN
  IF r IS NULL OR (p_admin AND r NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE='42501'; END IF;
  IF NOT public.ops_crm_active(p_account) THEN RAISE EXCEPTION 'CRM subscription is not active' USING ERRCODE='42501'; END IF;
  IF p_module IS NOT NULL THEN
    SELECT * INTO c FROM public.ops_config WHERE account_id=p_account;
    IF NOT FOUND OR p_module=ANY(c.disabled_modules)
      OR (p_module IN ('services','appointments') AND c.primary_activity<>'services' AND NOT 'services'=ANY(c.additional_activities))
      OR (p_module='products' AND c.primary_activity<>'products' AND NOT 'products'=ANY(c.additional_activities)) THEN
      RAISE EXCEPTION 'Module disabled for this business' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.ops_recalculate(p_operation UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE op public.ops_operations; paid BIGINT; target BIGINT; previous BIGINT; row RECORD;
BEGIN
  SELECT * INTO op FROM public.ops_operations WHERE id=p_operation;
  IF op.status<>'completed' THEN RETURN; END IF;
  SELECT COALESCE(sum(amount_minor),0) INTO paid FROM public.ops_payments WHERE operation_id=op.id;
  FOR row IN WITH raw AS (
    SELECT l.*, CASE WHEN op.total_minor>0 THEN floor(paid::numeric*(l.net_minor-l.credited_minor)/op.total_minor)::bigint ELSE 0 END AS base,
      CASE WHEN op.total_minor>0 THEN mod(paid::numeric*(l.net_minor-l.credited_minor),op.total_minor) ELSE 0 END AS remainder
    FROM public.ops_lines l WHERE operation_id=op.id
  ), ranked AS (SELECT raw.*, row_number() OVER(ORDER BY remainder DESC,id) AS rank, sum(base) OVER() AS allocated FROM raw)
  SELECT *, base+CASE WHEN rank<=paid-allocated THEN 1 ELSE 0 END AS collected FROM ranked LOOP
    IF row.professional_id IS NULL THEN CONTINUE; END IF;
    target:=round(row.collected::numeric*row.commission_bps/10000)::bigint;
    SELECT COALESCE(sum(amount_minor),0) INTO previous FROM public.ops_commissions WHERE line_id=row.id;
    IF target<>previous THEN INSERT INTO public.ops_commissions(account_id,line_id,professional_id,amount_minor) VALUES(op.account_id,row.id,row.professional_id,target-previous); END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.ops_slot_available(p_account UUID,p_professional UUID,p_resource UUID,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE staff public.ops_professionals; zone TEXT; local_start TIMESTAMP; local_end TIMESTAMP;
BEGIN
  SELECT * INTO staff FROM public.ops_professionals WHERE account_id=p_account AND id=p_professional AND active;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT timezone INTO zone FROM public.ops_config WHERE account_id=p_account;
  local_start:=p_start AT TIME ZONE zone; local_end:=p_end AT TIME ZONE zone;
  IF local_start::date<>local_end::date OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(staff.hours) h WHERE (h->>'weekday')::int=extract(isodow FROM local_start)::int
      AND local_start::time >= (h->>'start')::time AND local_end::time <= (h->>'end')::time
  ) THEN RETURN false; END IF;
  IF p_resource IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ops_resources WHERE account_id=p_account AND id=p_resource AND active) THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM public.ops_appointments a WHERE a.account_id=p_account AND a.status IN ('confirmed','in_progress','completed')
    AND (a.professional_id=p_professional OR (p_resource IS NOT NULL AND a.resource_id=p_resource)) AND a.starts_at<p_end AND a.ends_at>p_start);
END $$;
CREATE OR REPLACE FUNCTION public.ops_book(p_account UUID,p_payload JSONB,p_public BOOLEAN DEFAULT false) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE staff public.ops_professionals; s public.ops_services; item RECORD; start_time TIMESTAMPTZ; end_time TIMESTAMPTZ;
  ids UUID[]; resource UUID; snapshots JSONB:='[]'; minutes INT:=0; total BIGINT:=0; client UUID; appointment UUID; operation UUID;
  client_name TEXT:=btrim(p_payload->>'client_name'); client_phone_value TEXT:=regexp_replace(p_payload->>'client_phone','[^0-9+]','','g');
BEGIN
  -- The account-wide lock makes overlap validation and insertion atomic across CRM/public bookings.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,42));
  IF NOT public.ops_crm_active(p_account) OR NOT EXISTS(SELECT 1 FROM public.ops_config c WHERE c.account_id=p_account
    AND NOT 'appointments'=ANY(c.disabled_modules) AND (c.primary_activity='services' OR 'services'=ANY(c.additional_activities))) THEN
    RAISE EXCEPTION 'Appointments disabled' USING ERRCODE='42501'; END IF;
  IF client_name IS NULL OR length(client_name) NOT BETWEEN 1 AND 80 OR client_phone_value IS NULL OR client_phone_value !~ '^\+?[0-9]{7,20}$' THEN RAISE EXCEPTION 'Invalid client' USING ERRCODE='22023'; END IF;
  SELECT * INTO staff FROM public.ops_professionals WHERE account_id=p_account AND id=(p_payload->>'professional_id')::uuid AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Professional unavailable' USING ERRCODE='22023'; END IF;
  IF NOT p_public AND public.ops_role(p_account)='professional' AND staff.linked_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not your schedule' USING ERRCODE='42501'; END IF;
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_payload->'service_ids');
  IF ids IS NULL OR cardinality(ids) NOT BETWEEN 1 AND 8 OR (SELECT count(DISTINCT v) FROM unnest(ids) v)<>cardinality(ids) THEN RAISE EXCEPTION 'Invalid services' USING ERRCODE='22023'; END IF;
  FOREACH resource IN ARRAY ids LOOP
    SELECT * INTO s FROM public.ops_services WHERE account_id=p_account AND id=resource AND active;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ops_professional_services WHERE account_id=p_account AND professional_id=staff.id AND service_id=s.id) THEN RAISE EXCEPTION 'Service not offered by professional' USING ERRCODE='22023'; END IF;
    snapshots:=snapshots||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'price_minor',s.price_minor,'duration',s.duration_minutes,'resource_id',s.resource_id,
      'inputs',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity)) FROM public.ops_service_inputs WHERE account_id=p_account AND service_id=s.id),'[]'::jsonb)));
    minutes:=minutes+s.duration_minutes; total:=total+s.price_minor;
  END LOOP;
  IF minutes>480 OR (SELECT count(DISTINCT value->>'resource_id') FROM jsonb_array_elements(snapshots) WHERE value->>'resource_id' IS NOT NULL)>1 THEN RAISE EXCEPTION 'Services require incompatible resources or duration' USING ERRCODE='22023'; END IF;
  SELECT (value->>'resource_id')::uuid INTO resource FROM jsonb_array_elements(snapshots) WHERE value->>'resource_id' IS NOT NULL LIMIT 1;
  start_time:=(p_payload->>'starts_at')::timestamptz; end_time:=start_time+make_interval(mins=>minutes);
  IF start_time IS NULL OR (p_public AND (start_time<now() OR start_time>now()+interval '90 days')) OR NOT public.ops_slot_available(p_account,staff.id,resource,start_time,end_time) THEN RAISE EXCEPTION 'Horario no disponible' USING ERRCODE='23P01'; END IF;
  INSERT INTO public.ops_clients(account_id,name,phone) VALUES(p_account,client_name,client_phone_value) ON CONFLICT(account_id,phone) DO NOTHING;
  SELECT id INTO client FROM public.ops_clients WHERE account_id=p_account AND ops_clients.phone=client_phone_value;
  INSERT INTO public.ops_appointments(account_id,client_id,client_name,client_phone,professional_id,starts_at,ends_at,resource_id,services,source)
    VALUES(p_account,client,client_name,client_phone_value,staff.id,start_time,end_time,resource,snapshots,CASE WHEN p_public THEN 'public' ELSE 'crm' END) RETURNING id INTO appointment;
  INSERT INTO public.ops_operations(account_id,appointment_id,client_id,client_name,currency,total_minor,created_by)
    SELECT p_account,appointment,client,client_name,default_currency,total,auth.uid() FROM public.accounts WHERE id=p_account RETURNING id INTO operation;
  RETURN jsonb_build_object('id',appointment,'operation_id',operation,'starts_at',start_time,'ends_at',end_time);
END $$;
CREATE OR REPLACE FUNCTION public.ops_move_stock(p_account UUID,p_product UUID,p_qty NUMERIC,p_kind TEXT,p_operation UUID,p_professional UUID,p_note TEXT) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE product public.ops_products;
BEGIN
  SELECT * INTO product FROM public.ops_products WHERE account_id=p_account AND id=p_product FOR UPDATE;
  IF NOT FOUND OR p_qty IS NULL OR p_qty=0 OR abs(p_qty)>1000000 OR p_qty<>round(p_qty,3) THEN RAISE EXCEPTION 'Invalid inventory movement' USING ERRCODE='22023'; END IF;
  IF product.stock+p_qty<0 THEN RAISE EXCEPTION 'Inventario insuficiente: %',product.name USING ERRCODE='23514'; END IF;
  UPDATE public.ops_products SET stock=stock+p_qty WHERE id=product.id;
  INSERT INTO public.ops_stock_movements(account_id,product_id,operation_id,professional_id,kind,quantity,unit_cost_minor,note,created_by)
    VALUES(p_account,product.id,p_operation,p_professional,p_kind,p_qty,product.cost_minor,left(COALESCE(p_note,''),300),auth.uid());
  RETURN round(abs(p_qty)*product.cost_minor)::bigint;
END $$;
CREATE OR REPLACE FUNCTION public.ops_close(p_account UUID,p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account,'sales'); op public.ops_operations; appt public.ops_appointments;
  product public.ops_products; service public.ops_services; staff public.ops_professionals; item JSONB; input JSONB;
  items JSONB:=COALESCE(p_payload->'items','[]'); line UUID; quantity NUMERIC; price BIGINT; cost BIGINT; gross BIGINT;
  discount BIGINT:=COALESCE((p_payload->>'discount_minor')::bigint,0); client UUID; operation UUID; rates INT; name TEXT; stage UUID;
BEGIN
  IF r='viewer' THEN RAISE EXCEPTION 'Read only' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)>40 THEN RAISE EXCEPTION 'Invalid lines' USING ERRCODE='22023'; END IF;
  IF p_payload->>'operation_id' IS NOT NULL THEN
    SELECT * INTO op FROM public.ops_operations WHERE account_id=p_account AND id=(p_payload->>'operation_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE='22023'; END IF;
    IF op.appointment_id IS NOT NULL THEN
      SELECT * INTO appt FROM public.ops_appointments WHERE account_id=p_account AND id=op.appointment_id;
      IF appt.status IN ('canceled','no_show') THEN RAISE EXCEPTION 'Appointment cannot be completed' USING ERRCODE='22023'; END IF;
      IF r='professional' AND NOT EXISTS(SELECT 1 FROM public.ops_professionals WHERE id=appt.professional_id AND linked_user_id=auth.uid() AND active) THEN RAISE EXCEPTION 'Not your appointment' USING ERRCODE='42501'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(items) v WHERE v->>'kind' IS DISTINCT FROM 'product') THEN RAISE EXCEPTION 'Appointment extras must be products' USING ERRCODE='22023'; END IF;
      items:=COALESCE((SELECT jsonb_agg(value||jsonb_build_object('kind','service','source_id',value->>'id','quantity',1,'professional_id',appt.professional_id)) FROM jsonb_array_elements(appt.services)),'[]')||items;
    ELSIF r='professional' THEN RAISE EXCEPTION 'Not your appointment' USING ERRCODE='42501'; END IF;
    IF op.status='completed' THEN RETURN jsonb_build_object('id',op.id,'already_completed',true); END IF;
    IF op.status<>'open' THEN RAISE EXCEPTION 'Operation is not open' USING ERRCODE='22023'; END IF;
    operation:=op.id;
  ELSE
    IF p_payload->>'deal_id' IS NOT NULL THEN
      IF r='professional' OR NOT EXISTS(SELECT 1 FROM public.deals WHERE id=(p_payload->>'deal_id')::uuid AND account_id=p_account) THEN RAISE EXCEPTION 'Invalid opportunity' USING ERRCODE='42501'; END IF;
      SELECT * INTO op FROM public.ops_operations WHERE account_id=p_account AND deal_id=(p_payload->>'deal_id')::uuid;
      IF FOUND THEN RETURN jsonb_build_object('id',op.id,'already_completed',op.status='completed'); END IF;
    END IF;
    IF length(btrim(COALESCE(p_payload->>'client_name',''))) NOT BETWEEN 1 AND 80 OR length(COALESCE(p_payload->>'client_phone','')) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Client details required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_clients(account_id,name,phone) VALUES(p_account,btrim(p_payload->>'client_name'),p_payload->>'client_phone') ON CONFLICT(account_id,phone) DO NOTHING;
    SELECT id INTO client FROM public.ops_clients WHERE account_id=p_account AND phone=p_payload->>'client_phone';
    INSERT INTO public.ops_operations(account_id,client_id,client_name,currency,created_by,deal_id)
      SELECT p_account,client,btrim(p_payload->>'client_name'),default_currency,auth.uid(),(p_payload->>'deal_id')::uuid FROM public.accounts WHERE id=p_account RETURNING id INTO operation;
    SELECT * INTO op FROM public.ops_operations WHERE id=operation;
  END IF;
  IF jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Operation needs at least one line' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    quantity:=(item->>'quantity')::numeric;
    IF quantity IS NULL OR quantity<=0 OR quantity>1000000 OR quantity<>round(quantity,3) THEN RAISE EXCEPTION 'Invalid quantity' USING ERRCODE='22023'; END IF;
    staff:=NULL;
    IF item->>'professional_id' IS NOT NULL THEN
      SELECT * INTO staff FROM public.ops_professionals WHERE account_id=p_account AND id=(item->>'professional_id')::uuid AND active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid professional' USING ERRCODE='22023'; END IF;
    END IF;
    IF r='professional' AND staff.linked_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only your own sales' USING ERRCODE='42501'; END IF;
    cost:=0;
    IF item->>'kind'='product' THEN
      PERFORM public.ops_assert(p_account,'products');
      SELECT * INTO product FROM public.ops_products WHERE account_id=p_account AND id=(item->>'source_id')::uuid AND active AND sellable;
      IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='22023'; END IF;
      price:=product.price_minor; name:=product.name; rates:=COALESCE(staff.product_bps,0);
      cost:=public.ops_move_stock(p_account,product.id,-quantity,'sale',operation,staff.id,'Product delivered');
    ELSIF item->>'kind'='service' THEN
      PERFORM public.ops_assert(p_account,'services');
      IF quantity<>1 OR staff.id IS NULL THEN RAISE EXCEPTION 'Service requires a professional and quantity one' USING ERRCODE='22023'; END IF;
      IF appt.id IS NOT NULL THEN
        price:=(item->>'price_minor')::bigint; name:=item->>'name';
        -- Never accept extra forged service snapshots from the submitted payload.
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(appt.services) v WHERE v->>'id'=item->>'source_id' AND (v->>'price_minor')::bigint=price) THEN RAISE EXCEPTION 'Invalid appointment line' USING ERRCODE='22023'; END IF;
      ELSE
        SELECT * INTO service FROM public.ops_services WHERE account_id=p_account AND id=(item->>'source_id')::uuid AND active;
        IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ops_professional_services WHERE account_id=p_account AND professional_id=staff.id AND service_id=service.id) THEN RAISE EXCEPTION 'Service unavailable' USING ERRCODE='22023'; END IF;
        price:=service.price_minor; name:=service.name;
        item:=item||jsonb_build_object('inputs',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',ops_service_inputs.quantity)) FROM public.ops_service_inputs WHERE account_id=p_account AND service_id=service.id),'[]'::jsonb));
      END IF;
      rates:=staff.service_bps;
      FOR input IN SELECT value FROM jsonb_array_elements(COALESCE(item->'inputs','[]')) LOOP
        cost:=cost+public.ops_move_stock(p_account,(input->>'product_id')::uuid,-(input->>'quantity')::numeric,'consumption',operation,staff.id,'Service input');
      END LOOP;
    ELSE RAISE EXCEPTION 'Invalid line kind' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ops_lines(account_id,operation_id,kind,source_id,name,professional_id,quantity,unit_price_minor,net_minor,cost_minor,commission_bps)
      VALUES(p_account,operation,item->>'kind',(item->>'source_id')::uuid,name,staff.id,quantity,price,round(quantity*price)::bigint,cost,rates) RETURNING id INTO line;
  END LOOP;
  SELECT sum(net_minor) INTO gross FROM public.ops_lines WHERE operation_id=operation;
  IF discount<0 OR discount>gross THEN RAISE EXCEPTION 'Invalid discount' USING ERRCODE='22023'; END IF;
  IF gross>0 AND discount>0 THEN
    WITH base AS (SELECT id,floor(discount::numeric*net_minor/gross)::bigint AS amount, mod(discount::numeric*net_minor,gross) AS remainder FROM public.ops_lines WHERE operation_id=operation),
    allocation AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,id) AS rank,sum(amount) OVER() AS allocated FROM base)
    UPDATE public.ops_lines l SET net_minor=l.net_minor-a.amount-CASE WHEN a.rank<=discount-a.allocated THEN 1 ELSE 0 END FROM allocation a WHERE l.id=a.id;
  END IF;
  IF (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_payments WHERE operation_id=operation)>gross-discount THEN RAISE EXCEPTION 'El anticipo supera el total. Registra su devolución antes de cerrar.' USING ERRCODE='22023'; END IF;
  UPDATE public.ops_operations SET status='completed',total_minor=gross-discount,closed_at=now() WHERE id=operation;
  IF appt.id IS NOT NULL THEN UPDATE public.ops_appointments SET status='completed' WHERE id=appt.id; END IF;
  IF op.deal_id IS NOT NULL THEN
    SELECT closing_stage_id INTO stage FROM public.ops_config WHERE account_id=p_account;
    IF stage IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pipeline_stages st JOIN public.deals d ON d.pipeline_id=st.pipeline_id WHERE st.id=stage AND d.id=op.deal_id) THEN RAISE EXCEPTION 'La etapa de cierre pertenece a otro pipeline' USING ERRCODE='22023'; END IF;
    UPDATE public.deals SET status='won',stage_id=COALESCE(stage,stage_id),value=(gross-discount)::numeric/power(10,CASE WHEN currency='JPY' THEN 0 ELSE 2 END) WHERE id=op.deal_id AND account_id=p_account;
  END IF;
  PERFORM public.ops_recalculate(operation);
  RETURN jsonb_build_object('id',operation,'total_minor',gross-discount);
END $$;
CREATE OR REPLACE FUNCTION public.ops_command(p_account UUID,p_action TEXT,p_payload JSONB,p_request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
    INSERT INTO public.ops_config(account_id,primary_activity,additional_activities,timezone,professional_label,public_enabled,disabled_modules,closing_stage_id)
      VALUES(p_account,p_payload->>'primary_activity',ARRAY(SELECT value FROM jsonb_array_elements_text(COALESCE(p_payload->'additional_activities','[]'))),p_payload->>'timezone',btrim(COALESCE(p_payload->>'professional_label','Profesional')),COALESCE((p_payload->>'public_enabled')::boolean,false),ARRAY(SELECT value FROM jsonb_array_elements_text(COALESCE(p_payload->'disabled_modules','[]'))),(p_payload->>'closing_stage_id')::uuid)
      ON CONFLICT(account_id) DO UPDATE SET primary_activity=excluded.primary_activity,additional_activities=excluded.additional_activities,timezone=excluded.timezone,professional_label=excluded.professional_label,public_enabled=excluded.public_enabled,disabled_modules=excluded.disabled_modules,closing_stage_id=excluded.closing_stage_id;
    result:=jsonb_build_object('id',p_account);
  WHEN 'professional' THEN
    PERFORM public.ops_assert(p_account,'professionals',true);
    resource:=COALESCE((p_payload->>'id')::uuid,gen_random_uuid());
    SELECT linked_user_id INTO old_link FROM public.ops_professionals WHERE id=resource AND account_id=p_account;
    IF p_payload->>'id' IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Invalid professional' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(p_payload->'hours')<>'array' OR jsonb_array_length(p_payload->'hours')>7 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'hours') h WHERE (h->>'weekday')::int NOT BETWEEN 1 AND 7 OR h->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR h->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (h->>'start')::time >= (h->>'end')::time OR h->>'weekday' IS NULL OR h->>'start' IS NULL OR h->>'end' IS NULL)
      OR (SELECT count(DISTINCT h->>'weekday') FROM jsonb_array_elements(p_payload->'hours') h)<>jsonb_array_length(p_payload->'hours') THEN RAISE EXCEPTION 'Invalid working hours' USING ERRCODE='22023'; END IF;
    IF COALESCE(p_payload->>'linked_email','')<>'' THEN
      SELECT id INTO linked FROM auth.users WHERE lower(email)=lower(btrim(p_payload->>'linked_email'));
      IF NOT FOUND THEN RAISE EXCEPTION 'El profesional debe registrarse antes de vincular su correo.' USING ERRCODE='22023'; END IF;
      IF EXISTS(SELECT 1 FROM public.account_members WHERE account_id=p_account AND user_id=linked AND role::text<>'professional') THEN RAISE EXCEPTION 'El usuario ya tiene otro rol en este negocio; no se cambiará su acceso automáticamente.' USING ERRCODE='22023'; END IF;
    END IF;
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
          PERFORM public.ops_move_stock(p_account,old_line.source_id,qty,'return',op.id,old_line.professional_id,p_payload->>'note');
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
CREATE OR REPLACE FUNCTION public.ops_dashboard(p_account UUID,p_month TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account); cfg public.ops_config; staff_id UUID; month_start TIMESTAMPTZ; month_end TIMESTAMPTZ; m TEXT; admin BOOLEAN:=r IN ('owner','admin'); result JSONB;
BEGIN
  SELECT * INTO cfg FROM public.ops_config WHERE account_id=p_account;
  m:=COALESCE(p_month,to_char(now() AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo'),'YYYY-MM'));
  IF m !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023'; END IF;
  month_start:=(m||'-01')::timestamp AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo');
  month_end:=((m||'-01')::date+interval '1 month') AT TIME ZONE COALESCE(cfg.timezone,'America/Santo_Domingo');
  IF r='professional' THEN SELECT id INTO staff_id FROM public.ops_professionals WHERE account_id=p_account AND linked_user_id=auth.uid() AND active; END IF;
  result:=jsonb_build_object('role',r,'account_id',p_account,'month',m,'config',to_jsonb(cfg),
    'currency',(SELECT default_currency FROM public.accounts WHERE id=p_account),
    'professionals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'specialty',s.specialty,'photo_url',s.photo_url,'active',s.active,'hours',s.hours,
      'service_bps',CASE WHEN admin OR s.id=staff_id THEN s.service_bps END,'product_bps',CASE WHEN admin OR s.id=staff_id THEN s.product_bps END,
      'linked_email',CASE WHEN admin THEN (SELECT email FROM auth.users WHERE id=s.linked_user_id) END,
      'service_count',(SELECT COALESCE(sum(l.quantity),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE l.professional_id=s.id AND l.kind='service' AND o.closed_at>=month_start AND o.closed_at<month_end),
      'product_count',(SELECT COALESCE(sum(l.quantity),0) FROM public.ops_lines l JOIN public.ops_operations o ON o.id=l.operation_id WHERE l.professional_id=s.id AND l.kind='product' AND o.closed_at>=month_start AND o.closed_at<month_end),
      'commission_month',CASE WHEN admin OR s.id=staff_id THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_commissions WHERE professional_id=s.id AND created_at>=month_start AND created_at<month_end) END,
      'commission_balance',CASE WHEN admin OR s.id=staff_id THEN (SELECT COALESCE(sum(amount_minor),0) FROM public.ops_commissions WHERE professional_id=s.id)-(SELECT COALESCE(sum(amount_minor),0) FROM public.ops_settlements WHERE professional_id=s.id) END
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
CREATE OR REPLACE FUNCTION public.ops_proof_file(p_account UUID,p_id UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r TEXT:=public.ops_assert(p_account,'finance'); proof public.ops_proofs;
BEGIN
  SELECT * INTO proof FROM public.ops_proofs WHERE account_id=p_account AND id=p_id;
  IF NOT FOUND OR (r NOT IN ('owner','admin') AND proof.submitted_by<>auth.uid()) THEN RAISE EXCEPTION 'Comprobante no disponible' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('file_path',proof.file_path,'source_url',(SELECT media_url FROM public.messages WHERE id=proof.source_message_id));
END $$;
CREATE OR REPLACE FUNCTION public.ops_public_catalog(p_slug TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.ops_config;
BEGIN
  SELECT * INTO c FROM public.ops_config WHERE public_slug=p_slug AND public_enabled;
  IF NOT FOUND OR NOT public.ops_crm_active(c.account_id) OR 'appointments'=ANY(c.disabled_modules) OR (c.primary_activity<>'services' AND NOT 'services'=ANY(c.additional_activities)) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('name',(SELECT name FROM public.accounts WHERE id=c.account_id),'currency',(SELECT default_currency FROM public.accounts WHERE id=c.account_id),'timezone',c.timezone,'professional_label',c.professional_label,
    'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price_minor',s.price_minor,'duration_minutes',s.duration_minutes)) FROM public.ops_services s WHERE account_id=c.account_id AND active),'[]'),
    'professionals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'photo_url',s.photo_url,'specialty',s.specialty,'service_ids',COALESCE((SELECT jsonb_agg(service_id) FROM public.ops_professional_services WHERE professional_id=s.id),'[]'))) FROM public.ops_professionals s WHERE account_id=c.account_id AND active),'[]'));
END $$;
CREATE OR REPLACE FUNCTION public.ops_public_slots(p_slug TEXT,p_service UUID,p_professional UUID,p_date DATE) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.ops_config; s public.ops_services; candidate TIMESTAMPTZ; day_start TIMESTAMPTZ; result JSONB:='[]';
BEGIN
  IF public.ops_public_catalog(p_slug) IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.ops_config WHERE public_slug=p_slug;
  SELECT * INTO s FROM public.ops_services WHERE id=p_service AND account_id=c.account_id AND active;
  IF NOT FOUND OR p_date IS NULL OR p_date<(now() AT TIME ZONE c.timezone)::date OR p_date>(now() AT TIME ZONE c.timezone)::date+90 OR NOT EXISTS(SELECT 1 FROM public.ops_professional_services WHERE account_id=c.account_id AND service_id=s.id AND professional_id=p_professional) THEN RETURN '[]'; END IF;
  day_start:=p_date::timestamp AT TIME ZONE c.timezone;
  FOR candidate IN SELECT generate_series(day_start,day_start+interval '23 hours 45 minutes',interval '15 minutes') LOOP
    IF candidate>=now() AND public.ops_slot_available(c.account_id,p_professional,s.resource_id,candidate,candidate+make_interval(mins=>s.duration_minutes)) THEN result:=result||jsonb_build_array(candidate); END IF;
  END LOOP;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.ops_public_book(p_slug TEXT,p_payload JSONB,p_request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.ops_config; saved public.ops_requests; result JSONB;
BEGIN
  IF public.ops_public_catalog(p_slug) IS NULL THEN RAISE EXCEPTION 'Reserva no disponible' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.ops_config WHERE public_slug=p_slug;
  PERFORM pg_advisory_xact_lock(hashtextextended(c.account_id::text,42));
  SELECT * INTO saved FROM public.ops_requests WHERE account_id=c.account_id AND request_id=p_request_id;
  IF FOUND THEN
    IF saved.action<>'public_book' OR saved.user_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid request key' USING ERRCODE='22023'; END IF;
    RETURN saved.result;
  END IF;
  result:=public.ops_book(c.account_id,p_payload,true)-'operation_id';
  INSERT INTO public.ops_requests(account_id,request_id,action,result) VALUES(c.account_id,p_request_id,'public_book',result);
  INSERT INTO public.ops_audit(account_id,action,resource_id) VALUES(c.account_id,'public_book',(result->>'id')::uuid);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.create_activity_business(
  p_name TEXT,p_industry TEXT,p_currency TEXT,p_requested_plan TEXT,p_request_id UUID,
  p_template_id TEXT,p_objective TEXT,p_template_version INTEGER,p_stage_names JSONB,
  p_primary_activity TEXT,p_additional_activities JSONB,p_timezone TEXT,p_professional_label TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE business UUID; stage UUID;
BEGIN
  business:=public.create_business_with_template(p_name,p_industry,p_currency,p_requested_plan,p_request_id,p_template_id,p_objective,p_template_version,p_stage_names);
  IF NOT EXISTS(SELECT 1 FROM public.ops_config WHERE account_id=business) THEN
    SELECT s.id INTO stage FROM public.account_template_config t JOIN public.pipeline_stages s ON s.pipeline_id=t.pipeline_id WHERE t.account_id=business ORDER BY s.position DESC LIMIT 1;
    PERFORM public.ops_command(business,'configure',jsonb_build_object('primary_activity',p_primary_activity,'additional_activities',p_additional_activities,'timezone',p_timezone,'professional_label',p_professional_label,'public_enabled',false,'closing_stage_id',stage),gen_random_uuid());
  END IF;
  RETURN business;
END $$;
CREATE OR REPLACE FUNCTION public.ops_guard_stage_close() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND EXISTS(SELECT 1 FROM public.ops_config c WHERE c.account_id=NEW.account_id AND c.closing_stage_id=NEW.stage_id)
    AND NOT EXISTS(SELECT 1 FROM public.ops_operations o WHERE o.account_id=NEW.account_id AND o.deal_id=NEW.id AND o.status='completed') THEN
    RAISE EXCEPTION 'Confirma servicios y productos desde Operación antes de cerrar esta oportunidad.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;