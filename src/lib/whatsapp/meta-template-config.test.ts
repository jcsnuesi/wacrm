import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findMetaTemplateConfig } from './meta-template-config';

describe('findMetaTemplateConfig', () => {
  it('selects a connected Meta line without requiring it to be active', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const orders: Array<[string, unknown]> = [];
    const row = { id: 'meta-1', provider: 'meta', is_active: false };
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((column: string, value: unknown) => {
      calls.push(['eq', column, value]);
      return builder;
    });
    builder.order = vi.fn((column: string, options: unknown) => {
      orders.push([column, options]);
      return builder;
    });
    builder.limit = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({ data: row, error: null }));

    const db = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient;

    const result = await findMetaTemplateConfig(db, 'account-1');

    expect(result.data).toBe(row);
    expect(calls).toContainEqual(['eq', 'provider', 'meta']);
    expect(calls).toContainEqual(['eq', 'status', 'connected']);
    expect(calls).not.toContainEqual(['eq', 'is_active', true]);
    expect(orders[0]).toEqual(['is_active', { ascending: false }]);
  });
});
