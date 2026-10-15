import { describe, expect, it } from 'vitest';
import { resolvePlanAccess, type SubscriptionRecord } from './plans';

const now = Date.parse('2026-10-14T12:00:00Z');
function subscription(
  patch: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    account_id: 'business-a',
    plan_key: 'crm',
    status: 'active',
    access_until: null,
    workflow_editor_licensed: false,
    ...patch,
  };
}
describe('business plan authorization', () => {
  it('does not inherit another business subscription', () => {
    expect(
      resolvePlanAccess(
        'business-b',
        subscription({ plan_key: 'advanced', workflow_editor_licensed: true }),
        now
      ).features.workflow_editor
    ).toBe(false);
  });
  it('keeps community managed workflows separate from customer editing', () => {
    const access = resolvePlanAccess(
      'business-a',
      subscription({ plan_key: 'managed' }),
      now
    );
    expect(access.features.managed_automation).toBe(true);
    expect(access.features.workflow_editor).toBe(false);
  });
  it('requires both advanced entitlement and reviewed editor licensing', () => {
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({ plan_key: 'advanced' }),
        now
      ).features.workflow_editor
    ).toBe(false);
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({ plan_key: 'advanced', workflow_editor_licensed: true }),
        now
      ).features.workflow_editor
    ).toBe(true);
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({ plan_key: 'crm', workflow_editor_licensed: true }),
        now
      ).features.workflow_editor
    ).toBe(false);
  });
  it.each(['suspended', 'canceled'] as const)(
    'rejects features for %s businesses',
    (status) => {
      const features = resolvePlanAccess(
        'business-a',
        subscription({
          status,
          plan_key: 'advanced',
          workflow_editor_licensed: true,
        }),
        now
      ).features;
      expect(Object.values(features).every((value) => !value)).toBe(true);
    }
  );
  it('expires trials at the deadline and refuses trials without one', () => {
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({
          status: 'trialing',
          access_until: '2026-10-14T12:00:00Z',
        }),
        now
      ).reason
    ).toBe('expired');
    expect(
      resolvePlanAccess('business-a', subscription({ status: 'trialing' }), now)
        .features.crm
    ).toBe(false);
  });
  it('allows only explicitly time-bounded payment grace', () => {
    expect(
      resolvePlanAccess('business-a', subscription({ status: 'past_due' }), now)
        .features.crm
    ).toBe(false);
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({
          status: 'past_due',
          access_until: '2026-10-15T12:00:00Z',
        }),
        now
      ).features.crm
    ).toBe(true);
  });
  it('does not grant access for malformed expiration', () => {
    expect(
      resolvePlanAccess(
        'business-a',
        subscription({ access_until: 'invalid' }),
        now
      ).features.crm
    ).toBe(false);
  });
});
