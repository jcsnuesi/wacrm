import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  user: vi.fn(),
  rpc: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.cookie }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));
import { POST } from './route';
const token = 'a'.repeat(43);
const request = (value: string) =>
  new Request('http://localhost/api/employee/activate', {
    method: 'POST',
    body: JSON.stringify({ token: value }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.user },
    rpc: mocks.rpc,
  });
  mocks.user.mockResolvedValue({
    data: { user: { id: 'employee' } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: '11111111-1111-4111-8111-111111111111',
    error: null,
  });
});
describe('employee activation', () => {
  it('uses the checked acceptance RPC and an HTTP-only active-business cookie', async () => {
    expect((await POST(request(token))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('ops_employee_accept', {
      p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.rpc.mock.calls[0][1].p_hash).not.toBe(token);
    expect(mocks.cookie).toHaveBeenCalledWith(
      'wacrm_active_account_id',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' })
    );
  });
  it('does not set business context when the invitation is revoked or belongs to another email', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501' } });
    expect((await POST(request(token))).status).toBe(403);
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it('requires a session and rejects malformed tokens', async () => {
    expect((await POST(request('bad'))).status).toBe(400);
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request(token))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
