import { after } from 'next/server';

import { FacebookProvider } from '@/lib/channels/facebook/provider';
import { processMetaWebhook } from '@/lib/channels/meta-webhook';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const runtime = 'nodejs';
export const maxDuration = 60;

const provider = new FacebookProvider(async () => {
  throw new Error('Facebook outbound sending is not configured');
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  if (
    mode !== 'subscribe' ||
    !challenge ||
    !process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ||
    verifyToken !== process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(challenge, {
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 403 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  after(async () => {
    try {
      await processMetaWebhook('facebook', provider, payload);
    } catch (error) {
      console.error('[facebook webhook] inbound persistence failed:', error);
    }
  });
  return Response.json({ status: 'received' });
}
