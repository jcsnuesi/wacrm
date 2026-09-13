import { describe, expect, it } from 'vitest';

import { TikTokProvider } from './provider';

describe('TikTokProvider', () => {
  it('makes its unavailable messaging capability explicit', async () => {
    const provider = new TikTokProvider();
    expect(provider.parseWebhook({}, 'account')).toEqual([]);
    await expect(provider.sendMessage({ channelAccountId: 'account', recipientExternalUserId: 'user', text: 'Hi' }))
      .rejects.toThrow('TikTok messaging is not enabled');
  });
});
