import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAccountTemplate } from './account-config';
describe('business template config', () => {
  it('scopes configuration to the session business', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { template_id: 'generic' }, error: null }),
    };
    const db = { from: vi.fn().mockReturnValue(query) };
    await readAccountTemplate(db as unknown as SupabaseClient, 'business-b');
    expect(query.eq).toHaveBeenCalledWith('account_id', 'business-b');
  });
  it('tolerates an unapplied migration but surfaces unexpected database failures', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };
    const db = { from: () => query } as unknown as SupabaseClient;
    query.maybeSingle.mockResolvedValue({ error: { code: 'PGRST205' } });
    expect(await readAccountTemplate(db, 'business-a')).toBeNull();
    query.maybeSingle.mockResolvedValue({ error: { code: 'XX000' } });
    await expect(readAccountTemplate(db, 'business-a')).rejects.toThrow();
  });
});
