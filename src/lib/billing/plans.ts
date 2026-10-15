// Public catalogue: commercial prices and quotas are agreed separately.
export const PLAN_KEYS = ['crm', 'managed', 'advanced'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const FEATURES = [
  'crm',
  'managed_automation',
  'advertising_reporting',
  'workflow_editor',
] as const;
export type PlanFeature = (typeof FEATURES)[number];
export const PLAN_FEATURES: Record<PlanKey, readonly PlanFeature[]> = {
  crm: ['crm'],
  managed: ['crm', 'managed_automation'],
  advanced: [
    'crm',
    'managed_automation',
    'advertising_reporting',
    'workflow_editor',
  ],
};

export interface SubscriptionRecord {
  account_id: string;
  plan_key: PlanKey;
  status: 'active' | 'trialing' | 'past_due' | 'suspended' | 'canceled';
  access_until: string | null;
  workflow_editor_licensed: boolean;
}

export interface AccountPlanAccess {
  account_id: string;
  plan_key: PlanKey | null;
  status: SubscriptionRecord['status'] | 'unconfigured';
  reason:
    | 'available'
    | 'migration_required'
    | 'missing_record'
    | 'inactive'
    | 'expired'
    | 'invalid_record';
  access_until: string | null;
  features: Record<PlanFeature, boolean>;
}

export function unavailableAccess(
  accountId: string,
  reason: AccountPlanAccess['reason']
): AccountPlanAccess {
  return {
    account_id: accountId,
    plan_key: null,
    status: 'unconfigured',
    reason,
    access_until: null,
    features: {
      crm: false,
      managed_automation: false,
      advertising_reporting: false,
      workflow_editor: false,
    },
  };
}

/** Pure policy. Account identity comes from authentication, never the browser. */
export function resolvePlanAccess(
  accountId: string,
  record: SubscriptionRecord,
  now = Date.now()
): AccountPlanAccess {
  if (
    record.account_id !== accountId ||
    !PLAN_KEYS.includes(record.plan_key) ||
    !['active', 'trialing', 'past_due', 'suspended', 'canceled'].includes(
      record.status
    )
  ) {
    return unavailableAccess(accountId, 'invalid_record');
  }
  const expiration =
    record.access_until === null ? null : Date.parse(record.access_until);
  const expired =
    (expiration !== null &&
      (!Number.isFinite(expiration) || expiration <= now)) ||
    (record.status === 'trialing' && expiration === null);
  const active =
    ['active', 'trialing', 'past_due'].includes(record.status) && !expired;
  // past_due must have an explicit grace deadline; an absent deadline fails closed.
  const allowed =
    active && (record.status !== 'past_due' || expiration !== null);
  const access = unavailableAccess(
    accountId,
    expired ? 'expired' : allowed ? 'available' : 'inactive'
  );
  access.plan_key = record.plan_key;
  access.status = record.status;
  access.access_until = record.access_until;
  for (const feature of PLAN_FEATURES[record.plan_key]) {
    access.features[feature] =
      allowed &&
      (feature !== 'workflow_editor' ||
        record.workflow_editor_licensed === true);
  }
  return access;
}
