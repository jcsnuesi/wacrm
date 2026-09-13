import type { ChannelProvider, NormalizedInboundEvent } from './provider';
import type { Channel } from './types';

type MetaAttachment = { type?: string; payload?: { url?: string } };
type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MetaAttachment[];
  };
};

type MetaMessengerPayload = {
  entry?: Array<{ messaging?: MetaMessagingEvent[] }>;
};

/**
 * Normalizes the shared Messenger webhook envelope used by Facebook Pages
 * and Instagram Messaging. Echoes are deliberately omitted: outbound writes
 * are recorded by the send path, so persisting them here would duplicate rows.
 */
export function parseMetaMessengerWebhook(
  channel: Channel,
  payload: unknown,
  channelAccountId: string
): NormalizedInboundEvent[] {
  const body = payload as MetaMessengerPayload;
  const events: NormalizedInboundEvent[] = [];

  for (const entry of body.entry ?? []) {
    for (const item of entry.messaging ?? []) {
      const externalUserId = item.sender?.id?.trim();
      const externalMessageId = item.message?.mid?.trim();
      if (!externalUserId || !externalMessageId || item.message?.is_echo) continue;

      const attachment = item.message?.attachments?.[0];
      const occurredAt = item.timestamp
        ? new Date(item.timestamp).toISOString()
        : new Date().toISOString();
      events.push({
        channel,
        channelAccountId,
        externalUserId,
        // Messenger does not expose a durable thread id in every inbound
        // event. The sender id is a stable direct-message thread key.
        externalConversationId: externalUserId,
        externalMessageId,
        messageType: attachment?.type ?? 'text',
        text: item.message?.text ?? null,
        media: attachment
          ? { url: attachment.payload?.url ?? null, mimeType: null }
          : null,
        rawPayload: item,
        occurredAt,
      });
    }
  }
  return events;
}

export function isMetaMessengerProvider(
  provider: ChannelProvider
): provider is ChannelProvider {
  return provider.channel === 'instagram' || provider.channel === 'facebook';
}
