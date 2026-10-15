import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';
import {
  COMMANDS,
  foreignOrigin,
  operationsError,
} from '@/lib/operations/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
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
    return NextResponse.json(
      { data },
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
    const { data, error } = await ctx.supabase.rpc('ops_command', {
      p_account: ctx.accountId,
      p_action: body.action,
      p_payload: body.payload,
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
