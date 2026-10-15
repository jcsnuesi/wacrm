'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import type { PlanKey } from '@/lib/billing/plans';
import {
  BUSINESS_TEMPLATES,
  OBJECTIVES,
  getBusinessTemplate,
  templateStages,
  validStageNames,
  type BusinessObjective,
  type BusinessTemplateId,
} from '@/lib/business-templates/catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const plans: { key: PlanKey; title: string; description: string }[] = [
  {
    key: 'crm',
    title: 'CRM',
    description: 'Contactos, conversaciones y procesos del negocio.',
  },
  {
    key: 'managed',
    title: 'Automatización gestionada',
    description: 'Solicita flujos configurados por nuestro equipo.',
  },
  {
    key: 'advanced',
    title: 'Automatización avanzada',
    description:
      'Solicita capacidades adicionales. El editor requiere licencia comercial.',
  },
];

export function CreateBusinessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { switchAccount } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [plan, setPlan] = useState<PlanKey>('crm');
  const [objective, setObjective] = useState<BusinessObjective>('sell');
  const [templateId, setTemplateId] = useState<BusinessTemplateId>('generic');
  const [stages, setStages] = useState<string[]>(
    templateStages('generic', 'sell')
  );
  const template = getBusinessTemplate(templateId)!;
  function chooseTemplate(id: BusinessTemplateId, goal = objective) {
    setTemplateId(id);
    setStages(templateStages(id, goal));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const createdAccount = useRef<string | null>(null);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!createdAccount.current) {
        requestId.current ??= crypto.randomUUID();
        const response = await fetch('/api/account/businesses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            industry,
            currency,
            plan,
            template_id: templateId,
            template_version: template.version,
            objective,
            stage_names: stages,
            request_id: requestId.current,
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || 'No se pudo crear el negocio.');
        createdAccount.current = payload.account_id;
      }
      const switched = await switchAccount(createdAccount.current!);
      if (!switched.ok)
        throw new Error(
          'El negocio se creó, pero no se pudo abrir. Reintenta para abrirlo.'
        );
      onOpenChange(false);
      setStep(0);
      setName('');
      setIndustry('');
      setPlan('crm');
      setObjective('sell');
      chooseTemplate('generic', 'sell');
      requestId.current = null;
      createdAccount.current = null;
      router.push('/plan');
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo completar el alta.'
      );
    } finally {
      setBusy(false);
    }
  }
  const field = 'grid gap-2';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Crear negocio</DialogTitle>
          <DialogDescription>
            Paso {step + 1} de 5 · Datos, conexiones y plan independientes.
          </DialogDescription>
        </DialogHeader>
        {step === 0 && (
          <div className="grid gap-4">
            <label className={field}>
              Nombre del negocio
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </label>
            <label className={field}>
              Rubro
              <Input
                value={industry}
                onChange={(e) => {
                  const value = e.target.value;
                  setIndustry(value);
                  if (/inmobiliari/i.test(value)) {
                    setObjective('sell');
                    chooseTemplate('real_estate', 'sell');
                  }
                }}
                maxLength={80}
                list="business-industries"
                placeholder="Ej. comercio, educación o servicios"
              />
              <datalist id="business-industries">
                <option value="Inmobiliaria" />
                <option value="Comercio" />
                <option value="Educación" />
                <option value="Servicios" />
                <option value="Otro" />
              </datalist>
            </label>
            <label className={field}>
              Moneda
              <select
                className="border-input bg-background rounded-lg border p-2"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {step === 1 && (
          <label className={field}>
            Objetivo principal
            <select
              className="border-input bg-background rounded-lg border p-2"
              value={objective}
              aria-label="Objetivo principal"
              onChange={(e) => {
                const goal = e.target.value as BusinessObjective;
                setObjective(goal);
                const next = (
                  template.objectives as readonly string[]
                ).includes(goal)
                  ? templateId
                  : goal === 'schedule'
                    ? 'generic'
                    : 'real_estate';
                chooseTemplate(next, goal);
              }}
            >
              {OBJECTIVES.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {step === 2 && (
          <div className="grid max-h-[55vh] gap-4 overflow-y-auto">
            <label className={field}>
              Plantilla inicial
              <select
                aria-label="Plantilla inicial"
                name="business-template"
                className="border-input bg-background rounded-lg border p-2"
                value={templateId}
                onChange={(e) =>
                  chooseTemplate(e.target.value as BusinessTemplateId)
                }
              >
                {BUSINESS_TEMPLATES.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      !(item.objectives as readonly string[]).includes(
                        objective
                      )
                    }
                  >
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-sm">
              {template.description}
            </p>
            {stages.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-2 font-medium">
                  Vista previa de etapas · Puedes ajustarlas
                </legend>
                {stages.map((stage, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      aria-label={`Etapa ${index + 1}`}
                      value={stage}
                      maxLength={60}
                      onChange={(e) =>
                        setStages(
                          stages.map((value, i) =>
                            i === index ? e.target.value : value
                          )
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      aria-label={`Quitar etapa ${index + 1}`}
                      disabled={stages.length <= 2}
                      onClick={() =>
                        setStages(stages.filter((_, i) => i !== index))
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={stages.length >= 12}
                  onClick={() => setStages([...stages, 'Nueva etapa'])}
                >
                  Agregar etapa
                </Button>
              </fieldset>
            )}
            <p className="text-muted-foreground text-sm">
              Campos de contacto:{' '}
              {template.fields.length ? template.fields.join(', ') : 'ninguno'}.
              Se crean vacíos y podrás personalizarlos desde el CRM.
            </p>
            <p className="text-muted-foreground text-sm">
              Esta plantilla configura tu proceso. No conecta publicidad ni
              activa automatizaciones o módulos pagados.
            </p>
          </div>
        )}
        {step === 3 && (
          <fieldset className="grid gap-3">
            <legend className="mb-2 font-medium">
              Elige el plan que te interesa
            </legend>
            {plans.map((p) => (
              <label
                key={p.key}
                className="border-border flex cursor-pointer gap-3 rounded-lg border p-3"
              >
                <input
                  type="radio"
                  name="business-plan"
                  value={p.key}
                  checked={plan === p.key}
                  onChange={() => setPlan(p.key)}
                />
                <span>
                  <span className="block font-medium">{p.title}</span>
                  <span className="text-muted-foreground text-sm">
                    {p.description}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-muted-foreground text-sm">
              No hay cobro automático. Los planes adicionales son solicitudes
              pendientes de contratación y activación; no habilitan funciones
              pagadas.
            </p>
          </fieldset>
        )}
        {step === 4 && (
          <div className="grid gap-3">
            <p className="font-medium">{name}</p>
            <p>
              {industry} · {currency}
            </p>
            <p>Plan solicitado: {plans.find((p) => p.key === plan)?.title}</p>
            <p>
              Objetivo:{' '}
              {OBJECTIVES.find((goal) => goal.id === objective)?.label}
            </p>
            <p>
              Plantilla: {template.name} · versión {template.version}
            </p>
            <p className="text-muted-foreground text-sm">
              {stages.length
                ? stages.join(' → ')
                : 'Sin etapas preconfiguradas'}
            </p>
            <p className="text-muted-foreground text-sm">
              Serás propietario con tu mismo correo. El negocio empieza vacío:
              no se copian contactos, cuentas publicitarias, credenciales ni
              automatizaciones de tus otros negocios.
            </p>
            <p className="text-muted-foreground text-sm">
              El acceso contratado requiere configuración y activación. Esta
              alta no realiza cargos.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              disabled={busy || !!createdAccount.current}
              onClick={() => {
                setStep(step - 1);
                setError('');
                requestId.current = null;
              }}
            >
              Atrás
            </Button>
          )}
          {step < 4 ? (
            <Button
              disabled={
                (step === 0 && (!name.trim() || !industry.trim())) ||
                (step === 2 && !validStageNames(stages, templateId))
              }
              onClick={() => setStep(step + 1)}
            >
              Continuar
            </Button>
          ) : (
            <Button disabled={busy} onClick={submit}>
              {busy
                ? 'Creando…'
                : createdAccount.current
                  ? 'Abrir negocio creado'
                  : 'Crear y abrir negocio'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
