import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), plan: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.context,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/billing/account-plan', () => ({ readAccountPlan: mocks.plan }));
import { GET } from './route';

beforeEach(() => vi.resetAllMocks());
describe('business plan API', () => {
  it('uses session business and disables shared caching', async () => {
    mocks.context.mockResolvedValue({
      accountId: 'business-a',
      supabase: 'session-client',
    });
    mocks.plan.mockResolvedValue({ account_id: 'business-a' });
    const response = await GET();
    expect(mocks.plan).toHaveBeenCalledWith('session-client', 'business-a');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      data: { account_id: 'business-a' },
    });
  });
  it('rejects unauthenticated requests without reading subscriptions', async () => {
    mocks.context.mockRejectedValue(new Error('Unauthorized'));
    expect((await GET()).status).toBe(401);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
