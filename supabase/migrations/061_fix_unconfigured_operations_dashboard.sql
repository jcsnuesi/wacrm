-- A SELECT INTO with no matching ops_config row leaves a composite with null
-- fields. Serialize it as JSON null so existing businesses see Operations setup.
BEGIN;

CREATE OR REPLACE FUNCTION public.ops_dashboard(p_account UUID,p_month TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
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

NOTIFY pgrst,'reload schema';
COMMIT;
