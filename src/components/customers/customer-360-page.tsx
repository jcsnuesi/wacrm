'use client';

import { useEffect, useMemo, useState } from 'react';
import { AtSign, Mail, MessageCircle, Phone, Search, UsersRound } from 'lucide-react';

import { Input } from '@/components/ui/input';

type Identity = { id: string; channel: string; username?: string | null; display_name?: string | null; external_id: string };
type Conversation = { id: string; status: string; last_message_at?: string | null };
type Customer = { id: string; display_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; status: string; contact_identities?: Identity[]; conversations?: Conversation[] };

const CHANNEL_TONE: Record<string, string> = {
  whatsapp: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  instagram: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  facebook: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  tiktok: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
};

export function Customer360Page() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/customers', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { customers?: Customer[] }) => setCustomers(payload.customers ?? []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.display_name, customer.email, customer.phone]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [customers, query]);

  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
    <header className="border-border relative overflow-hidden rounded-2xl border bg-card px-5 py-6 sm:px-7">
      <div className="bg-primary/10 absolute -top-12 -right-10 size-44 rounded-full blur-2xl" />
      <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">Customer 360</p>
          <h1 className="text-foreground mt-2 text-3xl font-semibold tracking-tight">Personas, no canales.</h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm">Cada identidad social y cada conversación, reunidas en un perfil canónico.</p>
        </div>
        <div className="border-border bg-background/60 flex min-w-32 items-center gap-3 rounded-xl border px-4 py-3">
          <UsersRound className="text-primary size-5" />
          <div><p className="text-foreground text-xl font-semibold">{customers.length}</p><p className="text-muted-foreground text-xs">clientes</p></div>
        </div>
      </div>
    </header>
    <div className="relative max-w-md"><Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Buscar por nombre, correo o teléfono" /></div>
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {loading ? <p className="text-muted-foreground col-span-full py-10 text-center text-sm">Cargando perfiles canónicos…</p> : visible.length === 0 ? <p className="text-muted-foreground col-span-full py-10 text-center text-sm">No hay clientes que coincidan.</p> : visible.map((customer) => <article key={customer.id} className="border-border bg-card hover:border-primary/35 rounded-xl border p-4 transition-colors">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-foreground truncate font-semibold">{customer.display_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Sin nombre'}</h2><p className="text-muted-foreground mt-1 text-xs">{customer.status === 'active' ? 'Perfil activo' : customer.status}</p></div><span className="bg-primary/10 text-primary rounded-full px-2 py-1 text-[10px] font-semibold">{customer.conversations?.length ?? 0} chats</span></div>
        <div className="text-muted-foreground mt-4 space-y-2 text-sm">{customer.phone && <p className="flex items-center gap-2"><Phone className="size-3.5" />{customer.phone}</p>}{customer.email && <p className="flex items-center gap-2 truncate"><Mail className="size-3.5" />{customer.email}</p>}</div>
        <div className="mt-4 flex flex-wrap gap-1.5">{customer.contact_identities?.map((identity) => <span key={identity.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${CHANNEL_TONE[identity.channel] ?? 'bg-muted text-muted-foreground'}`}><AtSign className="size-3" />{identity.channel}{identity.username ? ` · @${identity.username}` : ''}</span>)}</div>
        <div className="border-border text-muted-foreground mt-4 flex items-center gap-1.5 border-t pt-3 text-xs"><MessageCircle className="size-3.5" />Vista de perfil canónico</div>
      </article>)}
    </section>
  </div>;
}
