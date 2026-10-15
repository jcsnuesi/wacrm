import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.context,
  toErrorResponse: () => Response.json({}, { status: 401 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}));
import { POST } from './route';
const valid = {
  name: 'Academia Horizonte',
  industry: 'Educación',
  currency: 'USD',
  plan: 'managed',
  request_id: '11111111-1111-4111-8111-111111111111',
  template_id: 'generic',
  template_version: 1,
  objective: 'sell',
  stage_names: ['Consulta', 'Cierre'],
};
const request = (body: unknown, origin = 'http://localhost') =>
  new Request('http://localhost/api/account/businesses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('WACRM_ENABLE_MULTI_ACCOUNT_SWITCH', 'true');
  mocks.context.mockResolvedValue({
    userId: 'caller',
    supabase: { rpc: mocks.rpc },
  });
});
describe('new business API', () => {
  it('uses authenticated RPC without trusting supplied owner or enabling paid features', async () => {
    mocks.rpc.mockResolvedValue({ data: 'new-business', error: null });
    const response = await POST(
      request({
        ...valid,
        owner_user_id: 'victim',
        workflow_editor_licensed: true,
      })
    );
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith('create_business_with_template', {
      p_name: valid.name,
      p_industry: valid.industry,
      p_currency: 'USD',
      p_requested_plan: 'managed',
      p_request_id: valid.request_id,
      p_template_id: 'generic',
      p_template_version: 1,
      p_objective: 'sell',
      p_stage_names: valid.stage_names,
    });
  });
  it('rejects unauthenticated creation', async () => {
    mocks.context.mockRejectedValue(new Error('unauthorized'));
    expect((await POST(request(valid))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects a foreign origin', async () => {
    expect((await POST(request(valid, 'https://foreign.example'))).status).toBe(
      403
    );
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, name: ' ' },
    { ...valid, currency: 'INVALID' },
    { ...valid, plan: 'unlimited' },
    { ...valid, request_id: 'invalid' },
    { ...valid, template_id: 'forged' },
    { ...valid, template_version: 99 },
    { ...valid, objective: 'rent' },
    { ...valid, stage_names: ['Cierre', ' cierre '] },
  ])('rejects invalid details', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns actionable setup status when the database migration is missing', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('migration_required');
  });
});
