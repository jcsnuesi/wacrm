'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  AtSign,
  Mail,
  MessageCircle,
  Phone,
  Search,
  SearchX,
  UsersRound,
} from 'lucide-react';

import { Skeleton } from '@/components/dashboard/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCustomerDisplayName } from '@/lib/customers/customer-360';
import type {
  Customer360ListResponse,
  Customer360Summary,
} from '@/lib/customers/customer-360-types';

const CHANNEL_TONE: Record<string, string> = {
  whatsapp: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  instagram: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  facebook: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  tiktok: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
};

export function CustomerCard({ customer }: { customer: Customer360Summary }) {
  const displayName = getCustomerDisplayName(customer);

  return (
    <article>
      <Link
        href={`/customers/${customer.id}`}
        aria-label={`Ver perfil de ${displayName}`}
        className="group border-border bg-card hover:border-primary/35 hover:bg-muted/20 focus-visible:ring-ring focus-visible:ring-offset-background block h-full cursor-pointer rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-foreground truncate font-semibold">
              {displayName}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {customer.status === 'active' ? 'Perfil activo' : customer.status}
            </p>
          </div>
          <span className="bg-primary/10 text-primary rounded-full px-2 py-1 text-[10px] font-semibold">
            {customer.conversations?.length ?? 0} chats
          </span>
        </div>

        <div className="text-muted-foreground mt-4 space-y-2 text-sm">
          {customer.phone ? (
            <p className="flex items-center gap-2">
              <Phone aria-hidden="true" className="size-3.5" />
              {customer.phone}
            </p>
          ) : null}
          {customer.email ? (
            <p className="flex items-center gap-2 truncate">
              <Mail aria-hidden="true" className="size-3.5" />
              {customer.email}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {customer.contact_identities?.map((identity) => {
            const channel = identity.channel.toLowerCase();
            return (
              <span
                key={identity.id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${CHANNEL_TONE[channel] ?? 'bg-muted text-muted-foreground'}`}
              >
                <AtSign aria-hidden="true" className="size-3" />
                {channel}
                {identity.username ? ` · @${identity.username}` : ''}
              </span>
            );
          })}
        </div>

        <div className="border-border text-muted-foreground group-hover:text-primary mt-4 flex items-center justify-between border-t pt-3 text-xs transition-colors">
          <span className="flex items-center gap-1.5">
            <MessageCircle aria-hidden="true" className="size-3.5" />
            Vista de perfil canónico
          </span>
          <ArrowRight
            aria-hidden="true"
            className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5"
          />
        </div>
      </Link>
    </article>
  );
}

function CustomerCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="border-border bg-card rounded-xl border p-4"
    >
      <div className="flex justify-between gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-3 w-20" />
      <Skeleton className="mt-5 h-4 w-32" />
      <Skeleton className="mt-2 h-4 w-44" />
      <Skeleton className="mt-5 h-6 w-24 rounded-full" />
      <Skeleton className="mt-4 h-px w-full" />
      <Skeleton className="mt-3 h-4 w-36" />
    </div>
  );
}

export function Customer360Page() {
  const [customers, setCustomers] = useState<Customer360Summary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/customers', { signal: controller.signal })
      .then(async (response) =>
        response.ok ? response.json() : Promise.reject()
      )
      .then((payload: Customer360ListResponse) =>
        setCustomers(payload.customers ?? [])
      )
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) =>
      [getCustomerDisplayName(customer), customer.email, customer.phone].some(
        (value) => value?.toLowerCase().includes(needle)
      )
    );
  }, [customers, query]);

  const noSearchResults =
    !loading && customers.length > 0 && visible.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="border-border bg-card relative overflow-hidden rounded-2xl border px-5 py-6 sm:px-7">
        <div className="bg-primary/10 absolute -top-12 -right-10 size-44 rounded-full blur-2xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
              Customer 360
            </p>
            <h1 className="text-foreground mt-2 text-3xl font-semibold tracking-tight">
              Personas, no canales.
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm">
              Cada identidad social y cada conversación, reunidas en un perfil
              canónico.
            </p>
          </div>
          <div className="border-border bg-background/60 flex min-w-32 items-center gap-3 rounded-xl border px-4 py-3">
            <UsersRound aria-hidden="true" className="text-primary size-5" />
            <div>
              <p className="text-foreground text-xl font-semibold">
                {customers.length}
              </p>
              <p className="text-muted-foreground text-xs">clientes</p>
            </div>
          </div>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search
          aria-hidden="true"
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          aria-label="Buscar clientes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Buscar por nombre, correo o teléfono"
        />
      </div>

      <section
        aria-busy={loading}
        aria-label="Perfiles de clientes"
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      >
        {loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <CustomerCardSkeleton key={index} />
          ))
        ) : visible.length > 0 ? (
          visible.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} />
          ))
        ) : (
          <div className="border-border bg-card/40 col-span-full flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 py-8 text-center">
            <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
              <SearchX aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="text-foreground text-sm font-medium">
                {noSearchResults
                  ? 'No encontramos coincidencias'
                  : 'Todavía no hay clientes'}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {noSearchResults
                  ? 'Prueba con otro nombre, correo o teléfono.'
                  : 'Los perfiles aparecerán cuando se registre actividad de un cliente.'}
              </p>
            </div>
            {noSearchResults ? (
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                Limpiar búsqueda
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
