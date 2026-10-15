import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mock.context,
  toErrorResponse: () => Response.json({}, { status: 401 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));
import { GET, POST } from './route';
const key = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) =>
  new Request('http://localhost/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mock.context.mockResolvedValue({
    accountId: 'business-a',
    userId: 'user-a',
    supabase: { rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: {}, error: null });
});
describe('operational API', () => {
  it('uses the session business and explicit professional scope', async () => {
    expect(
      (
        await GET(
          new Request('http://localhost/api/operations?account_id=victim')
        )
      ).status
    ).toBe(200);
    expect(mock.context).toHaveBeenCalledWith({ allowProfessional: true });
    expect(mock.rpc).toHaveBeenCalledWith('ops_dashboard', {
      p_account: 'business-a',
      p_month: null,
    });
  });
  it('passes mutations through checked transactional RPC without trusting another account', async () => {
    const response = await POST(
      request({
        action: 'payment',
        payload: { account_id: 'victim', amount_minor: 90000 },
        request_id: key,
      })
    );
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith(
      'ops_command',
      expect.objectContaining({
        p_account: 'business-a',
        p_action: 'payment',
        p_request_id: key,
      })
    );
  });
  it('rejects stale account context and unknown commands before a mutation', async () => {
    expect(
      (
        await POST(
          request({
            action: 'configure',
            payload: {},
            request_id: key,
            client_account_id: 'other',
          })
        )
      ).status
    ).toBe(409);
    expect(
      (
        await POST(
          request({ action: 'grant_license', payload: {}, request_id: key })
        )
      ).status
    ).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('returns migration and slot conflict outcomes', async () => {
    mock.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    expect(
      (await GET(new Request('http://localhost/api/operations'))).status
    ).toBe(503);
    mock.rpc.mockResolvedValue({ error: { code: '23P01' } });
    expect(
      (await POST(request({ action: 'book', payload: {}, request_id: key })))
        .status
    ).toBe(409);
  });
  it('rejects unauthenticated financial reads', async () => {
    mock.context.mockRejectedValue(new Error('no auth'));
    expect(
      (await GET(new Request('http://localhost/api/operations'))).status
    ).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
