'use client';
import { useRef, useState } from 'react';
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
import type { OpsData } from '@/lib/operations/types';
export function ProofDialog({
  data,
  operationId,
  sourceMessage,
  onClose,
  onSaved,
}: {
  data: OpsData;
  operationId?: string;
  sourceMessage?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>Registrar comprobante</DialogTitle>
          <DialogDescription>
            Quedará pendiente. El propietario o administrador verificará el
            ingreso en el banco.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onChange={() => {
            key.current = crypto.randomUUID();
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const form = new FormData(e.currentTarget);
              form.set(
                'declared_minor',
                String(moneyMinor(String(form.get('amount')), data.currency))
              );
              form.set('request_id', key.current);
              form.set('month', data.month);
              if (sourceMessage) form.set('source_message_id', sourceMessage);
              const file = form.get('file');
              if (file instanceof File && file.size === 0) form.delete('file');
              const response = await fetch('/api/operations/proofs', {
                method: 'POST',
                body: form,
              });
              const payload = await response.json();
              if (!response.ok) throw new Error(payload.error);
              onSaved();
              onClose();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'No se pudo registrar.'
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="grid gap-1">
            Operación
            <select
              className="ops-select"
              name="operation_id"
              required
              defaultValue={operationId ?? ''}
            >
              <option value="">Seleccionar</option>
              {data.operations
                .filter((o) => o.status !== 'void')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.client_name} ·{' '}
                    {formatMinor(
                      o.total_minor - o.collected_minor,
                      data.currency
                    )}{' '}
                    pendientes
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1">
            Importe declarado ({data.currency})
            <Input name="amount" inputMode="decimal" required />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Referencia
              <Input name="reference" maxLength={100} />
            </label>
            <label className="grid gap-1">
              Banco
              <Input name="bank" maxLength={100} />
            </label>
          </div>
          <label className="grid gap-1">
            Fecha del comprobante
            <Input name="declared_date" type="date" />
          </label>
          <label className="grid gap-1">
            Archivo · JPG, PNG, WEBP o PDF, hasta 5 MB
            <Input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              required={!sourceMessage}
            />
          </label>
          {sourceMessage && (
            <p className="text-muted-foreground text-sm">
              Se conservará el archivo del mensaje de origen. Si ya no está
              disponible, adjunta una copia.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button disabled={busy}>
            {busy ? 'Registrando…' : 'Enviar a revisión'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
