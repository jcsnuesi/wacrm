import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';
import {
  COMMANDS,
  foreignOrigin,
  operationsError,
} from '@/lib/operations/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  employeeInviteToken,
  employeeProfessionalId,
  employeeSiteUrl,
  manageEmployeeAccess,
} from '@/lib/operations/employee-access';
import { hashInviteToken } from '@/lib/auth/invitations';
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount({ allowProfessional: true });
    const month = new URL(request.url).searchParams.get('month');
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      return NextResponse.json({ error: 'Mes no válido.' }, { status: 400 });
    const { data, error } = await ctx.supabase.rpc('ops_dashboard', {
      p_account: ctx.accountId,
      p_month: month,
    });
    if (error) return operationsError(error);
    // Older RPC definitions serialize a missing config as an object of nulls.
    // Keep the first-use setup screen working before migration 061 is applied.
    const dashboard = data
      ? {
          ...data,
          config: data.config?.primary_activity == null ? null : data.config,
        }
      : data;
    return NextResponse.json(
      { data: dashboard },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (foreignOrigin(request))
      return NextResponse.json(
        { error: 'Origen no autorizado.' },
        { status: 403 }
      );
    const ctx = await getCurrentAccount({ allowProfessional: true });
    const rate = checkRateLimit(`ops:${ctx.userId}:${ctx.accountId}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.success) return rateLimitResponse(rate);
    const text = await request.text();
    if (text.length > 65536)
      return NextResponse.json(
        { error: 'Solicitud demasiado grande.' },
        { status: 413 }
      );
    const body = JSON.parse(text);
    if (body?.client_account_id && body.client_account_id !== ctx.accountId)
      return NextResponse.json(
        {
          error: 'Cambiaste de negocio. Abre nuevamente el formulario.',
          code: 'account_changed',
        },
        { status: 409 }
      );
    if (
      !COMMANDS.has(body?.action) ||
      typeof body?.request_id !== 'string' ||
      !isUuid(body.request_id) ||
      !body?.payload ||
      typeof body.payload !== 'object' ||
      Array.isArray(body.payload)
    )
      return NextResponse.json(
        { error: 'Solicitud no válida.' },
        { status: 400 }
      );
    if (body.action === 'employee_access') {
      const outcome = await manageEmployeeAccess(
        ctx,
        body.payload.professional_id ?? '',
        body.payload,
        body.request_id
      );
      if (outcome instanceof Response) return outcome;
      return NextResponse.json(outcome, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    // Access management has a separate, admin-checked RPC. Never pass the email
    // through the legacy "link an existing user" field when provisioning staff.
    const payload = { ...body.payload };
    const access = payload.employee_access;
    delete payload.employee_access;
    if (body.action === 'professional' && access) {
      if (!['owner', 'admin'].includes(ctx.role))
        return NextResponse.json(
          { error: 'Solo administración puede crear empleados con acceso.' },
          { status: 403 }
        );
      if (access.mode !== 'suspend' && !employeeSiteUrl())
        return NextResponse.json(
          {
            error:
              'Configura la URL pública del CRM antes de habilitar accesos.',
          },
          { status: 503 }
        );
      const professionalId =
        payload.id ?? employeeProfessionalId(ctx.accountId, body.request_id);
      if (!isUuid(professionalId))
        return NextResponse.json(
          { error: 'Profesional no válido.' },
          { status: 400 }
        );
      const saved = await ctx.supabase.rpc('ops_employee_save', {
        p_account: ctx.accountId,
        p_payload: payload,
        p_access: access,
        p_request: body.request_id,
        p_hash:
          access.mode === 'suspend'
            ? null
            : hashInviteToken(
                employeeInviteToken(
                  ctx.accountId,
                  professionalId,
                  body.request_id
                )
              ),
      });
      if (saved.error) return operationsError(saved.error);
      const outcome = await manageEmployeeAccess(
        ctx,
        saved.data.professional.id,
        access,
        body.request_id,
        saved.data.access
      );
      if (outcome instanceof Response) return outcome;
      return NextResponse.json(
        { data: saved.data.professional, ...outcome },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const { data, error } = await ctx.supabase.rpc('ops_command', {
      p_account: ctx.accountId,
      p_action: body.action,
      p_payload: payload,
      p_request_id: body.request_id,
    });
    if (error) return operationsError(error);
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: 'JSON no válido.' }, { status: 400 });
    return toErrorResponse(error);
  }
}
