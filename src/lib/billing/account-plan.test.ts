import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { readAccountPlan, requirePlanFeature } from './account-plan';

function database(result: { data: unknown; error: { code: string } | null }) {
  const eq = vi.fn(() => ({ maybeSingle: async () => result }));
  const db = { from: vi.fn(() => ({ select: () => ({ eq }) })) };
  return { db: db as unknown as SupabaseClient, eq };
}
describe('account plan storage', () => {
  it('always scopes reads to the authenticated business', async () => {
    const { db, eq } = database({
      data: {
        account_id: 'a',
        plan_key: 'crm',
        status: 'active',
        access_until: null,
        workflow_editor_licensed: false,
      },
      error: null,
    });
    expect((await readAccountPlan(db, 'a')).features.crm).toBe(true);
    expect(eq).toHaveBeenCalledWith('account_id', 'a');
  });
  it.each(['42P01', 'PGRST205'])(
    'fails closed for missing migration: %s',
    async (code) => {
      const { db } = database({ data: null, error: { code } });
      const result = await readAccountPlan(db, 'a');
      expect(result.reason).toBe('migration_required');
      expect(Object.values(result.features).some(Boolean)).toBe(false);
      await expect(
        requirePlanFeature(db, 'a', 'managed_automation')
      ).rejects.toThrow('does not have access');
    }
  );
  it('does not treat database outages as an available plan', async () => {
    const { db } = database({
      data: null,
      error: { code: 'connection_error' },
    });
    await expect(readAccountPlan(db, 'a')).rejects.toThrow('Could not load');
  });
  it('does not grant a missing subscription by default', async () => {
    const { db } = database({ data: null, error: null });
    expect((await readAccountPlan(db, 'a')).reason).toBe('missing_record');
  });
});
