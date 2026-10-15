import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const COMMANDS = new Set([
  'configure',
  'professional',
  'resource',
  'service',
  'product',
  'stock',
  'book',
  'appointment_status',
  'close',
  'payment',
  'proof',
  'review_proof',
  'refund',
  'settle',
  'expense',
]);
export function operationsAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Supabase service role is not configured');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
export function operationsError(error: { code?: string; message?: string }) {
  const code = error.code ?? '';
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code))
    return NextResponse.json(
      {
        error:
          'Los módulos operativos necesitan activar las migraciones 056–060 en Supabase.',
        code: 'migration_required',
      },
      { status: 503 }
    );
  if (code === '42501')
    return NextResponse.json(
      {
        error: 'Tu rol, suscripción o actividad no permite esta acción.',
        code: 'access_denied',
      },
      { status: 403 }
    );
  if (code === '23P01')
    return NextResponse.json(
      {
        error: 'Ese horario ya no está disponible. Elige otro.',
        code: 'slot_conflict',
      },
      { status: 409 }
    );
  if (code === '23505')
    return NextResponse.json(
      {
        error:
          'El registro o comprobante ya existe. Revisa si se está reutilizando.',
        code: 'duplicate',
      },
      { status: 409 }
    );
  if (
    [
      '22023',
      '22P02',
      '22007',
      '22008',
      '23514',
      '23502',
      '23503',
      '22003',
    ].includes(code)
  )
    return NextResponse.json(
      {
        error:
          code === '22023' || code === '23514'
            ? (error.message ?? 'Revisa los datos de la operación.')
            : 'Revisa importes, fechas y registros seleccionados.',
        code: 'invalid_operation',
      },
      { status: 400 }
    );
  console.error('[operations]', code);
  return NextResponse.json(
    { error: 'No se pudo completar la operación. Puedes reintentar.' },
    { status: 500 }
  );
}
export function foreignOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !!origin && origin !== new URL(request.url).origin;
}
