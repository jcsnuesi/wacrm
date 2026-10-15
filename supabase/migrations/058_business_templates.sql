BEGIN;
CREATE TABLE public.business_template_catalog (
  id TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL,
  objectives JSONB NOT NULL, fields JSONB NOT NULL, stages JSONB NOT NULL,
  PRIMARY KEY(id, version)
);
INSERT INTO public.business_template_catalog VALUES
 ('generic',1,'General','["sell","schedule"]','["Necesidad principal","Presupuesto"]','{"sell":["Consulta","Calificación","Propuesta","Negociación","Cierre"],"schedule":["Consulta","Calificación","Cita agendada","Cita realizada"]}'),
 ('real_estate',1,'Inmobiliaria','["sell","rent","capture"]','["Tipo de interesado","Zona de interés","Presupuesto","Tipo de inmueble"]','{"sell":["Consulta","Calificación","Visita","Oferta","Negociación","Cierre"],"rent":["Consulta","Calificación","Visita","Oferta","Negociación","Cierre"],"capture":["Consulta","Calificación","Evaluación","Acuerdo","Propiedad captada"]}'),
 ('blank',1,'Desde cero','["sell","schedule","rent","capture"]','[]','{}');
ALTER TABLE public.business_template_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_template_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_template_catalog TO authenticated;
GRANT ALL ON public.business_template_catalog TO service_role;
CREATE POLICY business_template_catalog_read ON public.business_template_catalog FOR SELECT TO authenticated USING (true);

CREATE TABLE public.account_template_config (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
  objective TEXT NOT NULL, applied_by UUID NOT NULL REFERENCES auth.users(id),
  pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(template_id, template_version) REFERENCES public.business_template_catalog(id, version)
);
ALTER TABLE public.account_template_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_template_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_template_config TO authenticated;
GRANT ALL ON public.account_template_config TO service_role;
CREATE POLICY account_template_config_read ON public.account_template_config FOR SELECT TO authenticated USING (public.is_account_member(account_id));

CREATE FUNCTION public.create_business_with_template(
  p_name TEXT, p_industry TEXT, p_currency TEXT, p_requested_plan TEXT, p_request_id UUID,
  p_template_id TEXT, p_objective TEXT, p_template_version INTEGER, p_stage_names JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  caller UUID := auth.uid(); business UUID; catalog public.business_template_catalog;
  pipeline UUID; stage TEXT; field TEXT; ordinal INTEGER := 0;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO catalog FROM public.business_template_catalog WHERE id=p_template_id AND version=p_template_version;
  IF NOT FOUND OR p_objective IS NULL OR NOT (catalog.objectives ? p_objective) THEN
    RAISE EXCEPTION 'Invalid template or objective' USING ERRCODE='22023';
  END IF;
  IF p_stage_names IS NULL OR jsonb_typeof(p_stage_names) <> 'array' THEN
    RAISE EXCEPTION 'Invalid stages' USING ERRCODE='22023';
  END IF;
  IF (p_template_id='blank' AND jsonb_array_length(p_stage_names)<>0)
    OR (p_template_id<>'blank' AND jsonb_array_length(p_stage_names) NOT BETWEEN 2 AND 12)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_stage_names) v WHERE jsonb_typeof(v)<>'string')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_stage_names) v WHERE length(btrim(v)) NOT BETWEEN 1 AND 60)
    OR (SELECT count(DISTINCT lower(btrim(v))) FROM jsonb_array_elements_text(p_stage_names) v) <> jsonb_array_length(p_stage_names) THEN
    RAISE EXCEPTION 'Invalid stages' USING ERRCODE='22023';
  END IF;
  -- create_business acquires the caller lock and creates account/membership
  -- in this same transaction. A failure below rolls all of it back.
  business := public.create_business(p_name,p_industry,p_currency,p_requested_plan,p_request_id);
  IF EXISTS(SELECT 1 FROM public.account_template_config WHERE account_id=business) THEN RETURN business; END IF;
  IF p_template_id<>'blank' THEN
    INSERT INTO public.pipelines(user_id,account_id,name) VALUES(caller,business,catalog.name) RETURNING id INTO pipeline;
    FOR stage IN SELECT value FROM jsonb_array_elements_text(p_stage_names) LOOP
      INSERT INTO public.pipeline_stages(pipeline_id,name,position) VALUES(pipeline,btrim(stage),ordinal);
      ordinal := ordinal+1;
    END LOOP;
    FOR field IN SELECT value FROM jsonb_array_elements_text(catalog.fields) LOOP
      INSERT INTO public.custom_fields(user_id,account_id,field_name,field_type) VALUES(caller,business,field,'text');
    END LOOP;
  END IF;
  INSERT INTO public.account_template_config(account_id,template_id,template_version,objective,applied_by,pipeline_id)
    VALUES(business,p_template_id,p_template_version,p_objective,caller,pipeline);
  RETURN business;
END;
$$;
REVOKE ALL ON FUNCTION public.create_business_with_template(TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_with_template(TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
