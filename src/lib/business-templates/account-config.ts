import type { SupabaseClient } from '@supabase/supabase-js';
export async function readAccountTemplate(
  db: SupabaseClient,
  accountId: string
) {
  const { data, error } = await db
    .from('account_template_config')
    .select('template_id, template_version, objective, pipeline_id, applied_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code)) return null;
    throw new Error('No se pudo consultar la plantilla del negocio.');
  }
  return data;
}
