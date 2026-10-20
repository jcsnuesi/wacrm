import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '@/lib/auth/account';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invite: vi.fn(),
  otp: vi.fn(),
  admin: vi.fn(),
  create: vi.fn(),
}));
vi.mock('./server', async (original) => ({
  ...(await original<typeof import('./server')>()),
  operationsAdmin: mocks.admin,
}));
import {
  employeeInviteToken,
  employeeProfessionalId,
  manageEmployeeAccess,
} from './employee-access';
import { hashInviteToken } from '@/lib/auth/invitations';
const id = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const context = (role = 'admin') =>
  ({
    accountId,
    role,
    supabase: { rpc: mocks.rpc },
  }) as unknown as AccountContext;
const payload = {
  mode: 'save',
  email: 'employee@example.com',
  modules: ['appointments'],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', 'test-invitation-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
  const token = employeeInviteToken(accountId, id, requestId);
  mocks.rpc.mockImplementation(async (name) =>
    name === 'ops_employee_prepare'
      ? {
          data: {
            send_required: true,
            status: 'pending',
            email: payload.email,
            request_id: requestId,
            token_hash: hashInviteToken(token),
            auth_user_exists: false,
            auth_user_confirmed: false,
            provision_user_id: id,
          },
          error: null,
        }
      : { data: null, error: null }
  );
  mocks.admin.mockReturnValue({
    auth: {
      admin: { inviteUserByEmail: mocks.invite, createUser: mocks.create },
      signInWithOtp: mocks.otp,
    },
  });
  mocks.invite.mockResolvedValue({ error: null });
  mocks.create.mockResolvedValue({ error: null });
  mocks.otp.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('administered employee access', () => {
  it('uses the same stable record ID as the SQL generator', () => {
    expect(employeeProfessionalId(accountId, requestId)).toBe(
      'ab087a87-e5e5-40dc-8444-013269762f1a'
    );
  });
  it('prepares scoped access before creating Auth users and sends the canonical activation URL', async () => {
    const result = await manageEmployeeAccess(
      context(),
      id,
      payload,
      requestId
    );
    expect(result).toMatchObject({ delivery: 'sent' });
    expect(mocks.rpc.mock.calls[0][0]).toBe('ops_employee_prepare');
    expect(mocks.invite).toHaveBeenCalledWith(payload.email, {
      redirectTo: `https://crm.example.com/employee/activate?token=${employeeInviteToken(accountId, id, requestId)}`,
    });
    expect(mocks.otp).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      id,
      email: payload.email,
      email_confirm: false,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'ops_employee_delivery',
      expect.objectContaining({ p_account: accountId, p_professional: id })
    );
  });

  it('allows an existing user to accept without recreating or changing their other memberships', async () => {
    const prior = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => {
      const result = await prior(...args);
      return args[0] === 'ops_employee_prepare'
        ? {
            ...result,
            data: {
              ...result.data,
              auth_user_exists: true,
              auth_user_confirmed: true,
            },
          }
        : result;
    });
    await manageEmployeeAccess(context(), id, payload, requestId);
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(mocks.otp).toHaveBeenCalledWith({
      email: payload.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: expect.stringContaining('/employee/activate?token='),
      },
    });
  });

  it('retains the saved professional and pending invitation when mail fails', async () => {
    mocks.invite.mockResolvedValue({ error: { status: 429 } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await manageEmployeeAccess(context(), id, payload, requestId)
    ).toMatchObject({ delivery: 'failed' });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'ops_employee_delivery',
      expect.anything()
    );
    log.mockRestore();
  });

  it.each(['professional', 'viewer', 'agent'])(
    'rejects %s before any privileged call',
    async (role) => {
      const result = await manageEmployeeAccess(
        context(role),
        id,
        payload,
        requestId
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.admin).not.toHaveBeenCalled();
    }
  );

  it('does not provision an Auth user when the checked RPC rejects the request', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501' } });
    const result = await manageEmployeeAccess(
      context(),
      id,
      payload,
      requestId
    );
    expect((result as Response).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('changes active permissions without sending an activation email', async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: 'active', send_required: false },
      error: null,
    });
    expect(
      await manageEmployeeAccess(context(), id, payload, requestId)
    ).toMatchObject({ delivery: 'unchanged' });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('resends to an unconfirmed account without creating another user', async () => {
    const prior = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => {
      const result = await prior(...args);
      return args[0] === 'ops_employee_prepare'
        ? { ...result, data: { ...result.data, auth_user_exists: true } }
        : result;
    });
    await manageEmployeeAccess(context(), id, payload, requestId);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.invite).toHaveBeenCalled();
    expect(mocks.otp).not.toHaveBeenCalled();
  });

  it('can suspend access when mail configuration is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    mocks.rpc.mockResolvedValue({
      data: { status: 'suspended', send_required: false },
      error: null,
    });
    const result = await manageEmployeeAccess(
      context(),
      id,
      { mode: 'suspend' },
      requestId
    );
    expect(result).toMatchObject({ delivery: 'unchanged' });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('reconstructs the original token for delivery retries and isolates businesses', () => {
    expect(employeeInviteToken(accountId, id, requestId)).toBe(
      employeeInviteToken(accountId, id, requestId)
    );
    expect(employeeInviteToken(id, id, requestId)).not.toBe(
      employeeInviteToken(accountId, id, requestId)
    );
  });
});
