'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Activity, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

type Status = 'disabled' | 'testing' | 'active';
interface Connection {
  id: string;
  whatsapp_config_id: string;
  business_portfolio_id: string | null;
  ad_account_id: string | null;
  waba_id: string;
  dataset_id: string;
  graph_api_version: string;
  test_event_code: string | null;
  status: Status;
  has_token: boolean;
  last_error: string | null;
}
interface Mapping {
  stage_id: string | null;
  event_name: string;
  include_value: boolean;
  is_enabled: boolean;
}
interface ConfigData {
  connection: Connection | null;
  whatsapp_configs: {
    id: string;
    waba_id: string | null;
    sender_phone: string | null;
  }[];
  pipelines: {
    id: string;
    name: string;
    pipeline_stages: { id: string; name: string; position: number }[];
  }[];
  mappings: Mapping[];
  delivery: Record<string, number>;
}

const EMPTY = {
  id: '',
  whatsapp_config_id: '',
  business_portfolio_id: '',
  ad_account_id: '',
  waba_id: '',
  dataset_id: '',
  graph_api_version: 'v25.0',
  test_event_code: '',
  access_token: '',
  status: 'disabled' as Status,
};

export function MetaCapiSettings() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch('/api/meta/capi/config', {
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as
      ConfigData | { error?: string } | null;
    if (!response.ok || !body || !('pipelines' in body)) {
      toast.error(
        (body as { error?: string } | null)?.error ??
          'Could not load Meta CAPI settings'
      );
      setLoading(false);
      return;
    }
    setData(body);
    const c = body.connection;
    setForm(
      c
        ? {
            id: c.id,
            whatsapp_config_id: c.whatsapp_config_id ?? '',
            business_portfolio_id: c.business_portfolio_id ?? '',
            ad_account_id: c.ad_account_id ?? '',
            waba_id: c.waba_id,
            dataset_id: c.dataset_id,
            graph_api_version: c.graph_api_version,
            test_event_code: c.test_event_code ?? '',
            access_token: '',
            status: c.status,
          }
        : EMPTY
    );
    setMappings(
      Object.fromEntries(
        body.mappings.filter((m) => m.stage_id).map((m) => [m.stage_id!, m])
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const stages = useMemo(
    () =>
      data?.pipelines.flatMap((pipeline) =>
        [...pipeline.pipeline_stages]
          .sort((a, b) => a.position - b.position)
          .map((stage) => ({ ...stage, pipeline: pipeline.name }))
      ) ?? [],
    [data]
  );

  function chooseWhatsApp(id: string) {
    const config = data?.whatsapp_configs.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      whatsapp_config_id: id,
      waba_id: config?.waba_id ?? current.waba_id,
    }));
  }

  async function save() {
    if (!form.whatsapp_config_id || !form.waba_id || !form.dataset_id) {
      toast.error('Select WhatsApp and enter the WABA and dataset IDs');
      return;
    }
    setSaving(true);
    const response = await fetch('/api/meta/capi/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, mappings: Object.values(mappings) }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setSaving(false);
    if (!response.ok) {
      toast.error(body?.error ?? 'Could not save CAPI settings');
      return;
    }
    toast.success('Meta CAPI settings saved');
    await load();
  }

  async function sendTest() {
    setTesting(true);
    const response = await fetch('/api/meta/capi/test', { method: 'POST' });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setTesting(false);
    if (!response.ok) {
      toast.error(body?.error ?? 'Meta test event failed');
      return;
    }
    toast.success('Test event accepted by Meta');
    await load();
  }

  if (loading)
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );

  const tokenReady = !!data?.connection?.has_token || !!form.access_token;
  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead
        title="Meta Conversions API"
        description="Send qualified CRM outcomes back to Meta so campaigns learn from real leads and sales."
      />
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="text-primary size-4" />
                  Connection
                </CardTitle>
                <CardDescription className="mt-1">
                  Keep this in Testing until events appear correctly in Events
                  Manager.
                </CardDescription>
              </div>
              <Badge
                variant={form.status === 'active' ? 'default' : 'secondary'}
              >
                {form.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp connection">
              <select
                value={form.whatsapp_config_id}
                onChange={(e) => chooseWhatsApp(e.target.value)}
                className="border-border bg-muted h-9 w-full rounded-lg border px-2.5 text-sm"
              >
                <option value="">Select connection</option>
                {data?.whatsapp_configs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sender_phone || item.waba_id || item.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mode">
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as Status })
                }
                className="border-border bg-muted h-9 w-full rounded-lg border px-2.5 text-sm"
              >
                <option value="disabled">Disabled</option>
                <option value="testing">Testing</option>
                <option value="active">Active</option>
              </select>
            </Field>
            <TextField
              label="WhatsApp Business Account ID"
              value={form.waba_id}
              onChange={(waba_id) => setForm({ ...form, waba_id })}
            />
            <TextField
              label="Dataset ID"
              value={form.dataset_id}
              onChange={(dataset_id) => setForm({ ...form, dataset_id })}
            />
            <TextField
              label="Business portfolio ID (optional)"
              value={form.business_portfolio_id}
              onChange={(business_portfolio_id) =>
                setForm({ ...form, business_portfolio_id })
              }
            />
            <TextField
              label="Ad account ID (optional)"
              value={form.ad_account_id}
              onChange={(ad_account_id) => setForm({ ...form, ad_account_id })}
            />
            <TextField
              label="Graph API version"
              value={form.graph_api_version}
              onChange={(graph_api_version) =>
                setForm({ ...form, graph_api_version })
              }
            />
            <TextField
              label="Test event code"
              value={form.test_event_code}
              onChange={(test_event_code) =>
                setForm({ ...form, test_event_code })
              }
            />
            <div className="sm:col-span-2">
              <TextField
                label={`Access token${data?.connection?.has_token ? ' (saved — leave blank to keep)' : ''}`}
                type="password"
                value={form.access_token}
                onChange={(access_token) => setForm({ ...form, access_token })}
              />
              <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <ShieldCheck className="size-3.5" />
                Encrypted at rest and never returned to the browser.{' '}
                {!tokenReady && 'A token is still required.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CRM event rules</CardTitle>
            <CardDescription>
              The first stage defaults to LeadSubmitted. A won deal always sends
              Purchase with its saved value and currency.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {stages.map((stage) => {
              const mapping = mappings[stage.id] ?? {
                stage_id: stage.id,
                event_name: 'LeadSubmitted',
                include_value: false,
                is_enabled: false,
              };
              return (
                <div
                  key={stage.id}
                  className="border-border grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_180px_auto]"
                >
                  <div>
                    <p className="text-sm font-medium">{stage.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {stage.pipeline}
                    </p>
                  </div>
                  <Input
                    value={mapping.event_name}
                    disabled={!mapping.is_enabled}
                    onChange={(e) =>
                      setMappings({
                        ...mappings,
                        [stage.id]: { ...mapping, event_name: e.target.value },
                      })
                    }
                    aria-label={`Event for ${stage.name}`}
                  />
                  <Switch
                    checked={mapping.is_enabled}
                    onCheckedChange={(is_enabled) =>
                      setMappings({
                        ...mappings,
                        [stage.id]: { ...mapping, is_enabled },
                      })
                    }
                    aria-label={`Enable ${stage.name}`}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
            <CardDescription>
              Durable delivery queue with automatic retries and duplicate
              protection.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {['pending', 'retry', 'sent', 'dead'].map((status) => (
              <Badge key={status} variant="outline">
                {status}: {data?.delivery[status] ?? 0}
              </Badge>
            ))}
            {data?.connection && !data.connection.last_error && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                No connection errors
              </span>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save Meta CAPI settings'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={sendTest}
            disabled={testing || !form.id || form.status !== 'testing'}
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send test event'
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
