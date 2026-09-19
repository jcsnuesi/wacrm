import { decrypt } from '@/lib/whatsapp/encryption';

const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';
const INSTAGRAM_GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION ?? 'v25.0';

type InstagramSendResponse = { message_id?: unknown };

/** Send a text reply from a connected Instagram professional account. */
export async function sendInstagramText(args: {
  instagramAccountId: string;
  recipientInstagramScopedId: string;
  encryptedAccessToken: string | null | undefined;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<{ externalMessageId: string }> {
  if (!args.encryptedAccessToken) {
    throw new Error('Instagram access token is missing. Reconnect the channel.');
  }
  const accessToken = decrypt(args.encryptedAccessToken);
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${INSTAGRAM_GRAPH_HOST}/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(args.instagramAccountId)}/messages`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: args.recipientInstagramScopedId },
      message: { text: args.text },
    }),
  });
  const data = (await response.json().catch(() => null)) as InstagramSendResponse | null;
  if (!response.ok || typeof data?.message_id !== 'string' || !data.message_id) {
    throw new Error(`Instagram send failed (HTTP ${response.status}).`);
  }
  return { externalMessageId: data.message_id };
}
