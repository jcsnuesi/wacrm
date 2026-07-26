import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { createMessage, validateRequest } = vi.hoisted(() => ({
  createMessage: vi.fn(async () => ({
    sid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })),
  validateRequest: vi.fn(() => true),
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: createMessage } })),
  validateRequest,
}));

import {
  sendTwilioMessage,
  validateTwilioWebhook,
  verifyTwilioSender,
} from './twilio-api';

function cacheDb() {
  let cachedSid: string | null = null;
  const db = {
    from(table: string) {
      if (table !== 'twilio_content_cache')
        throw new Error(`Unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: cachedSid ? { content_sid: cachedSid } : null,
          error: null,
        }),
        insert: async (row: { content_sid: string }) => {
          cachedSid = row.content_sid;
          return { error: null };
        },
      };
      return chain;
    },
  };
  return db as unknown as SupabaseClient;
}

describe('Twilio provider adapter', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';
    createMessage.mockClear();
    validateRequest.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends freeform text with WhatsApp addresses and a status callback', async () => {
    await sendTwilioMessage({
      db: cacheDb(),
      accountId: 'acct-1',
      from: '+14155550199',
      to: '18095550123',
      body: 'Hello',
    });

    expect(createMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+14155550199',
      to: 'whatsapp:+18095550123',
      body: 'Hello',
      statusCallback:
        'https://crm.example.com/api/whatsapp/webhook/twilio/status',
    });
  });

  it('creates an interactive Content SID once and reuses it by payload hash', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ sid: 'HXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
    );
    vi.stubGlobal('fetch', fetchMock);
    const db = cacheDb();
    const interactivePayload = {
      kind: 'buttons' as const,
      body: 'Choose',
      buttons: [{ id: 'yes', title: 'Yes' }],
    };

    await sendTwilioMessage({
      db,
      accountId: 'acct-1',
      from: '+14155550199',
      to: '+18095550123',
      interactivePayload,
    });
    await sendTwilioMessage({
      db,
      accountId: 'acct-1',
      from: '+14155550199',
      to: '+18095550123',
      interactivePayload,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const contentRequest = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(contentRequest.body))).toMatchObject({
      types: {
        'twilio/quick-reply': {
          actions: [{ id: 'yes', title: 'Yes' }],
        },
      },
    });
    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(createMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentSid: 'HXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      })
    );
  });

  it('validates against the canonical public webhook URL', () => {
    expect(
      validateTwilioWebhook(
        'http://internal:3000/api/whatsapp/webhook/twilio/inbound',
        'signature',
        { MessageSid: 'SM123' }
      )
    ).toBe(true);
    expect(validateRequest).toHaveBeenCalledWith(
      'secret',
      'signature',
      'https://crm.example.com/api/whatsapp/webhook/twilio/inbound',
      { MessageSid: 'SM123' }
    );
  });

  it('filters the Senders API by the required WhatsApp channel', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          senders: [{ sender_id: 'whatsapp:+14155550199' }],
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyTwilioSender('+14155550199')).resolves.toEqual({
      senderPhone: '+14155550199',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=100',
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});
