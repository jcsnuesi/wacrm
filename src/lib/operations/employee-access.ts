import { createHash, createHmac } from 'node:crypto';
import type { AccountContext } from '@/lib/auth/account';
import { hashInviteToken } from '@/lib/auth/invitations';
import { isUuid } from '@/lib/auth/active-account';
import { operationsAdmin, operationsError } from './server';
import { NextResponse } from 'next/server';

export function employeeInviteToken(
  account: string,
  professional: string,
  request: string
) {
  const secret =
    process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Employee invitation secret is not configured');
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([
        'employee-invite-v1',
        account.toLowerCase(),
        professional.toLowerCase(),
        request.toLowerCase(),
      ])
    )
    .digest('base64url');
}

/** Matches the SQL ID generator; it is not an access token. */
export function employeeProfessionalId(account: string, request: string) {
  const digest = createHash('md5')
    .update(account.toLowerCase() + request.toLowerCase())
    .digest('hex');
  const hex =
    digest.slice(0, 12) + '4' + digest.slice(13, 16) + '8' + digest.slice(17);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function employeeSiteUrl() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** Auth provisioning stays on the server, after the caller's scoped RPC checks. */
export async function manageEmployeeAccess(
  ctx: AccountContext,
  professionalId: string,
  payload: Record<string, unknown>,
  requestId: string,
  preparedAccess?: Record<string, unknown>
): Promise<
  NextResponse | { notice: string; delivery: 'sent' | 'failed' | 'unchanged' }
> {
  if (!['owner', 'admin'].includes(ctx.role))
    return NextResponse.json(
      { error: 'Solo administración puede gestionar accesos.' },
      { status: 403 }
    );
  const mode = payload.mode ?? 'save';
  if (
    !isUuid(professionalId) ||
    !isUuid(requestId) ||
    !['save', 'invite', 'suspend'].includes(String(mode)) ||
    (mode !== 'suspend' &&
      (typeof payload.email !== 'string' ||
        !Array.isArray(payload.modules) ||
        payload.modules.length > 32 ||
        payload.modules.some((item) => typeof item !== 'string')))
  )
    return NextResponse.json(
      { error: 'Revisa el correo y los permisos del empleado.' },
      { status: 400 }
    );

  // A configured canonical URL avoids sending an activation link to a Host header.
  const base = employeeSiteUrl();
  if (mode !== 'suspend' && !base) {
    return NextResponse.json(
      { error: 'Configura la URL pública del CRM antes de habilitar accesos.' },
      { status: 503 }
    );
  }
  const proposedToken =
    mode === 'suspend'
      ? ''
      : employeeInviteToken(ctx.accountId, professionalId, requestId);
  const prepared = preparedAccess
    ? { data: preparedAccess, error: null }
    : await ctx.supabase.rpc('ops_employee_prepare', {
        p_account: ctx.accountId,
        p_professional: professionalId,
        p_email: payload.email ?? null,
        p_modules: payload.modules ?? null,
        p_mode: mode,
        p_hash: mode === 'suspend' ? null : hashInviteToken(proposedToken),
        p_request: requestId,
      });
  if (prepared.error) return operationsError(prepared.error);
  const access = prepared.data;
  if (!access?.send_required)
    return {
      notice:
        mode === 'suspend'
          ? 'Acceso suspendido. El historial se conserva.'
          : 'Permisos guardados.',
      delivery: 'unchanged',
    };

  // Reconstruct the same link after a delivery failure or an idempotent retry.
  const token = employeeInviteToken(
    ctx.accountId,
    professionalId,
    access.request_id
  );
  if (hashInviteToken(token) !== access.token_hash)
    return {
      notice:
        'El profesional quedó guardado. Usa Reenviar acceso para generar una invitación nueva.',
      delivery: 'failed',
    };
  const redirect = new URL('/employee/activate', base!.origin);
  redirect.searchParams.set('token', token);
  const auth = operationsAdmin().auth;
  try {
    const options = { redirectTo: redirect.toString() };
    let error;
    if (!access.auth_user_exists) {
      const created = await auth.admin.createUser({
        id: access.provision_user_id,
        email: access.email,
        email_confirm: false,
      });
      if (created.error) throw new Error('Employee provisioning failed');
    }
    if (access.auth_user_confirmed) {
      ({ error } = await auth.signInWithOtp({
        email: access.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirect.toString(),
        },
      }));
    } else {
      ({ error } = await auth.admin.inviteUserByEmail(access.email, options));
    }
    if (error) {
      // Do not undo the saved professional, delete an Auth user, or log link tokens.
      console.error(
        '[employee-invite] delivery failed',
        error.status ?? 'unknown'
      );
      return {
        notice:
          'Profesional y permisos guardados. No se pudo enviar el acceso; usa Reenviar acceso.',
        delivery: 'failed',
      };
    }
    const delivery = await ctx.supabase.rpc('ops_employee_delivery', {
      p_account: ctx.accountId,
      p_professional: professionalId,
      p_hash: access.token_hash,
    });
    if (delivery.error)
      return {
        notice:
          'Correo enviado. No se pudo confirmar su estado; puedes actualizar la pantalla.',
        delivery: 'sent',
      };
    return {
      notice:
        'Acceso enviado. El empleado recibirá un enlace para activar su cuenta.',
      delivery: 'sent',
    };
  } catch {
    return {
      notice:
        'Profesional y permisos guardados. El envío falló; puedes reintentarlo desde Reenviar acceso.',
      delivery: 'failed',
    };
  }
}
