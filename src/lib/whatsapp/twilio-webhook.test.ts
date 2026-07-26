import { describe, expect, it } from 'vitest';

import {
  formParams,
  mapTwilioStatus,
  stripWhatsAppPrefix,
} from './twilio-webhook';

describe('Twilio webhook normalization', () => {
  it('parses form-encoded webhook bodies', () => {
    expect(formParams('MessageSid=SM123&Body=Hello+world')).toEqual({
      MessageSid: 'SM123',
      Body: 'Hello world',
    });
  });

  it('normalizes WhatsApp channel addresses', () => {
    expect(stripWhatsAppPrefix('whatsapp:+18095550123')).toBe('+18095550123');
    expect(stripWhatsAppPrefix('18095550123')).toBe('+18095550123');
  });

  it.each([
    [{ MessageStatus: 'queued' }, 'sent'],
    [{ MessageStatus: 'delivered' }, 'delivered'],
    [{ MessageStatus: 'undelivered' }, 'failed'],
    [{ MessageStatus: 'failed' }, 'failed'],
    [{ EventType: 'READ', MessageStatus: 'delivered' }, 'read'],
  ])('maps Twilio status %o to %s', (params, expected) => {
    expect(mapTwilioStatus(params)).toBe(expected);
  });
});
