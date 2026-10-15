import type { SupabaseClient } from '@supabase/supabase-js';
import { ForbiddenError } from '@/lib/auth/account';
import {
  resolvePlanAccess,
  unavailableAccess,
  type AccountPlanAccess,
  type PlanFeature,
  type SubscriptionRecord,
} from './plans';

export async function readAccountPlan(
  db: SupabaseClient,
  accountId: string
): Promise<AccountPlanAccess> {
  const { data, error } = await db
    .from('account_subscriptions')
    .select(
      'account_id, plan_key, status, access_until, workflow_editor_licensed'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return unavailableAccess(accountId, 'migration_required');
    }
    throw new Error('Could not load business plan');
  }
  if (!data) return unavailableAccess(accountId, 'missing_record');
  return resolvePlanAccess(accountId, data as SubscriptionRecord);
}

/** For new paid endpoints/workers. Existing CRM routes are not migrated yet. */
export async function requirePlanFeature(
  db: SupabaseClient,
  accountId: string,
  feature: PlanFeature
) {
  const access = await readAccountPlan(db, accountId);
  if (!access.features[feature])
    throw new ForbiddenError(
      'This business does not have access to this feature'
    );
  return access;
}
