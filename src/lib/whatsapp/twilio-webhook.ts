import type { MessageStatus } from '@/types';
import { validateTwilioWebhook } from '@/lib/whatsapp/twilio-api';

export function formParams(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

export function isValidTwilioRequest(
  request: Request,
  params: Record<string, string>
): boolean {
  try {
    return validateTwilioWebhook(
      request.url,
      request.headers.get('x-twilio-signature'),
      params
    );
  } catch (error) {
    console.error('[twilio-webhook] validation unavailable:', error);
    return false;
  }
}

export function stripWhatsAppPrefix(value: string): string {
  const phone = value.replace(/^whatsapp:/i, '');
  return phone.startsWith('+') ? phone : `+${phone}`;
}

export function mapTwilioStatus(params: Record<string, string>): MessageStatus {
  if (params.EventType?.toUpperCase() === 'READ') return 'read';
  switch ((params.MessageStatus || params.SmsStatus || '').toLowerCase()) {
    case 'read':
      return 'read';
    case 'delivered':
      return 'delivered';
    case 'failed':
    case 'undelivered':
    case 'canceled':
      return 'failed';
    default:
      return 'sent';
  }
}
