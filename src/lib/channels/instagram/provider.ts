import type {
  ChannelProvider,
  NormalizedInboundEvent,
  SendMessageInput,
  SendMessageResult,
} from '../provider';
import { parseMetaMessengerWebhook } from '../meta-messenger';

export class InstagramProvider implements ChannelProvider {
  readonly channel = 'instagram' as const;

  constructor(
    private readonly send: (input: SendMessageInput) => Promise<SendMessageResult>
  ) {}

  parseWebhook(payload: unknown, channelAccountId: string): NormalizedInboundEvent[] {
    return parseMetaMessengerWebhook(this.channel, payload, channelAccountId);
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.send(input);
  }
}
