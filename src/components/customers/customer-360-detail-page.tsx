'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  CalendarDays,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { Customer360DetailSkeleton } from './customer-360-detail-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  getCustomerDisplayName,
  getIdentityDisplayLabel,
  sortCustomerConversations,
} from '@/lib/customers/customer-360';
import type {
  Customer360Conversation,
  Customer360Detail,
  Customer360DetailResponse,
  Customer360Identity,
} from '@/lib/customers/customer-360-types';
import { getConversationHref } from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';

type DetailState =
  | { status: 'loading' }
  | { status: 'success'; customer: Customer360Detail }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'error' };

const CHANNEL_TONE: Record<string, string> = {
  whatsapp: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  instagram: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  facebook: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  tiktok: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(value?: string | null): string {
  if (!value) return 'Sin actividad registrada';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : DATE_TIME_FORMATTER.format(date);
}

function channelLabel(value?: string | null): string {
  if (!value) return 'Canal no disponible';
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
  };
  return labels[normalized] ?? value;
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    active: 'Activo',
    merged: 'Fusionado',
    archived: 'Archivado',
    open: 'Abierto',
    pending: 'Pendiente',
    closed: 'Cerrado',
  };
  return labels[value.toLowerCase()] ?? value;
}

function ErrorPanel({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center p-4 sm:p-6">
      <div className="border-border bg-card w-full rounded-2xl border p-6 text-center">
        <div className="bg-muted text-muted-foreground mx-auto flex size-11 items-center justify-center rounded-full">
          <AlertCircle aria-hidden="true" className="size-5" />
        </div>
        <h1 className="text-foreground mt-4 text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          {description}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Reintentar
            </Button>
          ) : null}
          <Link
            href="/customers"
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" />
            Volver a clientes
          </Link>
        </div>
      </div>
    </div>
  );
}

function IdentitySection({
  identities,
}: {
  identities: Customer360Identity[];
}) {
  return (
    <section className="border-border bg-card min-w-0 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <AtSign aria-hidden="true" className="text-primary size-4" />
        <h2 className="text-foreground font-semibold">Identidades</h2>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Canales asociados con esta persona.
      </p>

      {identities.length > 0 ? (
        <ul className="mt-4 min-w-0 space-y-2">
          {identities.map((identity) => {
            const channel = identity.channel.toLowerCase();
            return (
              <li
                key={identity.id}
                className="border-border bg-background/50 rounded-lg border p-3"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {getIdentityDisplayLabel(identity)}
                    </p>
                    {identity.display_name && identity.username ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {identity.display_name}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${CHANNEL_TONE[channel] ?? 'bg-muted text-muted-foreground'}`}
                  >
                    {channelLabel(channel)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="border-border text-muted-foreground mt-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No hay identidades de canal asociadas.
        </div>
      )}
    </section>
  );
}

function ConversationSection({
  conversations,
}: {
  conversations: Customer360Conversation[];
}) {
  return (
    <section className="border-border bg-card min-w-0 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <MessageCircle aria-hidden="true" className="text-primary size-4" />
        <h2 className="text-foreground font-semibold">Actividad por canal</h2>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Conversaciones reunidas en este perfil canónico.
      </p>

      {conversations.length > 0 ? (
        <ul className="mt-4 min-w-0 space-y-2">
          {conversations.map((conversation) => {
            const account = conversation.channel_account;
            const channel = account?.channel?.toLowerCase();
            const channelName = channelLabel(channel);
            return (
              <li key={conversation.id} className="min-w-0 max-w-full">
                <Link
                  href={getConversationHref(conversation.id)}
                  aria-label={`Abrir conversación de ${channelName} en Inbox`}
                  className="group border-border bg-background/50 hover:border-primary/35 hover:bg-muted/20 focus-visible:ring-ring block min-h-11 min-w-0 max-w-full overflow-hidden rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${channel ? (CHANNEL_TONE[channel] ?? 'bg-muted text-muted-foreground') : 'bg-muted text-muted-foreground'}`}
                        >
                          {channelName}
                        </span>
                        {account?.display_name ? (
                          <span className="text-muted-foreground text-xs">
                            {account.display_name}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground text-xs">
                          {statusLabel(conversation.status)}
                        </span>
                      </div>
                      <p className="text-foreground mt-2 truncate text-sm">
                        {conversation.last_message_text ||
                          'Conversación sin vista previa'}
                      </p>
                      <time
                        dateTime={conversation.last_message_at ?? undefined}
                        className="text-muted-foreground mt-1 block text-xs tabular-nums"
                      >
                        {formatDateTime(conversation.last_message_at)}
                      </time>
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="text-muted-foreground group-hover:text-primary mt-1 size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="border-border text-muted-foreground mt-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No hay actividad de canal registrada.
        </div>
      )}
    </section>
  );
}

export function CustomerProfile({ customer }: { customer: Customer360Detail }) {
  const name = getCustomerDisplayName(customer);
  const identities = customer.contact_identities ?? [];
  const conversations = customer.conversations ?? [];
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/customers"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          '-ml-2'
        )}
      >
        <ArrowLeft aria-hidden="true" />
        Clientes
      </Link>

      <header className="border-border bg-card relative overflow-hidden rounded-2xl border p-5 sm:p-7">
        <div className="bg-primary/10 absolute -top-16 -right-12 size-48 rounded-full blur-2xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
              {initials || <UserRound aria-hidden="true" className="size-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-foreground truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {name}
                </h1>
                <Badge variant="outline">{statusLabel(customer.status)}</Badge>
              </div>
              <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Phone aria-hidden="true" className="size-3.5" />
                  <span className="truncate">
                    {customer.phone || 'Teléfono no disponible'}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail aria-hidden="true" className="size-3.5" />
                  <span className="truncate">
                    {customer.email || 'Correo no disponible'}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  Perfil desde {formatDateTime(customer.created_at)}
                </span>
              </div>
            </div>
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <ShieldCheck aria-hidden="true" className="text-primary size-4" />
            Perfil canónico
          </div>
        </div>

        <div className="relative mt-6 grid max-w-sm grid-cols-2 gap-3">
          <div className="border-border bg-background/60 rounded-xl border px-4 py-3">
            <p className="text-foreground text-xl font-semibold">
              {identities.length}
            </p>
            <p className="text-muted-foreground text-xs">identidades</p>
          </div>
          <div className="border-border bg-background/60 rounded-xl border px-4 py-3">
            <p className="text-foreground text-xl font-semibold">
              {conversations.length}
            </p>
            <p className="text-muted-foreground text-xs">conversaciones</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <IdentitySection identities={identities} />
        <ConversationSection conversations={conversations} />
      </div>
    </div>
  );
}

export function Customer360DetailPage({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadCustomer() {
      try {
        const response = await fetch(
          `/api/customers/${encodeURIComponent(customerId)}`,
          { signal: controller.signal }
        );

        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (response.status === 403) {
          setState({ status: 'forbidden' });
          return;
        }
        if (response.status === 404) {
          setState({ status: 'not-found' });
          return;
        }
        if (!response.ok) {
          setState({ status: 'error' });
          return;
        }

        const payload = (await response.json()) as Customer360DetailResponse;
        if (!payload.customer?.id) {
          setState({ status: 'error' });
          return;
        }

        setState({
          status: 'success',
          customer: {
            ...payload.customer,
            conversations: sortCustomerConversations(
              payload.customer.conversations ?? []
            ),
          },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setState({ status: 'error' });
      }
    }

    void loadCustomer();
    return () => controller.abort();
  }, [customerId, retryToken, router]);

  if (state.status === 'loading') return <Customer360DetailSkeleton />;
  if (state.status === 'not-found') {
    return (
      <ErrorPanel
        title="Cliente no encontrado"
        description="Este perfil no existe o ya no está disponible en tu cuenta."
      />
    );
  }
  if (state.status === 'forbidden') {
    return (
      <ErrorPanel
        title="No tienes acceso"
        description="Tu cuenta no tiene permisos para consultar este perfil."
      />
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorPanel
        title="No pudimos cargar este perfil"
        description="La información no está disponible en este momento. Intenta nuevamente."
        onRetry={() => {
          setState({ status: 'loading' });
          setRetryToken((token) => token + 1);
        }}
      />
    );
  }

  return <CustomerProfile customer={state.customer} />;
}
