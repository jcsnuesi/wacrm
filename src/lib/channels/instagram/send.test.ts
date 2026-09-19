import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
}));

import { sendInstagramText } from './send';

describe('sendInstagramText', () => {
  it('sends a text DM through the connected Instagram professional account', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ recipient_id: 'igsid-1', message_id: 'ig-mid-1' }), {
        status: 200,
      })
    );

    await expect(
      sendInstagramText({
        instagramAccountId: 'ig-business-1',
        recipientInstagramScopedId: 'igsid-1',
        encryptedAccessToken: 'encrypted-token',
        text: 'Hola',
        fetchImpl: fetchMock,
      })
    ).resolves.toEqual({ externalMessageId: 'ig-mid-1' });

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/ig-business-1/messages');
    expect(options.headers).toEqual({
      Authorization: 'Bearer plain:encrypted-token',
      'Content-Type': 'application/json',
    });
    expect(options.body).toBe(
      JSON.stringify({ recipient: { id: 'igsid-1' }, message: { text: 'Hola' } })
    );
  });
});
