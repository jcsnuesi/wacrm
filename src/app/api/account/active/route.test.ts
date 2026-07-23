import { afterEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccount = vi.fn();
const toErrorResponse = vi.fn((err: unknown) => {
  const message = err instanceof Error ? err.message : 'error';
  return Response.json({ error: message }, { status: 500 });
});

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: (...args: unknown[]) => getCurrentAccount(...args),
  toErrorResponse: (...args: unknown[]) => toErrorResponse(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
  delete process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
});

describe('/api/account/active route', () => {
  it('GET returns current account and available accounts', async () => {
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'account_members') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => undefined,
              }),
              then: undefined,
            }),
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ account_id: 'acct-1', role: 'owner' }],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
                  ],
                  error: null,
                }),
            }),
          };
        }
        return { select: () => ({}) };
      }),
    } as unknown as { from: (table: string) => unknown };

    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: db,
    });

    const { GET } = await import('./route');
    const res = await GET();
    const json = (await res.json()) as {
      account_id: string;
      available_accounts: Array<{ id: string }>;
    };

    expect(res.status).toBe(200);
    expect(json.account_id).toBe('acct-1');
    expect(json.available_accounts[0]?.id).toBe('acct-1');
  });

  it('POST rejects invalid account_id', async () => {
    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: { from: vi.fn() },
    });

    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/account/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: 'bad-id' }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('POST returns 403 when user is not a member of requested account', async () => {
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      })),
    };

    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: db,
    });

    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/account/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: '11111111-1111-4111-8111-111111111111',
        }),
      })
    );

    expect(res.status).toBe(403);
  });

  it('GET returns only current account when switching feature is disabled', async () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'account_members') {
          throw new Error(
            'account_members should not be queried when disabled'
          );
        }
        if (table === 'accounts') {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    { id: 'acct-2', name: 'Beta', default_currency: 'DOP' },
                  ],
                  error: null,
                }),
            }),
          };
        }
        return { select: () => ({}) };
      }),
    } as unknown as { from: (table: string) => unknown };

    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: db,
    });

    const { GET } = await import('./route');
    const res = await GET();
    const json = (await res.json()) as {
      account_switch_enabled: boolean;
      available_accounts: Array<{ id: string }>;
    };

    expect(res.status).toBe(200);
    expect(json.account_switch_enabled).toBe(false);
    expect(json.available_accounts).toEqual([
      { id: 'acct-1', name: 'Acme', default_currency: 'USD', role: 'owner' },
    ]);
  });

  it('POST returns 404 when switching feature is disabled', async () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';

    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: { from: vi.fn() },
    });

    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/account/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: '11111111-1111-4111-8111-111111111111',
        }),
      })
    );

    expect(res.status).toBe(404);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });

  it('DELETE clears active-account cookie', async () => {
    getCurrentAccount.mockResolvedValue({
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
      accountId: 'acct-1',
      role: 'owner',
      userId: 'user-1',
      supabase: { from: vi.fn() },
    });

    const { DELETE } = await import('./route');
    const res = await DELETE();

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('wacrm_active_account_id=');
  });

  it('DELETE returns 404 when switching feature is disabled', async () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';

    const { DELETE } = await import('./route');
    const res = await DELETE();

    expect(res.status).toBe(404);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });
});
