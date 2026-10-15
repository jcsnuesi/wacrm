import { NextResponse } from 'next/server';
import {
  operationsAdmin,
  operationsError,
  foreignOrigin,
} from '@/lib/operations/server';
import { isUuid } from '@/lib/auth/active-account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  if (!/^b-[a-f0-9]{32}$/.test(slug))
    return NextResponse.json(
      { error: 'Reserva no disponible.' },
      { status: 404 }
    );
  const rate = checkRateLimit(
    `booking-read:${slug}:${request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'}`,
    { limit: 120, windowMs: 60_000 }
  );
  if (!rate.success) return rateLimitResponse(rate);
  const search = new URL(request.url).searchParams;
  const service = search.get('service_id');
  const professional = search.get('professional_id');
  const date = search.get('date');
  try {
    const db = operationsAdmin();
    const result =
      service || professional || date
        ? !service ||
          !professional ||
          !date ||
          !isUuid(service) ||
          !isUuid(professional) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date)
          ? null
          : await db.rpc('ops_public_slots', {
              p_slug: slug,
              p_service: service,
              p_professional: professional,
              p_date: date,
            })
        : await db.rpc('ops_public_catalog', { p_slug: slug });
    if (!result)
      return NextResponse.json(
        { error: 'Selección no válida.' },
        { status: 400 }
      );
    if (result.error) return operationsError(result.error);
    if (result.data === null)
      return NextResponse.json(
        { error: 'Reserva no disponible.' },
        { status: 404 }
      );
    return NextResponse.json(
      { data: result.data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Reserva no disponible temporalmente.' },
      { status: 503 }
    );
  }
}
export async function POST(request: Request, context: Context) {
  const { slug } = await context.params;
  if (!/^b-[a-f0-9]{32}$/.test(slug))
    return NextResponse.json(
      { error: 'Reserva no disponible.' },
      { status: 404 }
    );
  if (foreignOrigin(request))
    return NextResponse.json(
      { error: 'Origen no autorizado.' },
      { status: 403 }
    );
  const rate = checkRateLimit(
    `booking:${slug}:${request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'}`,
    { limit: 8, windowMs: 600_000 }
  );
  if (!rate.success) return rateLimitResponse(rate);
  try {
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: 'Solicitud demasiado grande.' },
        { status: 413 }
      );
    const body = JSON.parse(text);
    if (
      !isUuid(body?.request_id ?? '') ||
      body?.website ||
      !Array.isArray(body?.service_ids) ||
      body.service_ids.length !== 1 ||
      !body.service_ids.every(
        (id: unknown) => typeof id === 'string' && isUuid(id)
      ) ||
      !isUuid(body?.professional_id ?? '') ||
      typeof body?.starts_at !== 'string' ||
      !Number.isFinite(Date.parse(body.starts_at)) ||
      typeof body?.client_name !== 'string' ||
      typeof body?.client_phone !== 'string'
    )
      return NextResponse.json(
        { error: 'Revisa tus datos y el horario.' },
        { status: 400 }
      );
    const result = await operationsAdmin().rpc('ops_public_book', {
      p_slug: slug,
      p_payload: {
        service_ids: body.service_ids,
        professional_id: body.professional_id,
        starts_at: body.starts_at,
        client_name: body.client_name,
        client_phone: body.client_phone,
      },
      p_request_id: body.request_id,
    });
    if (result.error) return operationsError(result.error);
    return NextResponse.json(
      { data: result.data },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      {
        error: 'No se pudo registrar la reserva. Revisa los datos o reintenta.',
      },
      { status: 400 }
    );
  }
}
