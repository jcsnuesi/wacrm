import { describe, expect, it } from 'vitest';

import { FacebookProvider } from './provider';

describe('FacebookProvider', () => {
  it('normalizes an attachment message', () => {
    const provider = new FacebookProvider(async () => ({
      externalMessageId: 'outbound', sentAt: '2026-01-01T00:00:00.000Z',
    }));
    const [event] = provider.parseWebhook({ entry: [{ messaging: [{
      sender: { id: 'page-user' }, message: { mid: 'm1', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/image.jpg' } }] },
    }] }] }, 'channel-account');

    expect(event).toMatchObject({
      channel: 'facebook', externalUserId: 'page-user', messageType: 'image',
      media: { url: 'https://cdn.example/image.jpg' },
    });
  });
});
