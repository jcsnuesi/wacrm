import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: { status?: number }) =>
    Response.json(
      {
        error: error.status === 401 ? 'Unauthorized' : 'Internal server error',
      },
      { status: error.status ?? 500 }
    ),
}));

import { GET } from './route';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

const query = {
  select: mocks.select,
  eq: mocks.eq,
  maybeSingle: mocks.maybeSingle,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({
    data: {
      id: CUSTOMER_ID,
      display_name: 'Ada Lovelace',
      contact_identities: [],
      conversations: [],
    },
    error: null,
  });
  mocks.requireRole.mockResolvedValue({
    supabase: { from: mocks.from },
    accountId: ACCOUNT_ID,
  });
});

describe('GET /api/customers/[id]', () => {
  it('requires viewer access and scopes the customer to the current account', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(mocks.from).toHaveBeenCalledWith('customers');
    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'id', CUSTOMER_ID);
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'account_id', ACCOUNT_ID);
    const selection = mocks.select.mock.calls[0][0] as string;
    expect(selection).not.toContain('*');
    expect(selection).toContain('contact_identities');
    expect(selection).toContain('channel_account:channel_accounts');
  });

  it('returns 404 for an invalid id without querying customer data', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 404 when no customer in the current account matches', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Customer not found' });
  });

  it('returns a generic 500 response for database failures', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('private database detail'),
    });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('preserves authentication failures before validating or querying ids', async () => {
    mocks.requireRole.mockRejectedValue({ status: 401 });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
