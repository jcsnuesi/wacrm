import { describe, expect, it } from 'vitest';

import { InstagramProvider } from './provider';

describe('InstagramProvider', () => {
  it('normalizes inbound messages and skips provider echoes', () => {
    const provider = new InstagramProvider(async () => ({
      externalMessageId: 'outbound',
      sentAt: '2026-01-01T00:00:00.000Z',
    }));
    const events = provider.parseWebhook(
      {
        entry: [{ messaging: [
          { sender: { id: 'ig-user' }, timestamp: 1, message: { mid: 'm1', text: 'Hola' } },
          { sender: { id: 'ig-user' }, message: { mid: 'm2', is_echo: true, text: 'Sent' } },
        ] }],
      },
      'channel-account'
    );

    expect(events).toEqual([expect.objectContaining({
      channel: 'instagram', externalUserId: 'ig-user', externalMessageId: 'm1',
      externalConversationId: 'ig-user', text: 'Hola',
    })]);
  });
});
