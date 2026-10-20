import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { hashInviteToken } from '@/lib/auth/invitations';
import { ACTIVE_ACCOUNT_COOKIE } from '@/lib/auth/active-account';
import { foreignOrigin, operationsError } from '@/lib/operations/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: Request) {
  if (foreignOrigin(request))
    return NextResponse.json(
      { error: 'Origen no autorizado.' },
      { status: 403 }
    );
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    return NextResponse.json(
      { error: 'Inicia sesión para activar el acceso.' },
      { status: 401 }
    );
  const rate = checkRateLimit(`employee-activate:${user.id}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.success) return rateLimitResponse(rate);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 1024) throw new Error();
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: 'Solicitud no válida.' },
      { status: 400 }
    );
  }
  if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token))
    return NextResponse.json(
      { error: 'El enlace de activación no es válido.' },
      { status: 400 }
    );
  const accepted = await supabase.rpc('ops_employee_accept', {
    p_hash: hashInviteToken(body.token),
  });
  if (accepted.error) return operationsError(accepted.error);
  (await cookies()).set(ACTIVE_ACCOUNT_COOKIE, accepted.data, {
    httpOnly: true,
    secure:
      new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).protocol ===
      'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
