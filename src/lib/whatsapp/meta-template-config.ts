import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the Meta line used by account-level template operations.
 *
 * The inbox has one active line across all providers. Therefore a connected
 * Meta line can legitimately be inactive while Twilio is the default sender.
 * Template management is Meta-specific and must not depend on that inbox
 * default. Prefer an active Meta line when available, otherwise use the most
 * recently updated connected Meta line.
 */
export async function findMetaTemplateConfig(
  db: SupabaseClient,
  accountId: string
) {
  return db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .eq('status', 'connected')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
}
