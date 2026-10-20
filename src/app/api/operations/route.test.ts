import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  access: vi.fn(),
}));
vi.mock('@/lib/operations/employee-access', async (original) => ({
  ...(await original<typeof import('@/lib/operations/employee-access')>()),
  manageEmployeeAccess: mock.access,
}));
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
    role: 'admin',
    supabase: { rpc: mock.rpc },
  });
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  mock.access.mockResolvedValue({
    notice: 'Permisos guardados.',
    delivery: 'unchanged',
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('operational API', () => {
  it('saves a professional and access atomically before attempting delivery', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    const access = {
      mode: 'save',
      email: 'employee@example.com',
      modules: ['appointments'],
    };
    const prepared = { status: 'pending', send_required: true };
    mock.rpc.mockResolvedValue({
      data: { professional: { id: key }, access: prepared },
      error: null,
    });
    const response = await POST(
      request({
        action: 'professional',
        payload: { name: 'Jean', employee_access: access },
        request_id: key,
      })
    );
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith(
      'ops_employee_save',
      expect.objectContaining({
        p_account: 'business-a',
        p_access: access,
        p_request: key,
      })
    );
    expect(mock.access).toHaveBeenCalledWith(
      expect.anything(),
      key,
      access,
      key,
      prepared
    );
  });
  it('does not start email delivery when atomic access validation fails', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    mock.rpc.mockResolvedValue({ error: { code: '22023' } });
    const response = await POST(
      request({
        action: 'professional',
        payload: {
          employee_access: {
            mode: 'save',
            email: 'a@example.com',
            modules: ['invalid'],
          },
        },
        request_id: key,
      })
    );
    expect(response.status).toBe(400);
    expect(mock.access).not.toHaveBeenCalled();
  });
  it.each([null, { primary_activity: null, additional_activities: null }])(
    'returns no config for an unconfigured business (%j)',
    async (config) => {
      mock.rpc.mockResolvedValue({
        data: { account_id: 'business-a', config, professionals: [] },
        error: null,
      });
      const response = await GET(
        new Request('http://localhost/api/operations')
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        account_id: 'business-a',
        config: null,
        professionals: [],
      });
    }
  );
  it('preserves a configured business and its enabled activities', async () => {
    const data = {
      account_id: 'business-a',
      config: {
        primary_activity: 'services',
        additional_activities: ['products'],
        disabled_modules: [],
      },
    };
    mock.rpc.mockResolvedValue({ data, error: null });
    const response = await GET(new Request('http://localhost/api/operations'));
    expect((await response.json()).data).toEqual(data);
  });
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
