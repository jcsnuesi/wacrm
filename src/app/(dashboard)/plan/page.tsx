import { getTranslations } from 'next-intl/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { readAccountPlan } from '@/lib/billing/account-plan';
import { FEATURES } from '@/lib/billing/plans';
import { readAccountTemplate } from '@/lib/business-templates/account-config';
import {
  getBusinessTemplate,
  OBJECTIVES,
} from '@/lib/business-templates/catalog';
import Link from 'next/link';

export default async function PlanPage() {
  const ctx = await getCurrentAccount();
  const [access, t, configuration] = await Promise.all([
    readAccountPlan(ctx.supabase, ctx.accountId),
    getTranslations('BusinessPlan'),
    readAccountTemplate(ctx.supabase, ctx.accountId),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">
          {ctx.account.name} · {t('isolated')}
        </p>
      </div>
      {configuration && (
        <section className="border-border bg-card space-y-2 rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Configuración del negocio</h2>
          <p>
            Plantilla:{' '}
            {getBusinessTemplate(configuration.template_id)?.name ??
              configuration.template_id}{' '}
            · versión {configuration.template_version}
          </p>
          <p className="text-muted-foreground">
            Objetivo:{' '}
            {OBJECTIVES.find((goal) => goal.id === configuration.objective)
              ?.label ?? configuration.objective}
          </p>
          <p className="text-muted-foreground text-sm">
            Las etapas y campos pertenecen a este negocio. Puedes
            personalizarlos; las nuevas versiones de la plantilla no reemplazan
            tus ajustes automáticamente.
          </p>
          {configuration.pipeline_id && (
            <Link href="/pipelines" className="text-primary underline">
              Ver y personalizar el proceso
            </Link>
          )}
        </section>
      )}
      <section className="border-border bg-card rounded-xl border p-6">
        <h2 className="text-lg font-semibold">
          {access.plan_key ? t(`plans.${access.plan_key}`) : t('unconfigured')}
        </h2>
        <p className="text-muted-foreground mt-2">
          {t(`statuses.${access.status}`)}
        </p>
        {access.reason !== 'available' ? (
          <p role="status" className="text-muted-foreground mt-3">
            {t(`reasons.${access.reason}`)}
          </p>
        ) : null}
        <ul className="divide-border mt-5 divide-y">
          {FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex items-center justify-between gap-4 py-3"
            >
              <span>{t(`features.${feature}`)}</span>
              <span className="text-muted-foreground text-sm">
                {t(access.features[feature] ? 'included' : 'notIncluded')}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-muted-foreground text-sm">{t('foundationNotice')}</p>
      <p className="text-muted-foreground text-sm">{t('licensingNotice')}</p>
    </div>
  );
}
