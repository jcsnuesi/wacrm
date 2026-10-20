import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.ctx,
  toErrorResponse: () => Response.json({}, { status: 401 }),
}));
vi.mock('@/lib/operations/server', () => ({
  foreignOrigin: () => false,
  operationsError: (e: { code: string }) =>
    Response.json(e, { status: e.code ? 403 : 500 }),
  operationsAdmin: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        remove: mocks.remove,
        createSignedUrl: mocks.signed,
      }),
    },
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/app/api/whatsapp/media/[mediaId]/route', () => ({ GET: vi.fn() }));
import { POST, GET } from './route';
const account = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const operation = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const uploadRequest = (content = '%PDF-1.4\nfixture') => {
  const form = new FormData();
  form.set('operation_id', operation);
  form.set('request_id', key);
  form.set('declared_minor', '90000');
  form.set(
    'file',
    new File([content], 'voucher.pdf', { type: 'application/pdf' })
  );
  return new Request('http://localhost/api/operations/proofs', {
    method: 'POST',
    body: form,
  });
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ctx.mockResolvedValue({
    accountId: account,
    userId: user,
    supabase: { rpc: mocks.rpc },
  });
  mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: {}, error: null });
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'ops_dashboard'
      ? { data: { operations: [{ id: operation }] } }
      : name === 'ops_command'
        ? { data: { id: key, status: 'pending' } }
        : { data: { file_path: `${account}/${user}/prior-file` } }
  );
});
describe('private proof boundary', () => {
  it('rejects disabled employee proofs before privileged storage upload', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        role: 'professional',
        allowed_modules: ['sales'],
        operations: [{ id: operation }],
      },
    });
    expect((await POST(uploadRequest())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'ops_command',
      expect.anything()
    );
  });
  it('stores a private file and requests a pending proof instead of crediting cash', async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    const call = mocks.rpc.mock.calls.find((c) => c[0] === 'ops_command')!;
    expect(call[1]).toMatchObject({
      p_account: account,
      p_action: 'proof',
      p_request_id: key,
      p_payload: { operation_id: operation, declared_minor: 90000 },
    });
    expect(call[1].p_payload.file_path.startsWith(`${account}/${user}/`)).toBe(
      true
    );
    expect(mocks.rpc.mock.calls.some((c) => c[1]?.p_action === 'payment')).toBe(
      false
    );
  });
  it('rejects a disguised file before privileged upload', async () => {
    expect((await POST(uploadRequest('html'))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('preserves an uploaded file after an uncertain RPC transport outcome', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'ops_dashboard'
        ? { data: { operations: [{ id: operation }] } }
        : { error: { code: '', message: 'transport failure' } }
    );
    expect((await POST(uploadRequest())).status).toBe(500);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('uses checked file lookup and short-lived private links', async () => {
    mocks.signed.mockResolvedValue({
      data: { signedUrl: 'https://example.test/signed' },
      error: null,
    });
    const response = await GET(
      new Request(`http://localhost/api/operations/proofs?id=${key}`)
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('ops_proof_file', {
      p_account: account,
      p_id: key,
    });
    expect(mocks.signed).toHaveBeenCalledWith(
      `${account}/${user}/prior-file`,
      120
    );
  });
});
