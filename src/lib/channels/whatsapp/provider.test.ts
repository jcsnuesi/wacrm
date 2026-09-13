import { describe, expect, it } from 'vitest';

import { WhatsAppProvider } from './provider';

describe('WhatsAppProvider', () => {
  const provider = new WhatsAppProvider(async () => ({
    externalMessageId: 'outbound-id',
    sentAt: '2026-09-12T00:00:00.000Z',
  }));

  it('normalizes a Meta text message', () => {
    expect(
      provider.parseWebhook(
        {
          entry: [
            {
              changes: [
                {
                  value: {
                    contacts: [
                      { wa_id: '18095551212', profile: { name: 'Hector' } },
                    ],
                    messages: [
                      {
                        id: 'wamid.1',
                        from: '18095551212',
                        timestamp: '1726099200',
                        type: 'text',
                        text: { body: 'Hola' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        'channel-account-1'
      )
    ).toMatchObject([
      {
        channel: 'whatsapp',
        channelAccountId: 'channel-account-1',
        externalUserId: '18095551212',
        externalMessageId: 'wamid.1',
        displayName: 'Hector',
        text: 'Hola',
      },
    ]);
  });

  it('ignores malformed messages without stable identifiers', () => {
    expect(
      provider.parseWebhook(
        { entry: [{ changes: [{ value: { messages: [{}] } }] }] },
        'a'
      )
    ).toEqual([]);
  });
});
