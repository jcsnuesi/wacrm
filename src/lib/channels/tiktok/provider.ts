import type {
  ChannelProvider,
  NormalizedInboundEvent,
  SendMessageInput,
  SendMessageResult,
} from '../provider';

/**
 * Explicit capability boundary for TikTok. It is registered in the provider
 * catalogue but cannot silently accept or send messages until the account has
 * the required TikTok API product and permissions.
 */
export class TikTokProvider implements ChannelProvider {
  readonly channel = 'tiktok' as const;

  parseWebhook(_payload: unknown, _channelAccountId: string): NormalizedInboundEvent[] {
    return [];
  }

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new Error('TikTok messaging is not enabled for this channel account');
  }
}
