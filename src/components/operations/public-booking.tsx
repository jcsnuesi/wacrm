'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMinor } from '@/lib/operations/catalog';
interface PublicCatalog {
  name: string;
  currency: string;
  timezone: string;
  professional_label: string;
  services: {
    id: string;
    name: string;
    price_minor: number;
    duration_minutes: number;
  }[];
  professionals: {
    id: string;
    name: string;
    specialty: string;
    photo_url: string | null;
    service_ids: string[];
  }[];
}
export function PublicBooking({ slug }: { slug: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState('');
  const [professional, setProfessional] = useState('');
  const [day, setDay] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    starts_at: string;
  } | null>(null);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    fetch(`/api/booking/${slug}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) setCatalog(data.data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  useEffect(() => {
    key.current = crypto.randomUUID();
    setSelected('');
    setSlots([]);
    setLoadingSlots(false);
    if (!service || !professional || !day) return;
    let active = true;
    setLoadingSlots(true);
    setError('');
    const query = new URLSearchParams({
      service_id: service,
      professional_id: professional,
      date: day,
    });
    fetch(`/api/booking/${slug}?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) setSlots(data.data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [slug, service, professional, day]);
  const clock = (iso: string) =>
    new Intl.DateTimeFormat('es', {
      timeZone: catalog?.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  const style = 'border-border bg-background rounded-lg border p-2';
  if (loading) return <p role="status">Cargando reservas…</p>;
  if (!catalog)
    return (
      <div>
        <h1 className="text-xl font-semibold">Reserva no disponible</h1>
        <p role="alert" className="mt-3">
          {error}
        </p>
      </div>
    );
  if (result)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Tu cita está confirmada</h1>
        <p>
          {catalog.name} · {clock(result.starts_at)}
        </p>
        <p>
          {catalog.services.find((s) => s.id === service)?.name} ·{' '}
          {catalog.professionals.find((p) => p.id === professional)?.name}
        </p>
        <p className="text-muted-foreground text-sm">
          Referencia: {result.id}. Para modificar o cancelar, contacta al
          negocio. Esta reserva no realiza un cobro.
        </p>
      </div>
    );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Reserva en {catalog.name}</h1>
      <p className="text-muted-foreground">
        Elige servicio y horario. Horarios del negocio: {catalog.timezone}.
      </p>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const form = new FormData(e.currentTarget);
          try {
            const response = await fetch(`/api/booking/${slug}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                service_ids: [service],
                professional_id: professional,
                starts_at: selected,
                client_name: String(form.get('client_name')),
                client_phone: String(form.get('client_phone')),
                website: String(form.get('website') ?? ''),
                request_id: key.current,
              }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error);
            setResult(payload.data);
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
          Servicio
          <select
            aria-label="Servicio"
            className={style}
            value={service}
            required
            onChange={(e) => {
              setService(e.target.value);
              setProfessional('');
            }}
          >
            <option value="">Seleccionar</option>
            {catalog.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes} minutos ·{' '}
                {formatMinor(s.price_minor, catalog.currency)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {catalog.professional_label}
          <select
            aria-label="Profesional"
            className={style}
            value={professional}
            required
            onChange={(e) => setProfessional(e.target.value)}
          >
            <option value="">Seleccionar</option>
            {catalog.professionals
              .filter((p) => p.service_ids.includes(service))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.specialty ? ` · ${p.specialty}` : ''}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1">
          Fecha
          <Input
            type="date"
            value={day}
            required
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          Horario disponible
          <select
            aria-label="Horario disponible"
            className={style}
            value={selected}
            required
            onChange={(e) => {
              setSelected(e.target.value);
              key.current = crypto.randomUUID();
            }}
            disabled={loadingSlots}
          >
            <option value="">
              {loadingSlots ? 'Buscando horarios…' : 'Seleccionar'}
            </option>
            {slots.map((slot) => (
              <option value={slot} key={slot}>
                {clock(slot)}
              </option>
            ))}
          </select>
        </label>
        {service && professional && day && !loadingSlots && !slots.length && (
          <p>
            No hay horarios disponibles para esa selección. Elige otra fecha.
          </p>
        )}
        <label className="grid gap-1">
          Nombre
          <Input
            name="client_name"
            required
            maxLength={80}
            autoComplete="name"
            onChange={() => {
              key.current = crypto.randomUUID();
            }}
          />
        </label>
        <label className="grid gap-1">
          Teléfono
          <Input
            name="client_phone"
            type="tel"
            required
            maxLength={22}
            autoComplete="tel"
            placeholder="Incluye código de país"
            onChange={() => {
              key.current = crypto.randomUUID();
            }}
          />
        </label>
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy || !selected}>
          {busy ? 'Confirmando…' : 'Confirmar cita'}
        </Button>
      </form>
    </div>
  );
}
