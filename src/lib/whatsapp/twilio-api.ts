import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import twilio, { validateRequest } from 'twilio';

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export class TwilioProviderError extends Error {
  readonly code: string;

  constructor(message: string, code = 'twilio_error') {
    super(message);
    this.name = 'TwilioProviderError';
    this.code = code;
  }
}

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    throw new TwilioProviderError(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      'twilio_not_configured'
    );
  }
  return { accountSid, authToken };
}

function whatsappAddress(phone: string): string {
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new TwilioProviderError(`Invalid E.164 phone number: ${phone}`);
  }
  return `whatsapp:${normalized}`;
}

function statusCallbackUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    throw new TwilioProviderError(
      'NEXT_PUBLIC_SITE_URL is required for Twilio status callbacks.',
      'twilio_site_url_missing'
    );
  }
  return new URL('/api/whatsapp/webhook/twilio/status', siteUrl).toString();
}

function providerMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: string; code?: number | string };
    if (value.message) {
      return value.code ? `(${value.code}) ${value.message}` : value.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

async function createContent(
  payload: InteractiveMessagePayload
): Promise<string> {
  const { accountSid, authToken } = credentials();
  const locale = (process.env.NEXT_PUBLIC_APP_LOCALE || 'en').replace('_', '-');
  const friendlyName = `wacrm_${payload.kind}_${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 20)}`;

  const types =
    payload.kind === 'buttons'
      ? {
          'twilio/quick-reply': {
            body: payload.body,
            actions: payload.buttons.map((button) => ({
              title: button.title,
              id: button.id,
            })),
          },
        }
      : {
          'twilio/list-picker': {
            body: payload.body,
            button: payload.button_label,
            items: payload.sections.flatMap((section) =>
              section.rows.map((row) => ({
                item: row.title,
                id: row.id,
                // Twilio requires this property even though Meta allows it
                // to be omitted. The title is a valid, bounded fallback.
                description: row.description || row.title,
              }))
            ),
          },
        };

  const response = await fetch('https://content.twilio.com/v1/Content', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      friendly_name: friendlyName,
      language: locale,
      types,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    sid?: string;
    message?: string;
  } | null;
  if (!response.ok || !body?.sid) {
    throw new TwilioProviderError(
      body?.message || `Twilio Content API error (${response.status})`
    );
  }
  return body.sid;
}

async function resolveContentSid(
  db: SupabaseClient,
  accountId: string,
  payload: InteractiveMessagePayload
): Promise<string> {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  const { data: cached } = await db
    .from('twilio_content_cache')
    .select('content_sid')
    .eq('account_id', accountId)
    .eq('payload_hash', payloadHash)
    .maybeSingle();
  if (cached?.content_sid) return cached.content_sid;

  const contentSid = await createContent(payload);
  const { error } = await db.from('twilio_content_cache').insert({
    account_id: accountId,
    payload_hash: payloadHash,
    content_sid: contentSid,
    content_kind: payload.kind,
  });
  if (error && error.code !== '23505') {
    console.warn('[twilio] content cache insert failed:', error.message);
  }
  if (error?.code === '23505') {
    const { data: winner } = await db
      .from('twilio_content_cache')
      .select('content_sid')
      .eq('account_id', accountId)
      .eq('payload_hash', payloadHash)
      .maybeSingle();
    if (winner?.content_sid) return winner.content_sid;
  }
  return contentSid;
}

export interface SendTwilioMessageArgs {
  db: SupabaseClient;
  accountId: string;
  from: string;
  to: string;
  body?: string;
  mediaUrl?: string;
  interactivePayload?: InteractiveMessagePayload;
}

export async function sendTwilioMessage(
  args: SendTwilioMessageArgs
): Promise<{ messageId: string }> {
  const { accountSid, authToken } = credentials();
  const client = twilio(accountSid, authToken);
  try {
    const contentSid = args.interactivePayload
      ? await resolveContentSid(
          args.db,
          args.accountId,
          args.interactivePayload
        )
      : undefined;
    const message = await client.messages.create({
      from: whatsappAddress(args.from),
      to: whatsappAddress(args.to),
      statusCallback: statusCallbackUrl(),
      ...(contentSid
        ? { contentSid }
        : args.mediaUrl
          ? {
              mediaUrl: [args.mediaUrl],
              ...(args.body ? { body: args.body } : {}),
            }
          : { body: args.body || '' }),
    });
    return { messageId: message.sid };
  } catch (error) {
    if (error instanceof TwilioProviderError) throw error;
    throw new TwilioProviderError(providerMessage(error));
  }
}

export function canonicalTwilioWebhookUrl(requestUrl: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl)
    throw new TwilioProviderError('NEXT_PUBLIC_SITE_URL is required.');
  const incoming = new URL(requestUrl);
  const canonical = new URL(siteUrl);
  canonical.pathname = incoming.pathname;
  canonical.search = incoming.search;
  return canonical.toString();
}

export function validateTwilioWebhook(
  requestUrl: string,
  signature: string | null,
  params: Record<string, string>
): boolean {
  if (!signature) return false;
  const { authToken } = credentials();
  return validateRequest(
    authToken,
    signature,
    canonicalTwilioWebhookUrl(requestUrl),
    params
  );
}

export function twilioCredentials(): { accountSid: string; authToken: string } {
  return credentials();
}

export async function verifyTwilioSender(
  senderPhone: string
): Promise<{ senderPhone: string }> {
  const { accountSid, authToken } = credentials();
  const normalized = whatsappAddress(senderPhone);
  const response = await fetch(
    'https://messaging.twilio.com/v2/Channels/Senders?PageSize=100',
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
      cache: 'no-store',
    }
  );
  const body = (await response.json().catch(() => null)) as {
    senders?: Array<Record<string, unknown>>;
    message?: string;
  } | null;
  if (!response.ok) {
    throw new TwilioProviderError(
      body?.message || `Twilio Senders API error (${response.status})`
    );
  }
  const found = body?.senders?.some((sender) => {
    const address = String(
      sender.sender_id || sender.senderId || sender.address || ''
    ).toLowerCase();
    return address === normalized.toLowerCase();
  });
  if (!found) {
    throw new TwilioProviderError(
      `${normalized} is not a WhatsApp sender in the configured Twilio account.`
    );
  }
  return { senderPhone: normalized.replace(/^whatsapp:/, '') };
}
