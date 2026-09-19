import { afterEach, describe, expect, it, vi } from 'vitest';

const requireRole = vi.fn();
const toErrorResponse = vi.fn((error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : 'Unknown error' },
    { status: 500 }
  )
);
const encrypt = vi.fn((value: string) => `encrypted:${value}`);

vi.mock('@/lib/auth/account', () => ({ requireRole, toErrorResponse }));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt }));

afterEach(() => vi.clearAllMocks());

function resolvedChain(result: unknown) {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    select?: ReturnType<typeof vi.fn>;
    maybeSingle?: ReturnType<typeof vi.fn>;
    single?: ReturnType<typeof vi.fn>;
    then: Promise<unknown>['then'];
  } = {
    eq: vi.fn(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  chain.eq.mockReturnValue(chain);
  return chain;
}

describe('/api/channels route', () => {
  it('disconnects the previous social account before connecting its replacement', async () => {
    const previous = resolvedChain({ error: null });
    const channel = {
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: 'channel-ig' }, error: null }),
    };
    const inserted = {
      id: 'new-account',
      channel: 'instagram',
      status: 'connected',
    };
    const upsert = {
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
      })),
    };
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'channels')
          return { select: vi.fn(() => ({ eq: vi.fn(() => channel) })) };
        return { update: vi.fn(() => previous), upsert: vi.fn(() => upsert) };
      }),
    };
    requireRole.mockResolvedValue({ supabase: db, accountId: 'workspace-1' });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'instagram',
          externalAccountId: 'ig-new',
          accessToken: 'token',
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(previous.eq).toHaveBeenCalledWith('status', 'connected');
    expect(encrypt).toHaveBeenCalledWith('token');
    expect((await response.json()).account).toEqual(inserted);
  });

  it('disconnects a social account and clears its credentials', async () => {
    const updated = resolvedChain({
      data: { id: 'connected-account' },
      error: null,
    });
    updated.select = vi.fn(() => ({
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: 'connected-account' }, error: null }),
    }));
    const db = {
      from: vi.fn(() => ({ update: vi.fn(() => updated) })),
    };
    requireRole.mockResolvedValue({ supabase: db, accountId: 'workspace-1' });

    const { DELETE } = await import('./route');
    const response = await DELETE(
      new Request('http://localhost/api/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'instagram', id: 'connected-account' }),
      })
    );

    expect(response.status).toBe(204);
    expect(updated.eq).toHaveBeenCalledWith('status', 'connected');
  });
});
