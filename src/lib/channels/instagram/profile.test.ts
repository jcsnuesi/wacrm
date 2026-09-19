import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
}));

import { getInstagramProfile } from './profile';

describe('getInstagramProfile', () => {
  it('uses the Instagram-scoped sender ID and maps public profile fields', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          name: 'Jean Carlos Santos',
          username: 'jeansantos06',
          profile_pic: 'https://cdn.example.test/profile.jpg',
        }),
        { status: 200 }
      )
    );

    await expect(
      getInstagramProfile('17841400613892250', 'encrypted-token', fetchMock)
    ).resolves.toEqual({
      name: 'Jean Carlos Santos',
      username: 'jeansantos06',
      profilePictureUrl: 'https://cdn.example.test/profile.jpg',
    });

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.hostname).toBe('graph.instagram.com');
    expect(url.searchParams.get('fields')).toBe('name,username,profile_pic');
    expect(options.headers).toEqual({ Authorization: 'Bearer plain:encrypted-token' });
  });

  it('fails open when Meta rejects the lookup', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 403 }));
    await expect(
      getInstagramProfile('17841400613892250', 'encrypted-token', fetchMock)
    ).resolves.toBeNull();
  });
});
