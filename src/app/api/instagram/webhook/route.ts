import { InstagramProvider } from '@/lib/channels/instagram/provider';
import { processMetaWebhook } from '@/lib/channels/meta-webhook';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const runtime = 'nodejs';
export const maxDuration = 60;

const provider = new InstagramProvider(async () => {
  throw new Error('Instagram outbound sending is not configured');
});

/** Meta challenge handshake for the Instagram webhook subscription. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (
    mode !== 'subscribe' ||
    !challenge ||
    !process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
    verifyToken !== process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const instagramSecret = process.env.INSTAGRAM_APP_SECRET;
  const metaSecret = process.env.META_APP_SECRET;
  const verifiedWithInstagramSecret = instagramSecret
    ? verifyMetaWebhookSignature(rawBody, signature, instagramSecret)
    : false;
  if (
    !verifiedWithInstagramSecret &&
    !verifyMetaWebhookSignature(rawBody, signature, metaSecret)
  ) {
    console.warn('[instagram webhook] rejected invalid signature', {
      instagramSecretConfigured: Boolean(instagramSecret),
      metaSecretConfigured: Boolean(metaSecret),
    });
    return new Response('Invalid signature', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const entryCount = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? (payload as { entry: unknown[] }).entry.length
    : 0;
  console.info('[instagram webhook] received', { entryCount });

  try {
    // Do not acknowledge until the event is persisted. If storage is
    // unavailable, Meta receives a 500 and retries instead of silently losing
    // the message. Inbound persistence is idempotent by external message ID.
    await processMetaWebhook('instagram', provider, payload);
    console.info('[instagram webhook] processed', { entryCount });
    return Response.json({ status: 'received' });
  } catch (error) {
    console.error('[instagram webhook] inbound persistence failed:', error);
    return new Response('Unable to process webhook', { status: 500 });
  }
}
