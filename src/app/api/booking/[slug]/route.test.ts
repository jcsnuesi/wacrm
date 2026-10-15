import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/operations/server', () => ({
  operationsAdmin: () => ({ rpc: mock.rpc }),
  operationsError: (e: { code: string }) => Response.json(e, { status: 409 }),
  foreignOrigin: () => false,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));
import { GET, POST } from './route';
const slug = 'b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const context = { params: Promise.resolve({ slug }) };
const key = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.resetAllMocks();
  mock.rpc.mockResolvedValue({ data: { name: 'Public' }, error: null });
});
describe('public booking boundary', () => {
  it('exposes only the public catalog RPC', async () => {
    expect(
      (await GET(new Request(`http://localhost/api/booking/${slug}`), context))
        .status
    ).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('ops_public_catalog', {
      p_slug: slug,
    });
  });
  it('does not accept injected business or financial fields', async () => {
    const body = {
      request_id: key,
      service_ids: [key],
      professional_id: key,
      starts_at: '2026-12-01T10:00:00Z',
      client_name: 'Client',
      client_phone: '+18095550000',
      account_id: 'victim',
      amount_minor: 0,
      role: 'owner',
    };
    expect(
      (
        await POST(
          new Request(`http://localhost/api/booking/${slug}`, {
            method: 'POST',
            body: JSON.stringify(body),
          }),
          context
        )
      ).status
    ).toBe(201);
    expect(mock.rpc).toHaveBeenCalledWith('ops_public_book', {
      p_slug: slug,
      p_request_id: key,
      p_payload: {
        service_ids: [key],
        professional_id: key,
        starts_at: body.starts_at,
        client_name: 'Client',
        client_phone: body.client_phone,
      },
    });
  });
  it('rejects hidden bot input and malformed service IDs', async () => {
    expect(
      (
        await POST(
          new Request(`http://localhost/api/booking/${slug}`, {
            method: 'POST',
            body: JSON.stringify({ website: 'spam', request_id: key }),
          }),
          context
        )
      ).status
    ).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
