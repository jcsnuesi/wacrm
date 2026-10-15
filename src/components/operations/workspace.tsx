'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  ACTIVITIES,
  activityModules,
  formatMinor,
  moneyMinor,
} from '@/lib/operations/catalog';
import { localToInstant } from '@/lib/operations/time';
import type {
  OpsData,
  Operation,
  Professional,
  Service,
  Product,
  Proof,
} from '@/lib/operations/types';
import { EntityForm, type EntityFormSpec, type FormField } from './entity-form';
import { OperationDialog } from './operation-dialog';
import { ProofDialog } from './proof-dialog';

const text = (f: FormData, key: string) => String(f.get(key) ?? '');
const number = (f: FormData, key: string) => Number(f.get(key));
const field = (
  name: string,
  label: string,
  value?: string | number,
  type: FormField['type'] = 'text',
  required = true
): FormField => ({ name, label, value, type, required });
const card = 'border-border bg-card rounded-xl border p-4';
const statusLabels: Record<string, string> = {
  open: 'Abierta',
  completed: 'Completada',
  void: 'Anulada',
  confirmed: 'Confirmada',
  in_progress: 'En atención',
  canceled: 'Cancelada',
  no_show: 'No asistió',
  pending: 'Pendiente',
  rejected: 'Rechazado',
};
export function OperationsWorkspace({
  accountName,
  sourceMessage,
  dealId,
}: {
  accountName: string;
  sourceMessage?: string;
  dealId?: string;
}) {
  const { accountId, accountRole, account } = useAuth();
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [month, setMonth] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EntityFormSpec | null>(null);
  const [closing, setClosing] = useState<{
    operation: Operation | null;
    dealId?: string;
  } | null>(null);
  const [proof, setProof] = useState<{
    operationId?: string;
    sourceMessage?: string;
  } | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const formAccount = useRef(accountId);
  const initializedSource = useRef('');
  useEffect(() => {
    let current = true;
    if (!accountId) return;
    setLoading(true);
    setError('');
    fetch(`/api/operations${month ? `?month=${month}` : ''}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (current) setData(payload.data);
      })
      .catch((err) => {
        if (current) {
          setError(err.message ?? 'No se pudo cargar.');
          setData(null);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [accountId, month, revision]);
  useEffect(() => {
    setForm(null);
    setClosing(null);
    setProof(null);
    setNotice('');
    setProofUrl('');
    pending.current = null;
    formAccount.current = accountId;
  }, [accountId]);
  useEffect(() => {
    if (
      data?.account_id !== accountId ||
      !data?.config ||
      initializedSource.current === `${accountId}:${sourceMessage}:${dealId}`
    )
      return;
    initializedSource.current = `${accountId}:${sourceMessage}:${dealId}`;
    if (sourceMessage) {
      setTab('proofs');
      setProof({ sourceMessage });
    } else if (dealId) {
      setTab('sales');
      setClosing({ operation: null, dealId });
    }
  }, [data, accountId, sourceMessage, dealId]);
  const refresh = () => setRevision((n) => n + 1);
  const run = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>
    ): Promise<boolean> => {
      if (formAccount.current !== accountId) {
        setError('Cambiaste de negocio. Abre nuevamente el formulario.');
        return false;
      }
      setBusy(true);
      setError('');
      setNotice('');
      const fingerprint = JSON.stringify({ accountId, action, payload });
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      try {
        const response = await fetch('/api/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            payload,
            request_id: pending.current.id,
            client_account_id: accountId,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        pending.current = null;
        setNotice('Operación registrada.');
        setRevision((n) => n + 1);
        return true;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo completar. Puedes reintentar.'
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accountId]
  );
  if (loading && data?.account_id !== accountId)
    return <p role="status">Cargando operación del negocio…</p>;
  if (!data || data.account_id !== accountId)
    return (
      <div className={`${card} space-y-4`}>
        <h1 className="text-2xl font-semibold">Operación · {accountName}</h1>
        <p role="alert">{error || 'No se pudo cargar el negocio.'}</p>
        <Button onClick={refresh}>Reintentar</Button>
        {accountRole !== 'professional' && (
          <Link className="text-primary ml-4 underline" href="/plan">
            Ver estado del plan
          </Link>
        )}
      </div>
    );
  const admin = ['owner', 'admin'].includes(data.role);
  const writable = data.role !== 'viewer';
  const professional = data.role === 'professional';
  const modules = data.config
    ? activityModules(
        data.config.primary_activity,
        data.config.additional_activities
      )
    : null;
  const servicesEnabled = !!modules?.services;
  const appointmentsEnabled =
    !!modules?.appointments &&
    !data.config?.disabled_modules.includes('appointments');
  const money = (value: number | null | undefined) =>
    formatMinor(value ?? 0, data.currency);
  const rawMoney = (value: number | null | undefined) =>
    (
      (value ?? 0) /
      10 **
        (new Intl.NumberFormat('en', {
          style: 'currency',
          currency: data.currency,
        }).resolvedOptions().maximumFractionDigits ?? 2)
    ).toFixed(
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: data.currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  const date = (value: string) =>
    new Intl.DateTimeFormat('es', {
      timeZone: data.config?.timezone ?? 'America/Santo_Domingo',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const staffName = (id: string | null | undefined) =>
    data.professionals.find((p) => p.id === id)?.name ?? 'Sin profesional';
  const select = (
    name: string,
    label: string,
    choices: { id: string; name: string }[],
    value = '',
    required = true
  ): FormField => ({ name, label, type: 'select', choices, value, required });
  const open = (spec: EntityFormSpec) => {
    formAccount.current = accountId;
    setError('');
    setForm(spec);
  };
  function configure() {
    open({
      title: 'Actividades y configuración',
      action: 'configure',
      description:
        'Los módulos están incluidos en CRM. Desactivarlos conserva sus datos. Finanzas e inventario mantienen la integridad de las operaciones.',
      fields: [
        select(
          'primary_activity',
          'Actividad principal',
          ACTIVITIES.map((a) => ({ id: a.id, name: a.label })),
          data!.config?.primary_activity ?? 'services'
        ),
        {
          name: 'additional_activities',
          label: 'Actividades adicionales',
          type: 'multi',
          choices: ACTIVITIES.map((a) => ({ id: a.id, name: a.label })),
          value: data!.config?.additional_activities ?? [],
        },
        field(
          'professional_label',
          'Nombre del profesional',
          data!.config?.professional_label ?? 'Profesional'
        ),
        field(
          'timezone',
          'Zona horaria',
          data!.config?.timezone ?? 'America/Santo_Domingo'
        ),
        {
          name: 'public_enabled',
          label: 'Habilitar enlace público de reservas',
          type: 'checkbox',
          value: data!.config?.public_enabled ?? false,
        },
        {
          name: 'disabled_modules',
          label: 'Módulos opcionales a desactivar',
          type: 'multi',
          choices: [
            { id: 'appointments', name: 'Agenda y reservas' },
            { id: 'products', name: 'Venta de productos' },
          ],
          value: data!.config?.disabled_modules ?? [],
        },
        select(
          'closing_stage_id',
          'Etapa para confirmar el cierre',
          [{ id: '', name: 'Sin etapa asociada' }, ...data!.stages],
          data!.config?.closing_stage_id ?? '',
          false
        ),
      ],
      payload: (f) => ({
        primary_activity: text(f, 'primary_activity'),
        additional_activities: f
          .getAll('additional_activities')
          .filter((a) => a !== text(f, 'primary_activity')),
        professional_label: text(f, 'professional_label'),
        timezone: text(f, 'timezone'),
        public_enabled: f.has('public_enabled'),
        disabled_modules: f.getAll('disabled_modules'),
        closing_stage_id: text(f, 'closing_stage_id') || null,
      }),
    });
  }
  function professionalForm(p?: Professional) {
    open({
      title: p ? 'Editar profesional' : 'Nuevo profesional',
      action: 'professional',
      description:
        'El correo es opcional. Para vincularlo, esa persona debe haberse registrado. Los porcentajes nuevos solo se aplican a cierres futuros.',
      fields: [
        field('name', 'Nombre', p?.name),
        field('specialty', 'Especialidades', p?.specialty, 'text', false),
        field('photo_url', 'URL de foto', p?.photo_url ?? '', 'url', false),
        field(
          'linked_email',
          'Correo de acceso opcional',
          p?.linked_email ?? '',
          'email',
          false
        ),
        {
          ...field(
            'service_percent',
            'Comisión por servicios (%)',
            (p?.service_bps ?? 0) / 100,
            'number'
          ),
          min: '0',
          max: '100',
          step: '0.01',
        },
        {
          ...field(
            'product_percent',
            'Comisión por productos (%)',
            (p?.product_bps ?? 0) / 100,
            'number'
          ),
          min: '0',
          max: '100',
          step: '0.01',
        },
        { name: 'hours', label: 'Horario', type: 'hours', hours: p?.hours },
        {
          name: 'active',
          label: 'Perfil activo',
          type: 'checkbox',
          value: p?.active ?? true,
        },
      ],
      payload: (f) => ({
        id: p?.id,
        name: text(f, 'name'),
        specialty: text(f, 'specialty'),
        photo_url: text(f, 'photo_url') || null,
        linked_email: text(f, 'linked_email'),
        service_bps: Math.round(number(f, 'service_percent') * 100),
        product_bps: Math.round(number(f, 'product_percent') * 100),
        active: f.has('active'),
        hours: f.getAll('workdays').map((day) => ({
          weekday: Number(day),
          start: text(f, `start${day}`),
          end: text(f, `end${day}`),
        })),
      }),
    });
  }
  function serviceForm(s?: Service) {
    open({
      title: s ? 'Editar servicio' : 'Nuevo servicio',
      action: 'service',
      fields: [
        field('name', 'Nombre', s?.name),
        field('price', 'Precio', rawMoney(s?.price_minor)),
        {
          ...field(
            'duration',
            'Duración en minutos',
            s?.duration_minutes ?? 30,
            'number'
          ),
          min: '5',
          max: '480',
        },
        select(
          'resource_id',
          'Recurso necesario',
          [
            { id: '', name: 'Ninguno' },
            ...data!.resources.filter((r) => r.active),
          ],
          s?.resource_id ?? '',
          false
        ),
        {
          name: 'professional_ids',
          label: 'Profesionales que ofrecen el servicio',
          type: 'multi',
          choices: data!.professionals.filter((p) => p.active),
          value: s?.professional_ids ?? [],
        },
        ...data!.products
          .filter((p) => p.active)
          .map((p) => ({
            ...field(
              `material_${p.id}`,
              `Consumo de ${p.name}`,
              s?.inputs.find((i) => i.product_id === p.id)?.quantity ?? 0,
              'number',
              false
            ),
            min: '0',
            step: '0.001',
          })),
        {
          name: 'active',
          label: 'Servicio activo',
          type: 'checkbox',
          value: s?.active ?? true,
        },
      ],
      payload: (f) => ({
        id: s?.id,
        name: text(f, 'name'),
        price_minor: moneyMinor(text(f, 'price'), data!.currency),
        duration_minutes: number(f, 'duration'),
        resource_id: text(f, 'resource_id') || null,
        professional_ids: f.getAll('professional_ids'),
        inputs: data!.products
          .map((p) => ({
            product_id: p.id,
            quantity: number(f, `material_${p.id}`),
          }))
          .filter((i) => i.quantity > 0),
        active: f.has('active'),
      }),
    });
  }
  function productForm(p?: Product) {
    open({
      title: p ? 'Editar producto' : 'Nuevo producto o insumo',
      action: 'product',
      fields: [
        field('name', 'Nombre', p?.name),
        field('sku', 'Código / SKU', p?.sku, 'text', false),
        field('price', 'Precio de venta', rawMoney(p?.price_minor)),
        field('cost', 'Costo por unidad', rawMoney(p?.cost_minor)),
        ...(!p
          ? [
              {
                ...field('initial_stock', 'Existencia inicial', 0, 'number'),
                min: '0',
                step: '0.001',
              },
            ]
          : []),
        {
          name: 'sellable',
          label: 'Se puede vender al cliente',
          type: 'checkbox',
          value: p?.sellable ?? true,
        },
        {
          name: 'active',
          label: 'Producto activo',
          type: 'checkbox',
          value: p?.active ?? true,
        },
      ],
      payload: (f) => ({
        id: p?.id,
        name: text(f, 'name'),
        sku: text(f, 'sku'),
        price_minor: moneyMinor(text(f, 'price'), data!.currency),
        cost_minor: moneyMinor(text(f, 'cost'), data!.currency),
        initial_stock: p ? undefined : number(f, 'initial_stock'),
        sellable: f.has('sellable'),
        active: f.has('active'),
      }),
    });
  }
  function book() {
    open({
      title: 'Nueva cita',
      action: 'book',
      description: `Los horarios se interpretan en ${data!.config?.timezone}. Cada servicio elegido debe ser ofrecido por el mismo profesional.`,
      fields: [
        field('client_name', 'Cliente'),
        field('client_phone', 'Teléfono'),
        select(
          'professional_id',
          data!.config?.professional_label ?? 'Profesional',
          data!.professionals.filter((p) => p.active)
        ),
        {
          name: 'service_ids',
          label: 'Servicios',
          type: 'multi',
          choices: data!.services.filter((s) => s.active),
        },
        field('starts_at', 'Fecha y hora', undefined, 'datetime-local'),
      ],
      payload: (f) => ({
        client_name: text(f, 'client_name'),
        client_phone: text(f, 'client_phone'),
        professional_id: text(f, 'professional_id'),
        service_ids: f.getAll('service_ids'),
        starts_at: localToInstant(text(f, 'starts_at'), data!.config!.timezone),
      }),
    });
  }
  function payment(op: Operation) {
    open({
      title:
        op.status === 'open'
          ? 'Registrar anticipo confirmado'
          : 'Registrar cobro confirmado',
      action: 'payment',
      description: `${op.client_name} · saldo ${money(op.total_minor - op.collected_minor)}. Confirma únicamente dinero recibido.`,
      fields: [
        field(
          'amount',
          'Importe',
          rawMoney(op.total_minor - op.collected_minor)
        ),
        select(
          'method',
          'Método',
          [
            { id: 'cash', name: 'Efectivo' },
            { id: 'transfer', name: 'Transferencia' },
            { id: 'card', name: 'Tarjeta' },
          ],
          'cash'
        ),
        field('reference', 'Referencia', undefined, 'text', false),
      ],
      payload: (f) => ({
        operation_id: op.id,
        amount_minor: moneyMinor(text(f, 'amount'), data!.currency),
        method: text(f, 'method'),
        reference: text(f, 'reference'),
      }),
    });
  }
  function review(p: Proof, confirm: boolean) {
    open({
      title: confirm ? 'Confirmar ingreso verificado' : 'Rechazar comprobante',
      action: 'review_proof',
      description: `Declarado ${money(p.declared_minor)} · ${p.bank} · referencia ${p.reference || 'sin referencia'}. ${p.duplicate_warning ? 'Hay una posible referencia o archivo repetido.' : ''}`,
      fields: [
        ...(confirm
          ? [
              field(
                'verified',
                'Importe verificado en banco',
                rawMoney(p.declared_minor)
              ),
            ]
          : []),
        field('note', 'Motivo o evidencia de verificación'),
        ...(confirm && p.duplicate_warning
          ? [
              {
                name: 'acknowledge_duplicate',
                label:
                  'Revisé la referencia repetida y comprobé que corresponde a un pago diferente',
                type: 'checkbox' as const,
              },
            ]
          : []),
      ],
      payload: (f) => ({
        id: p.id,
        decision: confirm ? 'confirm' : 'reject',
        verified_minor: confirm
          ? moneyMinor(text(f, 'verified'), data!.currency)
          : undefined,
        note: text(f, 'note'),
        acknowledge_duplicate: f.has('acknowledge_duplicate'),
      }),
    });
  }
  function refund(op: Operation) {
    open({
      title: 'Devolución o crédito',
      action: 'refund',
      description:
        'Indica el crédito de cada concepto y el dinero que devolverás. Reponer stock es una decisión separada. Los ajustes quedan en el historial.',
      fields: [
        field('refund', 'Dinero devuelto', 0),
        field('note', 'Motivo'),
        ...(op.status === 'completed'
          ? op.lines.flatMap((l) => [
              {
                ...field(
                  `credit_${l.id}`,
                  `Crédito: ${l.name} (máx. ${money(l.net_minor - l.credited_minor)})`,
                  '0'
                ),
              },
              ...(l.kind === 'product'
                ? [
                    {
                      ...field(
                        `restock_${l.id}`,
                        `Cantidad física repuesta: ${l.name}`,
                        0,
                        'number'
                      ),
                      min: '0',
                      max: String(l.quantity - l.returned_quantity),
                      step: '0.001',
                    },
                  ]
                : []),
            ])
          : []),
      ],
      payload: (f) => ({
        operation_id: op.id,
        refund_minor: moneyMinor(text(f, 'refund'), data!.currency),
        note: text(f, 'note'),
        lines:
          op.status === 'completed'
            ? op.lines
                .map((l) => ({
                  id: l.id,
                  credit_minor: moneyMinor(
                    text(f, `credit_${l.id}`) || '0',
                    data!.currency
                  ),
                  restock_quantity: number(f, `restock_${l.id}`),
                }))
                .filter((l) => l.credit_minor > 0)
            : [],
      }),
    });
  }
  async function viewProof(id: string) {
    setError('');
    try {
      const response = await fetch(`/api/operations/proofs?id=${id}`, {
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setProofUrl(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archivo no disponible.');
    }
  }
  const tabs = [
    ['summary', 'Resumen'],
    ...(appointmentsEnabled ? [['appointments', 'Agenda']] : []),
    ['professionals', data.config?.professional_label ?? 'Profesionales'],
    ...(servicesEnabled ? [['services', 'Servicios']] : []),
    ['inventory', 'Inventario'],
    ['sales', 'Operaciones'],
    ['proofs', 'Comprobantes'],
    ...(!professional ? [['finance', 'Finanzas']] : []),
    ...(admin ? [['settings', 'Configuración']] : []),
  ];
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'summary';
  return (
    <div className="space-y-5">
      <style>{`.ops-select{width:100%;border:1px solid var(--color-border);background:var(--color-background);border-radius:.5rem;padding:.5rem}.ops-table{width:100%;font-size:.875rem;text-align:left}.ops-table th,.ops-table td{padding:.75rem;border-bottom:1px solid var(--color-border);vertical-align:top}`}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Operación · {account?.name ?? accountName}
          </h1>
          <p className="text-muted-foreground">
            {data.config
              ? `${[data.config.primary_activity, ...data.config.additional_activities].map((id) => ACTIVITIES.find((a) => a.id === id)?.label).join(' + ')} · ${data.config.timezone}`
              : 'Configura las actividades de este negocio para comenzar.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Mes de operación"
            type="month"
            value={month || data.month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <Button variant="outline" onClick={refresh} disabled={loading}>
            Actualizar
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="border-destructive text-destructive rounded-lg border p-3"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-500">
          {notice}
        </p>
      )}
      {!data.config ? (
        <section className={`${card} space-y-3`}>
          <h2 className="text-lg font-semibold">
            Tu negocio, listo por actividad
          </h2>
          <p>
            Servicios habilita profesionales y citas. Venta de productos añade
            ventas e inventario. Puedes combinar ambas; no se cargarán datos
            ficticios.
          </p>
          {admin ? (
            <Button onClick={configure}>Configurar actividades</Button>
          ) : (
            <p>
              Pide al propietario o administrador que configure las actividades.
            </p>
          )}
        </section>
      ) : (
        <>
          <nav aria-label="Módulos operativos" className="flex flex-wrap gap-2">
            {tabs.map(([id, label]) => (
              <Button
                key={id}
                variant={activeTab === id ? 'default' : 'outline'}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </nav>
          {activeTab === 'summary' && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  'Ventas netas del mes',
                  data.finance
                    ? money(
                        data.finance.sales_minor - data.finance.credits_minor
                      )
                    : 'Consulta tus operaciones',
                ],
                [
                  'Cobros netos del mes',
                  data.finance
                    ? money(data.finance.collected_minor)
                    : 'Solo tu historial',
                ],
                [
                  'Por cobrar · completadas',
                  data.finance
                    ? money(data.finance.receivable_minor)
                    : 'Saldo en cada operación',
                ],
                [
                  'Comisión pendiente',
                  professional
                    ? money(data.professionals[0]?.commission_balance)
                    : admin
                      ? money(
                          data.professionals.reduce(
                            (n, p) => n + (p.commission_balance ?? 0),
                            0
                          )
                        )
                      : 'Solo propietario y administrador',
                ],
              ].map(([label, value]) => (
                <div className={card} key={label}>
                  <p className="text-muted-foreground text-sm">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
              <section
                className={`${card} space-y-3 sm:col-span-2 lg:col-span-4`}
              >
                <h2 className="font-semibold">Preparación inicial</h2>
                <p>
                  1. Registra profesionales y horarios. 2. Carga productos e
                  insumos con sus existencias. 3. Define servicios, responsables
                  y consumos. 4. Activa el enlace público cuando esté listo.
                </p>
                <p className="text-muted-foreground text-sm">
                  Una operación completada puede tener saldo pendiente. Los
                  vouchers no aumentan lo cobrado hasta su confirmación.
                </p>
                {admin && (
                  <Button variant="outline" onClick={configure}>
                    Revisar configuración
                  </Button>
                )}
              </section>
            </div>
          )}
          {activeTab === 'appointments' && (
            <section className={`${card} space-y-4`}>
              <div className="flex flex-wrap gap-2">
                {writable && <Button onClick={book}>Nueva cita</Button>}
                {data.config.public_enabled ? (
                  <Link
                    href={`/book/${data.config.public_slug}`}
                    target="_blank"
                    className="text-primary self-center underline"
                  >
                    Abrir enlace público de reservas
                  </Link>
                ) : (
                  <p className="text-muted-foreground self-center">
                    Reservas públicas desactivadas.
                  </p>
                )}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {data.appointments.map((a) => (
                  <article
                    className="border-border space-y-2 rounded-lg border p-4"
                    key={a.id}
                  >
                    <div className="flex justify-between gap-2">
                      <h3 className="font-semibold">{a.client_name}</h3>
                      <span>{statusLabels[a.status] ?? a.status}</span>
                    </div>
                    <p>
                      {staffName(a.professional_id)} ·{' '}
                      {a.services.map((s) => s.name).join(', ')}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {date(a.starts_at)} · {a.client_phone} ·{' '}
                      {a.source === 'public' ? 'Reserva pública' : 'Recepción'}
                    </p>
                    {writable &&
                      ['confirmed', 'in_progress'].includes(a.status) && (
                        <div className="flex flex-wrap gap-2">
                          {a.status === 'confirmed' && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run('appointment_status', {
                                  id: a.id,
                                  status: 'in_progress',
                                })
                              }
                            >
                              Iniciar atención
                            </Button>
                          )}
                          <Button
                            disabled={busy}
                            onClick={() =>
                              setClosing({
                                operation:
                                  data.operations.find(
                                    (o) => o.id === a.operation_id
                                  ) ?? null,
                              })
                            }
                          >
                            Completar y revisar venta
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              run('appointment_status', {
                                id: a.id,
                                status: 'canceled',
                              })
                            }
                          >
                            Cancelar
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              run('appointment_status', {
                                id: a.id,
                                status: 'no_show',
                              })
                            }
                          >
                            No asistió
                          </Button>
                        </div>
                      )}
                  </article>
                ))}
              </div>
              {!data.appointments.length && (
                <p className="text-muted-foreground">
                  No hay citas registradas en este mes.
                </p>
              )}
            </section>
          )}
          {activeTab === 'professionals' && (
            <section className="space-y-4">
              {admin && (
                <Button onClick={() => professionalForm()}>
                  Nuevo profesional
                </Button>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                {data.professionals.map((p) => (
                  <article className={`${card} space-y-3`} key={p.id}>
                    <div className="flex justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage
                            src={p.photo_url ?? undefined}
                            alt={p.name}
                          />
                          <AvatarFallback>{p.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <h2 className="text-lg font-semibold">{p.name}</h2>
                      </div>
                      <span>{p.active ? 'Activo' : 'Inactivo'}</span>
                    </div>
                    <p>{p.specialty || 'Especialidades por configurar'}</p>
                    <p className="text-muted-foreground">
                      {p.service_count} servicios · {p.product_count} productos
                      vendidos en el mes
                    </p>
                    {p.service_bps !== null && (
                      <p>
                        Comisiones: servicios {p.service_bps / 100}% · productos{' '}
                        {(p.product_bps ?? 0) / 100}%
                      </p>
                    )}
                    {p.commission_month !== null && (
                      <p>
                        Comisión del mes: {money(p.commission_month)} · saldo:{' '}
                        {money(p.commission_balance)}
                        {(p.commission_balance ?? 0) < 0
                          ? ' (ajuste por compensar)'
                          : ''}
                      </p>
                    )}
                    {p.collected_month !== null && (
                      <p className="text-muted-foreground">
                        Cobrado de sus operaciones del mes:{' '}
                        {money(p.collected_month)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {admin && (
                        <Button
                          variant="outline"
                          onClick={() => professionalForm(p)}
                        >
                          Editar perfil y horario
                        </Button>
                      )}
                      {admin && (p.commission_balance ?? 0) > 0 && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            open({
                              title: `Registrar liquidación · ${p.name}`,
                              action: 'settle',
                              description:
                                'Registra una liquidación realizada; WACRM no transfiere dinero.',
                              fields: [
                                field(
                                  'amount',
                                  'Importe',
                                  rawMoney(p.commission_balance)
                                ),
                                field('reference', 'Referencia o constancia'),
                              ],
                              payload: (f) => ({
                                professional_id: p.id,
                                amount_minor: moneyMinor(
                                  text(f, 'amount'),
                                  data.currency
                                ),
                                reference: text(f, 'reference'),
                              }),
                            })
                          }
                        >
                          Liquidar comisión
                        </Button>
                      )}
                    </div>
                    <details>
                      <summary className="cursor-pointer">
                        Historial de servicios y ventas
                      </summary>
                      <ul className="mt-2 space-y-2 text-sm">
                        {data.operations.flatMap((o) =>
                          o.lines
                            .filter((l) => l.professional_id === p.id)
                            .map((l) => (
                              <li key={l.id}>
                                {o.client_name} · {l.name} × {l.quantity} ·
                                venta neta{' '}
                                {money(l.net_minor - l.credited_minor)} ·
                                cobrado de la operación{' '}
                                {money(o.collected_minor)}
                              </li>
                            ))
                        )}
                      </ul>
                    </details>
                  </article>
                ))}
              </div>
              {!data.professionals.length && (
                <p>
                  No hay profesionales. Registra sus perfiles; el correo de
                  acceso es opcional.
                </p>
              )}
            </section>
          )}
          {activeTab === 'services' && (
            <section className={`${card} space-y-4`}>
              <div className="flex gap-2">
                {admin && (
                  <>
                    <Button onClick={() => serviceForm()}>
                      Nuevo servicio
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        open({
                          title: 'Nuevo recurso',
                          action: 'resource',
                          fields: [field('name', 'Nombre del recurso')],
                          payload: (f) => ({ name: text(f, 'name') }),
                        })
                      }
                    >
                      Nueva estación o recurso
                    </Button>
                  </>
                )}
              </div>
              {data.services.map((s) => (
                <div
                  key={s.id}
                  className="border-border flex flex-wrap justify-between gap-3 border-b py-3"
                >
                  <div>
                    <p className="font-medium">
                      {s.name} · {money(s.price_minor)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {s.duration_minutes} minutos ·{' '}
                      {s.professional_ids.map(staffName).join(', ') ||
                        'Sin profesionales asignados'}{' '}
                      · {s.active ? 'Activo' : 'Inactivo'}
                    </p>
                  </div>
                  {admin && (
                    <Button variant="outline" onClick={() => serviceForm(s)}>
                      Editar servicio
                    </Button>
                  )}
                </div>
              ))}
              {!data.services.length && (
                <p>
                  Define los servicios, precios, duración e insumos de tu
                  negocio.
                </p>
              )}
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  Estaciones y recursos
                </p>
                {data.resources.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>
                      {r.name} · {r.active ? 'Activo' : 'Inactivo'}
                    </span>
                    {admin && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          open({
                            title: 'Editar recurso',
                            action: 'resource',
                            fields: [
                              field('name', 'Nombre del recurso', r.name),
                              {
                                name: 'active',
                                label: 'Recurso activo',
                                type: 'checkbox',
                                value: r.active,
                              },
                            ],
                            payload: (f) => ({
                              id: r.id,
                              name: text(f, 'name'),
                              active: f.has('active'),
                            }),
                          })
                        }
                      >
                        Editar recurso
                      </Button>
                    )}
                  </div>
                ))}
                {!data.resources.length && <p>No hay recursos configurados.</p>}
              </div>
            </section>
          )}
          {activeTab === 'inventory' && (
            <section className={`${card} space-y-4`}>
              {admin && (
                <Button onClick={() => productForm()}>
                  Nuevo producto o insumo
                </Button>
              )}
              <div className="overflow-x-auto">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Existencias</th>
                      <th>Precio</th>
                      <th>Uso</th>
                      {admin && <th>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          <p className="text-muted-foreground">{p.sku}</p>
                        </td>
                        <td>{p.stock}</td>
                        <td>{money(p.price_minor)}</td>
                        <td>
                          {p.sellable ? 'Venta y consumo' : 'Insumo'} ·{' '}
                          {p.active ? 'Activo' : 'Inactivo'}
                        </td>
                        {admin && (
                          <td className="space-x-2">
                            <Button
                              variant="outline"
                              onClick={() => productForm(p)}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() =>
                                open({
                                  title: `Movimiento · ${p.name}`,
                                  action: 'stock',
                                  description:
                                    'Cantidad positiva para entrada; negativa para ajuste. No se permite stock negativo.',
                                  fields: [
                                    {
                                      ...field(
                                        'quantity',
                                        'Cantidad',
                                        undefined,
                                        'number'
                                      ),
                                      step: '0.001',
                                    },
                                    field('note', 'Motivo'),
                                  ],
                                  payload: (f) => ({
                                    product_id: p.id,
                                    quantity: number(f, 'quantity'),
                                    note: text(f, 'note'),
                                  }),
                                })
                              }
                            >
                              Entrada / ajuste
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Movimientos del mes</summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {data.stock_movements.map((m) => (
                    <li key={m.id}>
                      {date(m.created_at)} ·{' '}
                      {data.products.find((p) => p.id === m.product_id)?.name} ·{' '}
                      {m.kind} · {m.quantity} · {staffName(m.professional_id)} ·{' '}
                      {m.note}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          {activeTab === 'sales' && (
            <section className={`${card} space-y-4`}>
              {writable && (
                <Button onClick={() => setClosing({ operation: null })}>
                  Nueva venta / servicio realizado
                </Button>
              )}
              {writable && !professional && data.deals.length > 0 && (
                <label className="grid max-w-lg gap-1">
                  Cerrar una oportunidad del CRM
                  <select
                    className="ops-select"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value)
                        setClosing({ operation: null, dealId: e.target.value });
                      e.target.value = '';
                    }}
                  >
                    <option value="">Seleccionar oportunidad</option>
                    {data.deals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                {data.operations.map((o) => (
                  <article
                    key={o.id}
                    className="border-border space-y-3 rounded-lg border p-4"
                  >
                    <h3 className="font-semibold">
                      {o.client_name} · {statusLabels[o.status]}
                    </h3>
                    <p>
                      Venta: {money(o.total_minor)} · Cobrado:{' '}
                      {money(o.collected_minor)} · Saldo:{' '}
                      {money(o.total_minor - o.collected_minor)}
                    </p>
                    <ul className="text-muted-foreground space-y-1 text-sm">
                      {o.lines.map((l) => (
                        <li key={l.id}>
                          {l.name} × {l.quantity} ·{' '}
                          {staffName(l.professional_id)} ·{' '}
                          {money(l.net_minor - l.credited_minor)}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      {writable && o.status === 'open' && (
                        <Button onClick={() => setClosing({ operation: o })}>
                          Revisar cierre
                        </Button>
                      )}
                      {admin &&
                        o.status !== 'void' &&
                        o.total_minor > o.collected_minor && (
                          <Button variant="outline" onClick={() => payment(o)}>
                            Registrar cobro
                          </Button>
                        )}
                      {writable && o.status !== 'void' && (
                        <Button
                          variant="outline"
                          onClick={() => setProof({ operationId: o.id })}
                        >
                          Adjuntar comprobante
                        </Button>
                      )}
                      {admin && o.status !== 'void' && (
                        <Button variant="outline" onClick={() => refund(o)}>
                          Devolución / crédito
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!data.operations.length && (
                <p>
                  No hay operaciones completadas en este mes ni operaciones
                  abiertas.
                </p>
              )}
            </section>
          )}
          {activeTab === 'proofs' && (
            <section className={`${card} space-y-4`}>
              {writable && (
                <Button onClick={() => setProof({})}>
                  Registrar comprobante
                </Button>
              )}
              <p className="text-muted-foreground">
                Recibir un comprobante no acredita dinero. Solo propietario y
                administrador confirman el ingreso.
              </p>
              {proofUrl && (
                <a
                  className="text-primary underline"
                  href={proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir archivo privado · enlace temporal
                </a>
              )}
              {data.proofs.map((p) => (
                <article
                  key={p.id}
                  className="border-border space-y-2 rounded-lg border p-4"
                >
                  <h3 className="font-medium">
                    {data.operations.find((o) => o.id === p.operation_id)
                      ?.client_name ?? 'Operación de otro mes'}{' '}
                    · {money(p.declared_minor)} · {statusLabels[p.status]}
                  </h3>
                  <p>
                    {p.bank} · {p.reference || 'Sin referencia'} ·{' '}
                    {date(p.created_at)}
                  </p>
                  {p.duplicate_warning && (
                    <p className="text-amber-500">
                      Posible archivo o referencia reutilizada. Revisar antes de
                      confirmar.
                    </p>
                  )}
                  {p.review_note && <p>{p.review_note}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => viewProof(p.id)}>
                      Ver comprobante
                    </Button>
                    {admin && p.status === 'pending' && (
                      <>
                        <Button onClick={() => review(p, true)}>
                          Confirmar ingreso
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => review(p, false)}
                        >
                          Rechazar
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
          {activeTab === 'finance' && (
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.finance &&
                  [
                    [
                      'Ventas netas',
                      data.finance.sales_minor - data.finance.credits_minor,
                    ],
                    ['Cobros netos', data.finance.collected_minor],
                    [
                      'Saldo por cobrar · todas las completadas',
                      data.finance.receivable_minor,
                    ],
                    ['Anticipos · abiertas', data.finance.advances_minor],
                    ...(admin
                      ? [
                          ['Costo registrado', data.finance.cost_minor ?? 0],
                          [
                            'Comisiones generadas',
                            data.finance.commission_minor ?? 0,
                          ],
                          [
                            'Gastos registrados',
                            data.finance.expense_minor ?? 0,
                          ],
                          [
                            'Liquidaciones registradas',
                            data.finance.settled_minor ?? 0,
                          ],
                          [
                            'Resultado estimado',
                            data.finance.sales_minor -
                              data.finance.credits_minor -
                              (data.finance.cost_minor ?? 0) -
                              (data.finance.commission_minor ?? 0) -
                              (data.finance.expense_minor ?? 0),
                          ],
                        ]
                      : []),
                  ].map(([label, value]) => (
                    <div className={card} key={String(label)}>
                      <p className="text-muted-foreground">{label}</p>
                      <p className="text-xl font-semibold">
                        {money(Number(value))}
                      </p>
                    </div>
                  ))}
              </div>
              <p className="text-muted-foreground text-sm">
                Ventas, cobros y ajustes se agrupan por su fecha en la zona
                horaria del negocio. El resultado usa los costos y gastos
                registrados; no representa saldo bancario. Las devoluciones se
                muestran en su mes de registro.
              </p>
              {admin && (
                <Button
                  onClick={() =>
                    open({
                      title: 'Registrar gasto',
                      action: 'expense',
                      fields: [
                        field('amount', 'Importe'),
                        field('category', 'Categoría'),
                        field('note', 'Detalle', undefined, 'text', false),
                      ],
                      payload: (f) => ({
                        amount_minor: moneyMinor(
                          text(f, 'amount'),
                          data.currency
                        ),
                        category: text(f, 'category'),
                        note: text(f, 'note'),
                      }),
                    })
                  }
                >
                  Registrar gasto
                </Button>
              )}
              <div className={`${card} overflow-x-auto`}>
                <h2 className="mb-3 font-semibold">
                  Cobros y devoluciones del mes
                </h2>
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Método</th>
                      <th>Importe</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.created_at)}</td>
                        <td>{p.method}</td>
                        <td>{money(p.amount_minor)}</td>
                        <td>{p.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={card}>
                <h2 className="font-semibold">Comisiones y liquidaciones</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {data.commissions.map((c) => (
                    <li key={c.id}>
                      {date(c.created_at)} · {staffName(c.professional_id)} ·
                      comisión {money(c.amount_minor)}
                    </li>
                  ))}
                  {data.settlements.map((s) => (
                    <li key={s.id}>
                      {date(s.created_at)} · {staffName(s.professional_id)} ·
                      liquidación {money(s.amount_minor)} · {s.reference}
                    </li>
                  ))}
                </ul>
              </div>
              {admin && (
                <div className={card}>
                  <h2 className="font-semibold">Gastos del mes</h2>
                  {data.expenses.map((e) => (
                    <p key={e.id} className="mt-2">
                      {date(e.created_at)} · {e.category} ·{' '}
                      {money(e.amount_minor)} · {e.note}
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}
          {activeTab === 'settings' && (
            <section className={`${card} space-y-4`}>
              <h2 className="text-lg font-semibold">Actividades y módulos</h2>
              <p>
                La actividad adapta las funciones disponibles. Los
                profesionales, precios y existencias se configuran con los datos
                reales del negocio.
              </p>
              <Button onClick={configure}>
                Editar actividades y configuración
              </Button>
              {data.config.public_enabled && (
                <p>
                  Enlace público:{' '}
                  <Link
                    className="text-primary break-all underline"
                    href={`/book/${data.config.public_slug}`}
                    target="_blank"
                  >
                    /book/{data.config.public_slug}
                  </Link>
                </p>
              )}
            </section>
          )}
          <p className="text-muted-foreground text-xs">
            Listados de hasta 500 registros por mes y 200 comprobantes
            recientes. Los totales financieros se calculan sobre todos los
            registros del período.
          </p>
        </>
      )}
      {form && (
        <EntityForm
          spec={form}
          busy={busy}
          serverError={error}
          onClose={() => setForm(null)}
          onSubmit={run}
        />
      )}
      {closing && (
        <OperationDialog
          data={data}
          operation={closing.operation}
          dealId={closing.dealId}
          busy={busy}
          serverError={error}
          onClose={() => setClosing(null)}
          onSubmit={(payload) => run('close', payload)}
        />
      )}
      {proof && (
        <ProofDialog
          data={data}
          operationId={proof.operationId}
          sourceMessage={proof.sourceMessage}
          onClose={() => setProof(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
