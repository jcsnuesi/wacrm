import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  isActiveAccountSwitchEnabled,
  isUuid,
} from '@/lib/auth/active-account';
import { CURRENCIES } from '@/lib/currency';
import { PLAN_KEYS } from '@/lib/billing/plans';
import {
  getBusinessTemplate,
  validStageNames,
} from '@/lib/business-templates/catalog';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    if (!isActiveAccountSwitchEnabled())
      return NextResponse.json(
        { error: 'El alta de negocios está desactivada.' },
        { status: 404 }
      );
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      return NextResponse.json(
        { error: 'Origen no autorizado.' },
        { status: 403 }
      );
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(
      `business:create:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const industry =
      typeof body?.industry === 'string' ? body.industry.trim() : '';
    if (
      !name ||
      name.length > 80 ||
      !industry ||
      industry.length > 80 ||
      !CURRENCIES.some((c) => c.code === body?.currency) ||
      !PLAN_KEYS.includes(body?.plan) ||
      typeof body?.request_id !== 'string' ||
      !isUuid(body.request_id)
    ) {
      return NextResponse.json(
        { error: 'Revisa el nombre, rubro, moneda y plan del negocio.' },
        { status: 400 }
      );
    }
    const template = getBusinessTemplate(body.template_id);
    if (
      !template ||
      body.template_version !== template.version ||
      !(template.objectives as readonly string[]).includes(body.objective) ||
      !validStageNames(body.stage_names, template.id)
    ) {
      return NextResponse.json(
        { error: 'Revisa la plantilla, el objetivo y sus etapas.' },
        { status: 400 }
      );
    }
    const { data, error } = await ctx.supabase.rpc(
      'create_business_with_template',
      {
        p_name: name,
        p_industry: industry,
        p_currency: body.currency,
        p_requested_plan: body.plan,
        p_request_id: body.request_id,
        p_template_id: template.id,
        p_template_version: template.version,
        p_objective: body.objective,
        p_stage_names: body.stage_names.map((name: string) => name.trim()),
      }
    );
    if (error) {
      if (['PGRST202', '42883'].includes(error.code))
        return NextResponse.json(
          {
            error:
              'El alta con plantillas necesita activar las migraciones 057 y 058 en Supabase.',
            code: 'migration_required',
          },
          { status: 503 }
        );
      if (error.code === '54000')
        return NextResponse.json(
          {
            error:
              'Alcanzaste el límite de negocios. Contacta al administrador.',
          },
          { status: 409 }
        );
      console.error('[create business]', error.code);
      return NextResponse.json(
        { error: 'No se pudo crear el negocio. Puedes reintentar.' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { account_id: data, requested_plan: body.plan },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
