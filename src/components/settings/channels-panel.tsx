'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  AtSign,
  Loader2,
  MessageCircleMore,
  MessagesSquare,
  Radio,
  Smartphone,
} from 'lucide-react';

import type { Channel, ChannelAccount } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const CHANNEL_META: Record<
  Channel,
  { label: string; description: string; icon: typeof MessageCircleMore }
> = {
  whatsapp: {
    label: 'WhatsApp',
    description: 'Business messages and existing shared inbox lines.',
    icon: MessageCircleMore,
  },
  instagram: {
    label: 'Instagram',
    description: 'Direct messages for connected professional accounts.',
    icon: AtSign,
  },
  facebook: {
    label: 'Facebook Messenger',
    description: 'Messages sent to connected Facebook Pages.',
    icon: MessagesSquare,
  },
  tiktok: {
    label: 'TikTok',
    description: 'Business messages when the provider adapter is available.',
    icon: Smartphone,
  },
};

const STATUS_META = {
  connected: {
    label: 'Connected',
    icon: CheckCircle2,
    className: 'text-emerald-500',
  },
  disconnected: {
    label: 'Disconnected',
    icon: CircleAlert,
    className: 'text-muted-foreground',
  },
  expired: {
    label: 'Token expired',
    icon: CircleAlert,
    className: 'text-amber-500',
  },
  error: {
    label: 'Connection error',
    icon: CircleAlert,
    className: 'text-red-500',
  },
  pending: {
    label: 'Not connected',
    icon: Clock3,
    className: 'text-muted-foreground',
  },
} as const;

export function ChannelsPanel({
  onOpenWhatsApp,
}: {
  onOpenWhatsApp: () => void;
}) {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupChannel, setSetupChannel] = useState<
    'instagram' | 'facebook' | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    externalAccountId: '',
    displayName: '',
    username: '',
    accessToken: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/channels', { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as {
        accounts?: ChannelAccount[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.error ?? 'Unable to load channels');
      setAccounts(body?.accounts ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load channels'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSocialChannel() {
    if (!setupChannel) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: setupChannel, ...form }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.error ?? 'Unable to save channel');
      setSetupChannel(null);
      setForm({
        externalAccountId: '',
        displayName: '',
        username: '',
        accessToken: '',
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save channel'
      );
    } finally {
      setSaving(false);
    }
  }

  async function disconnectSocialChannel(account: ChannelAccount) {
    if (
      !window.confirm(
        `Disconnect ${account.display_name || account.username || 'this account'}? New messages will no longer reach this workspace.`
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: account.channel, id: account.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.error ?? 'Unable to disconnect channel');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to disconnect channel'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <div className="mb-5 flex items-start gap-3">
        <span className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Radio className="size-5" />
        </span>
        <div>
          <h2 className="text-foreground text-lg font-semibold">Channels</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Connected messaging accounts available to this workspace.
          </p>
        </div>
      </div>

      {error ? (
        <Card className="border-amber-500/30">
          <CardContent className="flex items-center justify-between gap-3 py-4 text-sm">
            <span className="text-muted-foreground">
              {error}. Apply migration 044, then reload.
            </span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(CHANNEL_META) as Channel[]).map((channel) => {
            const meta = CHANNEL_META[channel];
            const Icon = meta.icon;
            const connected = accounts.filter(
              (account) =>
                account.channel === channel && account.status === 'connected'
            );
            const primary = connected[0];
            const status = STATUS_META[primary?.status ?? 'pending'];
            const StatusIcon = status.icon;
            const isWhatsApp = channel === 'whatsapp';

            return (
              <Card key={channel} className="flex min-h-44 flex-col">
                <CardHeader className="flex-row items-start gap-3 space-y-0 pb-3">
                  <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{meta.label}</CardTitle>
                    <CardDescription className="mt-1 leading-5">
                      {meta.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="mt-auto flex items-end justify-between gap-3 pt-1">
                  <div className="min-w-0 text-xs">
                    <span
                      className={cn(
                        'flex items-center gap-1.5 font-medium',
                        status.className
                      )}
                    >
                      <StatusIcon className="size-3.5" />
                      {status.label}
                    </span>
                    {primary ? (
                      <p className="text-muted-foreground mt-1 truncate">
                        {primary.display_name ||
                          primary.username ||
                          primary.external_account_id}
                        {connected.length > 1
                          ? ` +${connected.length - 1}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  {isWhatsApp ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenWhatsApp}
                    >
                      Manage
                    </Button>
                  ) : channel === 'tiktok' ? (
                    <span className="text-muted-foreground text-xs">
                      Awaiting API access
                    </span>
                  ) : primary ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => setSetupChannel(channel)}
                      >
                        Update
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={saving}
                        onClick={() => void disconnectSocialChannel(primary)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => setSetupChannel(channel)}
                    >
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog
        open={setupChannel !== null}
        onOpenChange={(open) => !open && setSetupChannel(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Connect{' '}
              {setupChannel === 'instagram'
                ? 'Instagram'
                : 'Facebook Messenger'}
            </DialogTitle>
            <DialogDescription>
              The access token is encrypted on the server. Use the connected
              professional account or Page ID that Meta sends as the webhook
              receiver.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="social-account-id">Meta account or Page ID</Label>
              <Input
                id="social-account-id"
                value={form.externalAccountId}
                onChange={(event) =>
                  setForm({ ...form, externalAccountId: event.target.value })
                }
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="social-display-name">Display name</Label>
              <Input
                id="social-display-name"
                value={form.displayName}
                onChange={(event) =>
                  setForm({ ...form, displayName: event.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="social-username">Username (optional)</Label>
              <Input
                id="social-username"
                value={form.username}
                onChange={(event) =>
                  setForm({ ...form, username: event.target.value })
                }
                placeholder="without @"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="social-access-token">Meta access token</Label>
              <Input
                id="social-access-token"
                type="password"
                value={form.accessToken}
                onChange={(event) =>
                  setForm({ ...form, accessToken: event.target.value })
                }
                autoComplete="new-password"
              />
            </div>
            <p className="text-muted-foreground bg-muted rounded-lg p-3 text-xs leading-5">
              Webhook callback:{' '}
              <code>
                {typeof window === 'undefined'
                  ? '/api/{channel}/webhook'
                  : `${window.location.origin}/api/${setupChannel}/webhook`}
              </code>
              . Configure its matching verify token and{' '}
              <code>META_APP_SECRET</code> in the deployment environment.
            </p>
            <Button
              className="w-full"
              disabled={
                saving ||
                !form.externalAccountId.trim() ||
                !form.accessToken.trim()
              }
              onClick={() => void saveSocialChannel()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}Save
              connection
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
