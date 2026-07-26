import { createClient } from '@/lib/supabase/server';
import { twilioCredentials } from '@/lib/whatsapp/twilio-api';

export async function GET(
  _request: Request,
  context: { params: Promise<{ messageSid: string }> }
) {
  const { messageSid } = await context.params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // RLS on messages proves the caller belongs to the owning account.
  const { data, error } = await db
    .from('messages')
    .select('provider_media_url')
    .eq('message_id', messageSid)
    .limit(1);
  const mediaUrl = data?.[0]?.provider_media_url;
  if (error || !mediaUrl)
    return new Response('Media not found', { status: 404 });

  const { accountSid, authToken } = twilioCredentials();
  const upstream = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) {
    return new Response('Could not fetch Twilio media', { status: 502 });
  }
  const headers = new Headers();
  headers.set(
    'Content-Type',
    upstream.headers.get('content-type') || 'application/octet-stream'
  );
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(upstream.body, { status: 200, headers });
}
