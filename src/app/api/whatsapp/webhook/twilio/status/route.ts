import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  formParams,
  isValidTwilioRequest,
  mapTwilioStatus,
} from '@/lib/whatsapp/twilio-webhook';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params = formParams(rawBody);
  if (!isValidTwilioRequest(request, params)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  const messageSid = params.MessageSid || params.SmsSid;
  if (!messageSid) return new Response(null, { status: 204 });
  const status = mapTwilioStatus(params);
  const providerError =
    status === 'failed'
      ? params.ChannelStatusMessage ||
        params.ErrorMessage ||
        params.ErrorCode ||
        null
      : null;
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status, provider_error: providerError })
    .eq('message_id', messageSid);
  if (error) {
    console.error('[twilio-status] update failed:', error.message);
    return new Response('Database update failed', { status: 500 });
  }
  return new Response(null, { status: 204 });
}
