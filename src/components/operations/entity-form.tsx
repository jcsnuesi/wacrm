'use client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
export interface FormField {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'email'
    | 'url'
    | 'date'
    | 'datetime-local'
    | 'select'
    | 'multi'
    | 'checkbox'
    | 'hours';
  value?: string | number | boolean | string[];
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  choices?: { id: string; name: string }[];
  hours?: { weekday: number; start: string; end: string }[];
}
export interface EntityFormSpec {
  title: string;
  description?: string;
  action: string;
  fields: FormField[];
  payload: (form: FormData) => Record<string, unknown>;
}
export function EntityForm({
  spec,
  busy,
  onClose,
  onSubmit,
  serverError,
}: {
  spec: EntityFormSpec;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    action: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  serverError?: string;
}) {
  const [error, setError] = useState('');
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
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>
            {spec.description ??
              'Los datos pertenecen únicamente al negocio seleccionado.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              if (
                await onSubmit(
                  spec.action,
                  spec.payload(new FormData(e.currentTarget))
                )
              )
                onClose();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Revisa los datos.'
              );
            }
          }}
        >
          {spec.fields.map((field) =>
            field.type === 'hours' ? (
              <fieldset key={field.name} className="grid gap-2">
                <legend className="mb-2 font-medium">
                  Horario semanal · zona horaria del negocio
                </legend>
                {[
                  'Lunes',
                  'Martes',
                  'Miércoles',
                  'Jueves',
                  'Viernes',
                  'Sábado',
                  'Domingo',
                ].map((day, i) => {
                  const initial = field.hours?.find((h) => h.weekday === i + 1);
                  return (
                    <div
                      className="grid grid-cols-[1fr_1fr_1fr] gap-2"
                      key={day}
                    >
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="workdays"
                          value={i + 1}
                          defaultChecked={field.hours ? !!initial : i < 6}
                        />
                        {day}
                      </label>
                      <Input
                        aria-label={`Inicio ${day}`}
                        type="time"
                        name={`start${i + 1}`}
                        defaultValue={initial?.start ?? '09:00'}
                      />
                      <Input
                        aria-label={`Fin ${day}`}
                        type="time"
                        name={`end${i + 1}`}
                        defaultValue={initial?.end ?? '18:00'}
                      />
                    </div>
                  );
                })}
              </fieldset>
            ) : field.type === 'multi' ? (
              <fieldset key={field.name} className="grid gap-1">
                <legend className="mb-1 font-medium">{field.label}</legend>
                {field.choices?.map((choice) => (
                  <label key={choice.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name={field.name}
                      value={choice.id}
                      defaultChecked={
                        Array.isArray(field.value) &&
                        field.value.includes(choice.id)
                      }
                    />
                    {choice.name}
                  </label>
                ))}
              </fieldset>
            ) : field.type === 'checkbox' ? (
              <label key={field.name} className="flex items-center gap-2">
                <input
                  name={field.name}
                  type="checkbox"
                  defaultChecked={!!field.value}
                />
                {field.label}
              </label>
            ) : (
              <label key={field.name} className="grid gap-1 text-sm">
                {field.label}
                {field.type === 'select' ? (
                  <select
                    className="ops-select"
                    name={field.name}
                    defaultValue={String(field.value ?? '')}
                    required={field.required}
                  >
                    {field.choices?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    name={field.name}
                    type={field.type ?? 'text'}
                    defaultValue={String(field.value ?? '')}
                    required={field.required}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    maxLength={
                      field.type === 'text' || !field.type ? 300 : undefined
                    }
                  />
                )}
              </label>
            )
          )}
          {(error || serverError) && (
            <p role="alert" className="text-destructive">
              {error || serverError}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
