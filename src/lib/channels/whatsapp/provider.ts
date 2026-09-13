import type {
  ChannelProvider,
  NormalizedInboundEvent,
  SendMessageInput,
  SendMessageResult,
} from '../provider';

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: MetaMessage[];
      };
    }>;
  }>;
};

/**
 * Incremental adapter: normalizes Meta payloads while the existing webhook
 * remains responsible for verification, persistence, and sends.
 */
export class WhatsAppProvider implements ChannelProvider {
  readonly channel = 'whatsapp' as const;

  constructor(
    private readonly send: (
      input: SendMessageInput
    ) => Promise<SendMessageResult>
  ) {}

  parseWebhook(
    payload: unknown,
    channelAccountId: string
  ): NormalizedInboundEvent[] {
    const body = payload as MetaWebhookPayload;
    const events: NormalizedInboundEvent[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const message of value?.messages ?? []) {
          const externalUserId = message.from?.trim();
          const externalMessageId = message.id?.trim();
          if (!externalUserId || !externalMessageId) continue;
          const contact = value?.contacts?.find(
            (item) => item.wa_id === externalUserId
          );
          const occurredAt = message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
            : new Date().toISOString();
          events.push({
            channel: this.channel,
            channelAccountId,
            externalUserId,
            externalMessageId,
            phone: /^\d+$/.test(externalUserId) ? externalUserId : null,
            displayName: contact?.profile?.name ?? null,
            messageType: message.type ?? 'unknown',
            text: message.text?.body ?? null,
            media: null,
            rawPayload: message,
            occurredAt,
          });
        }
      }
    }
    return events;
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.send(input);
  }
}
