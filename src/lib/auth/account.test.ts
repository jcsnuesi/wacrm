import { afterEach, describe, expect, it, vi } from 'vitest';

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<
    string,
    { data: unknown; error: unknown } | Array<{ data: unknown; error: unknown }>
  >;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        const raw = opts.byTable[table];
        if (Array.isArray(raw)) {
          const next = raw.shift();
          return Promise.resolve(next ?? { data: null, error: null });
        }
        return Promise.resolve(raw ?? { data: null, error: null });
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
const cookies = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));
vi.mock('next/headers', () => ({
  cookies: () => cookies(),
}));

const { getCurrentAccount, UnauthorizedError, ForbiddenError } =
  await import('./account');

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
  delete process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
  cookies.mockResolvedValue({
    get: () => undefined,
  });
});

describe('getCurrentAccount', () => {
  it('resolves context via a plain accounts lookup, not an embedded join', async () => {
    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'owner' },
          error: null,
        },
        accounts: {
          data: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'owner',
      account: { id: 'acct-1', name: 'Acme', default_currency: 'USD' },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(['profiles', 'accounts']);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([['user_id', 'user-1']]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([['id', 'acct-1']]);
  });

  it('throws UnauthorizedError when there is no session', async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Could not load account context'
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'admin' },
          error: null,
        },
        accounts: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('Could not load account context');
  });

  it('rejects a profile not linked to an account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: null, account_role: null },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });

  it('rejects an account_id that resolves to no readable account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'viewer' },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });

  it('falls back to canonical membership when profile tenancy is missing', async () => {
    const canonicalAccountId = '11111111-1111-4111-8111-111111111111';

    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: null, account_role: null },
          error: null,
        },
        account_members: {
          data: { account_id: canonicalAccountId, role: 'agent' },
          error: null,
        },
        accounts: {
          data: {
            id: canonicalAccountId,
            name: 'Canonical',
            default_currency: 'USD',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: 'user-1',
      accountId: canonicalAccountId,
      role: 'agent',
      account: {
        id: canonicalAccountId,
        name: 'Canonical',
        default_currency: 'USD',
      },
    });

    expect(calls.map((c) => c.table)).toEqual([
      'profiles',
      'account_members',
      'accounts',
    ]);
    expect(calls[1].eqArgs).toEqual([['user_id', 'user-1']]);
    expect(calls[2].eqArgs).toEqual([['id', canonicalAccountId]]);
  });

  it('still prefers legacy profile tenancy when profile account_id/account_role are present', async () => {
    const legacyAccountId = '11111111-1111-4111-8111-111111111111';

    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: legacyAccountId, account_role: 'owner' },
          error: null,
        },
        account_members: {
          data: {
            account_id: '22222222-2222-4222-8222-222222222222',
            role: 'viewer',
          },
          error: null,
        },
        accounts: {
          data: {
            id: legacyAccountId,
            name: 'Legacy',
            default_currency: 'USD',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.accountId).toBe(legacyAccountId);
    expect(ctx.role).toBe('owner');
    expect(calls.map((c) => c.table)).toEqual(['profiles', 'accounts']);
  });

  it('uses active-account cookie override when membership exists', async () => {
    const legacyAccountId = '11111111-1111-4111-8111-111111111111';
    const overrideAccountId = '22222222-2222-4222-8222-222222222222';

    cookies.mockResolvedValue({
      get: (name: string) =>
        name === 'wacrm_active_account_id'
          ? { value: overrideAccountId }
          : undefined,
    });

    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: legacyAccountId, account_role: 'owner' },
          error: null,
        },
        account_members: {
          data: { role: 'admin' },
          error: null,
        },
        accounts: {
          data: {
            id: overrideAccountId,
            name: 'Beta',
            default_currency: 'DOP',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.accountId).toBe(overrideAccountId);
    expect(ctx.role).toBe('admin');
    expect(ctx.account).toMatchObject({ id: overrideAccountId, name: 'Beta' });

    expect(calls.map((c) => c.table)).toEqual([
      'profiles',
      'account_members',
      'accounts',
    ]);
    expect(calls[1].eqArgs).toEqual([
      ['account_id', overrideAccountId],
      ['user_id', 'user-1'],
    ]);
  });

  it('falls back to profile account when active-account cookie is unauthorized', async () => {
    const legacyAccountId = '11111111-1111-4111-8111-111111111111';
    const overrideAccountId = '22222222-2222-4222-8222-222222222222';

    cookies.mockResolvedValue({
      get: (name: string) =>
        name === 'wacrm_active_account_id'
          ? { value: overrideAccountId }
          : undefined,
    });

    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: legacyAccountId, account_role: 'owner' },
          error: null,
        },
        account_members: {
          data: null,
          error: null,
        },
        accounts: {
          data: {
            id: legacyAccountId,
            name: 'Acme',
            default_currency: 'USD',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();
    expect(ctx.accountId).toBe(legacyAccountId);
    expect(ctx.role).toBe('owner');
  });

  it('keeps canonical fallback account when active-account cookie is unauthorized and profile tenancy is missing', async () => {
    const canonicalAccountId = '11111111-1111-4111-8111-111111111111';
    const unauthorizedOverride = '22222222-2222-4222-8222-222222222222';

    cookies.mockResolvedValue({
      get: (name: string) =>
        name === 'wacrm_active_account_id'
          ? { value: unauthorizedOverride }
          : undefined,
    });

    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: null, account_role: null },
          error: null,
        },
        // First read resolves the canonical fallback account, second
        // read checks cookie override membership and must fail.
        account_members: [
          {
            data: { account_id: canonicalAccountId, role: 'viewer' },
            error: null,
          },
          {
            data: null,
            error: null,
          },
        ],
        accounts: {
          data: {
            id: canonicalAccountId,
            name: 'Canonical',
            default_currency: 'USD',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();
    expect(ctx.accountId).toBe(canonicalAccountId);
    expect(ctx.role).toBe('viewer');
  });

  it('ignores active-account cookie when account switch feature flag is disabled', async () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';

    const legacyAccountId = '11111111-1111-4111-8111-111111111111';
    const overrideAccountId = '22222222-2222-4222-8222-222222222222';

    cookies.mockResolvedValue({
      get: (name: string) =>
        name === 'wacrm_active_account_id'
          ? { value: overrideAccountId }
          : undefined,
    });

    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: legacyAccountId, account_role: 'owner' },
          error: null,
        },
        accounts: {
          data: {
            id: legacyAccountId,
            name: 'Acme',
            default_currency: 'USD',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.accountId).toBe(legacyAccountId);
    expect(ctx.role).toBe('owner');
    expect(calls.map((c) => c.table)).toEqual(['profiles', 'accounts']);
  });
});
