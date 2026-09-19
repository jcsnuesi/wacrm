import type { Channel } from './types';

export interface NormalizedInboundEvent {
  channel: Channel;
  channelAccountId: string;
  externalUserId: string;
  externalConversationId?: string | null;
  externalMessageId: string;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  messageType: string;
  text?: string | null;
  media?: { url?: string | null; mimeType?: string | null } | null;
  rawPayload: unknown;
  occurredAt: string;
}

export interface SendMessageInput {
  channelAccountId: string;
  recipientExternalUserId: string;
  text: string;
}

export interface SendMessageResult {
  externalMessageId: string;
  sentAt: string;
}

export interface ChannelProvider {
  readonly channel: Channel;
  parseWebhook(
    payload: unknown,
    channelAccountId: string
  ): NormalizedInboundEvent[];
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
