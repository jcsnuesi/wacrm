import { decrypt } from '@/lib/whatsapp/encryption';
import { metaCapiAdmin } from './admin-client';
import { sendMetaCapiEvent } from './client';

const MAX_ATTEMPTS = 8;

interface OutboxRow {
  id: string;
  connection_id: string;
  attempt_count: number;
  payload: Record<string, unknown>;
}

interface ConnectionRow {
  dataset_id: string;
  access_token_encrypted: string | null;
  graph_api_version: string;
  test_event_code: string | null;
  status: string;
  whatsapp_config_id: string | null;
}

function errorMessage(body: unknown, status: number) {
  const serialized = JSON.stringify(body);
  return `Meta API ${status || 'network'}: ${serialized.slice(0, 1500)}`;
}

export function retryDelayMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export async function dispatchMetaCapiOutbox(limit = 50) {
  const admin = metaCapiAdmin();
  const now = new Date();
  const stale = new Date(now.getTime() - 10 * 60_000).toISOString();

  await admin
    .from('meta_capi_outbox')
    .update({
      status: 'retry',
      locked_at: null,
      last_error: 'Recovered stale worker lock',
    })
    .eq('status', 'processing')
    .lt('locked_at', stale);

  const { data, error } = await admin
    .from('meta_capi_outbox')
    .select('id, connection_id, attempt_count, payload')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as OutboxRow[]) {
    const { data: claimed } = await admin
      .from('meta_capi_outbox')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('id', row.id)
      .in('status', ['pending', 'retry'])
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const attempt = row.attempt_count + 1;
    const { data: connection } = await admin
      .from('meta_capi_connections')
      .select(
        'dataset_id, access_token_encrypted, graph_api_version, test_event_code, status, whatsapp_config_id'
      )
      .eq('id', row.connection_id)
      .maybeSingle();
    const conn = connection as ConnectionRow | null;

    let encryptedToken = conn?.access_token_encrypted ?? null;
    if (!encryptedToken && conn?.whatsapp_config_id) {
      const { data: whatsapp } = await admin
        .from('whatsapp_config')
        .select('access_token')
        .eq('id', conn.whatsapp_config_id)
        .maybeSingle();
      encryptedToken = (whatsapp?.access_token as string | null) ?? null;
    }

    if (
      !conn ||
      !['testing', 'active'].includes(conn.status) ||
      !encryptedToken
    ) {
      await admin
        .from('meta_capi_outbox')
        .update({
          status: 'dead',
          attempt_count: attempt,
          locked_at: null,
          last_error: 'CAPI connection is disabled or has no access token',
        })
        .eq('id', row.id);
      failed++;
      continue;
    }

    let token: string;
    try {
      token = decrypt(encryptedToken);
    } catch {
      await admin
        .from('meta_capi_outbox')
        .update({
          status: 'dead',
          attempt_count: attempt,
          locked_at: null,
          last_error: 'CAPI access token could not be decrypted',
        })
        .eq('id', row.id);
      failed++;
      continue;
    }

    const result = await sendMetaCapiEvent(
      {
        datasetId: conn.dataset_id,
        accessToken: token,
        graphApiVersion: conn.graph_api_version,
        testEventCode: conn.status === 'testing' ? conn.test_event_code : null,
      },
      row.payload
    );

    if (result.ok) {
      await Promise.all([
        admin
          .from('meta_capi_outbox')
          .update({
            status: 'sent',
            attempt_count: attempt,
            locked_at: null,
            sent_at: new Date().toISOString(),
            last_error: null,
            response: result.body,
          })
          .eq('id', row.id),
        admin
          .from('meta_capi_connections')
          .update({
            last_verified_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.connection_id),
      ]);
      sent++;
      continue;
    }

    const retry = result.retryable && attempt < MAX_ATTEMPTS;
    await admin
      .from('meta_capi_outbox')
      .update({
        status: retry ? 'retry' : 'dead',
        attempt_count: attempt,
        next_attempt_at: retry
          ? new Date(Date.now() + retryDelayMs(attempt)).toISOString()
          : new Date().toISOString(),
        locked_at: null,
        last_error: errorMessage(result.body, result.status),
        response: result.body,
      })
      .eq('id', row.id);
    await admin
      .from('meta_capi_connections')
      .update({
        last_error: errorMessage(result.body, result.status),
      })
      .eq('id', row.connection_id);
    failed++;
  }

  return { processed: sent + failed, sent, failed };
}
