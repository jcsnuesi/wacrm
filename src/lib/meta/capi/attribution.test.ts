import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  captureClickToWhatsAppAttribution,
  parseClickToWhatsAppReferral,
  type CaptureClickToWhatsAppAttributionInput,
} from './attribution';

function fakeDb(error: { code?: string; message: string } | null = null) {
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      expect(table).toBe('meta_attributions');
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          return Promise.resolve({ error });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, inserts };
}

const input: CaptureClickToWhatsAppAttributionInput = {
  accountId: 'account-1',
  customerId: 'customer-1',
  conversationId: 'conversation-1',
  whatsappConfigId: 'config-1',
  externalMessageId: 'wamid.1',
  wabaId: 'waba-1',
  attributedAt: '2026-09-24T12:00:00.000Z',
  referral: {
    ctwaClid: 'click-1',
    sourceId: 'ad-1',
    sourceType: 'ad',
    sourceUrl: 'https://fb.me/example',
    creative: { headline: 'Hair solution', media_type: 'image' },
  },
};

describe('parseClickToWhatsAppReferral', () => {
  it('extracts and trims the supported attribution fields', () => {
    expect(
      parseClickToWhatsAppReferral({
        ctwa_clid: ' click-1 ',
        source_id: ' ad-1 ',
        source_type: ' ad ',
        source_url: ' https://fb.me/example ',
        headline: ' Headline ',
        body: ' Body ',
        media_type: ' image ',
        image_url: 'https://example.test/not-persisted.jpg',
      })
    ).toEqual({
      ctwaClid: 'click-1',
      sourceId: 'ad-1',
      sourceType: 'ad',
      sourceUrl: 'https://fb.me/example',
      creative: {
        headline: 'Headline',
        body: 'Body',
        media_type: 'image',
      },
    });
  });

  it.each([undefined, null, 'click-1', {}, { ctwa_clid: '  ' }])(
    'ignores a non-attributable referral: %o',
    (value) => {
      expect(parseClickToWhatsAppReferral(value)).toBeNull();
    }
  );
});

describe('captureClickToWhatsAppAttribution', () => {
  it('writes an account-scoped attribution without the raw payload', async () => {
    const { db, inserts } = fakeDb();

    await expect(captureClickToWhatsAppAttribution(db, input)).resolves.toBe(
      'captured'
    );
    expect(inserts).toEqual([
      {
        account_id: 'account-1',
        customer_id: 'customer-1',
        conversation_id: 'conversation-1',
        whatsapp_config_id: 'config-1',
        source_type: 'click_to_whatsapp',
        ctwa_clid: 'click-1',
        external_message_id: 'wamid.1',
        waba_id: 'waba-1',
        source_id: 'ad-1',
        source_url: 'https://fb.me/example',
        referral_source_type: 'ad',
        attributed_at: '2026-09-24T12:00:00.000Z',
        metadata: { headline: 'Hair solution', media_type: 'image' },
      },
    ]);
  });

  it('treats Meta webhook replays as idempotent duplicates', async () => {
    const { db } = fakeDb({ code: '23505', message: 'duplicate key' });
    await expect(captureClickToWhatsAppAttribution(db, input)).resolves.toBe(
      'duplicate'
    );
  });

  it('surfaces non-duplicate database failures', async () => {
    const { db } = fakeDb({ code: '42501', message: 'permission denied' });
    await expect(captureClickToWhatsAppAttribution(db, input)).rejects.toThrow(
      'Failed to capture Meta attribution: permission denied'
    );
  });
});
