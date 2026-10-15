'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMinor, moneyMinor } from '@/lib/operations/catalog';
import type { OpsData, Operation } from '@/lib/operations/types';
export type DraftLine = {
  kind: 'service' | 'product';
  source_id: string;
  professional_id: string;
  quantity: number;
};
export function OperationDialog({
  data,
  operation,
  dealId,
  busy,
  onClose,
  onSubmit,
  serverError,
}: {
  data: OpsData;
  operation: Operation | null;
  dealId?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  serverError?: string;
}) {
  const appointment = data.appointments.find(
    (a) => a.id === operation?.appointment_id
  );
  const servicesEnabled =
    data.config?.primary_activity === 'services' ||
    data.config?.additional_activities.includes('services');
  const productsEnabled =
    (data.config?.primary_activity === 'products' ||
      data.config?.additional_activities.includes('products')) &&
    !data.config?.disabled_modules.includes('products');
  const initialKind = appointment
    ? 'product'
    : servicesEnabled
      ? 'service'
      : 'product';
  const [lines, setLines] = useState<DraftLine[]>(
    appointment
      ? []
      : [
          {
            kind: initialKind,
            source_id: '',
            professional_id:
              data.role === 'professional'
                ? (data.professionals[0]?.id ?? '')
                : '',
            quantity: 1,
          },
        ]
  );
  const [discount, setDiscount] = useState('0');
  const [error, setError] = useState('');
  const value = (line: DraftLine) =>
    (line.kind === 'service' ? data.services : data.products).find(
      (item) => item.id === line.source_id
    )?.price_minor ?? 0;
  const total =
    (appointment?.services.reduce((n, s) => n + s.price_minor, 0) ?? 0) +
    lines.reduce((n, l) => n + Math.round(value(l) * l.quantity), 0);
  const patch = (i: number, update: Partial<DraftLine>) =>
    setLines(
      lines.map((line, index) => (index === i ? { ...line, ...update } : line))
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>Confirmar operación completada</DialogTitle>
          <DialogDescription>
            Revisa lo entregado. Completar registra la venta y el inventario; el
            cobro se registra por separado.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              if (
                lines.some(
                  (l) =>
                    !l.source_id || (l.kind === 'service' && !l.professional_id)
                )
              )
                throw new Error('Selecciona los conceptos y su profesional.');
              const payload = {
                operation_id: operation?.id,
                deal_id: dealId || undefined,
                client_name: String(
                  new FormData(e.currentTarget).get('client_name') ?? ''
                ),
                client_phone: String(
                  new FormData(e.currentTarget).get('client_phone') ?? ''
                ),
                discount_minor: moneyMinor(discount, data.currency),
                items: lines.map((l) => ({
                  ...l,
                  professional_id: l.professional_id || null,
                })),
              };
              if (await onSubmit(payload)) onClose();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Revisa los datos.'
              );
            }
          }}
        >
          {operation ? (
            <p className="font-medium">{operation.client_name}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                Cliente
                <Input name="client_name" required maxLength={80} />
              </label>
              <label className="grid gap-1">
                Teléfono
                <Input name="client_phone" required maxLength={32} />
              </label>
            </div>
          )}
          {appointment?.services.map((s, i) => (
            <div
              key={`${s.id}-${i}`}
              className="border-border flex justify-between rounded-lg border p-3"
            >
              <span>
                {s.name} ·{' '}
                {
                  data.professionals.find(
                    (p) => p.id === appointment.professional_id
                  )?.name
                }
              </span>
              <span>{formatMinor(s.price_minor, data.currency)}</span>
            </div>
          ))}
          {lines.map((line, index) => (
            <fieldset
              key={index}
              className="border-border grid gap-2 rounded-lg border p-3"
            >
              <legend className="px-1 text-sm">Concepto {index + 1}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Tipo
                  <select
                    aria-label={`Tipo ${index + 1}`}
                    className="ops-select"
                    value={line.kind}
                    onChange={(e) =>
                      patch(index, {
                        kind: e.target.value as DraftLine['kind'],
                        source_id: '',
                        quantity: 1,
                      })
                    }
                  >
                    {!appointment && servicesEnabled && (
                      <option value="service">Servicio</option>
                    )}
                    {productsEnabled && (
                      <option value="product">Producto</option>
                    )}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Concepto
                  <select
                    aria-label={`Concepto ${index + 1}`}
                    className="ops-select"
                    required
                    value={line.source_id}
                    onChange={(e) =>
                      patch(index, { source_id: e.target.value })
                    }
                  >
                    <option value="">Seleccionar</option>
                    {(line.kind === 'service'
                      ? data.services
                      : data.products.filter((p) => p.sellable)
                    )
                      .filter((item) => item.active)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ·{' '}
                          {formatMinor(item.price_minor, data.currency)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  {data.config?.professional_label ?? 'Profesional'}
                  <select
                    aria-label={`Profesional ${index + 1}`}
                    className="ops-select"
                    value={line.professional_id}
                    required={line.kind === 'service'}
                    onChange={(e) =>
                      patch(index, { professional_id: e.target.value })
                    }
                  >
                    <option value="">Sin comisión asignada</option>
                    {data.professionals
                      .filter(
                        (p) =>
                          p.active &&
                          (line.kind !== 'service' ||
                            data.services
                              .find((s) => s.id === line.source_id)
                              ?.professional_ids.includes(p.id))
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Cantidad
                  <Input
                    aria-label={`Cantidad ${index + 1}`}
                    type="number"
                    min="0.001"
                    max="1000000"
                    step="0.001"
                    value={line.quantity}
                    disabled={line.kind === 'service'}
                    onChange={(e) =>
                      patch(index, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                Quitar concepto
              </Button>
            </fieldset>
          ))}
          {(!appointment || productsEnabled) && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setLines([
                  ...lines,
                  {
                    kind: initialKind,
                    source_id: '',
                    quantity: 1,
                    professional_id:
                      data.role === 'professional'
                        ? (data.professionals[0]?.id ?? '')
                        : (appointment?.professional_id ?? ''),
                  },
                ])
              }
              disabled={lines.length >= 40}
            >
              Agregar {appointment ? 'producto' : 'concepto'}
            </Button>
          )}
          <label className="grid gap-1">
            Descuento total ({data.currency})
            <Input
              type="text"
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </label>
          <p>
            Subtotal: {formatMinor(total, data.currency)} · Cobrado:{' '}
            {formatMinor(operation?.collected_minor ?? 0, data.currency)}
          </p>
          {(error || serverError) && (
            <p role="alert" className="text-destructive">
              {error || serverError}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || (!appointment && lines.length === 0)}
          >
            {busy ? 'Registrando…' : 'Confirmar venta o servicio completado'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
