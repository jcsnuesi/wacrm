import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const runtime = 'nodejs';

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

/**
 * Validate Meta's signature before accepting events. The normalized Instagram
 * persistence pipeline is not live yet, so valid events receive 503 and are
 * retried instead of being acknowledged and silently discarded.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get('x-hub-signature-256')
    )
  ) {
    return new Response('Invalid signature', { status: 403 });
  }

  try {
    JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  return new Response('Instagram event processing is not active', {
    status: 503,
  });
}
