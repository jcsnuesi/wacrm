import { decrypt } from '@/lib/whatsapp/encryption';

export type InstagramProfile = {
  name: string | null;
  username: string | null;
  profilePictureUrl: string | null;
};

type InstagramProfileResponse = {
  name?: unknown;
  username?: unknown;
  profile_pic?: unknown;
};

const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';
const INSTAGRAM_GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION ?? 'v25.0';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Looks up a customer's public Instagram profile after they have sent a DM.
 * The webhook contains only their Instagram-scoped ID; the profile endpoint
 * is the supported source for name, username, and short-lived profile photo.
 */
export async function getInstagramProfile(
  instagramScopedUserId: string,
  encryptedAccessToken: string | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<InstagramProfile | null> {
  if (!encryptedAccessToken) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(encryptedAccessToken);
  } catch {
    console.warn('[instagram profile] stored access token could not be decrypted');
    return null;
  }

  const url = new URL(
    `${INSTAGRAM_GRAPH_HOST}/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(instagramScopedUserId)}`
  );
  url.searchParams.set('fields', 'name,username,profile_pic');

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.warn('[instagram profile] lookup failed', { status: response.status });
      return null;
    }
    const body = (await response.json()) as InstagramProfileResponse;
    return {
      name: optionalText(body.name),
      username: optionalText(body.username),
      profilePictureUrl: optionalText(body.profile_pic),
    };
  } catch (error) {
    console.warn('[instagram profile] lookup request failed', {
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return null;
  }
}
