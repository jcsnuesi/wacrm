import { createClient } from '@supabase/supabase-js';

import { persistInboundEvent } from './inbound-persistence';
import { getInstagramProfile } from './instagram/profile';
import { sendInstagramText } from './instagram/send';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchInboundToAiPipeline } from '@/lib/ai/pipeline-routing';
import type { ChannelProvider } from './provider';
import type { Channel } from './types';

type MetaEntry = { id?: string };
type MetaPayload = { entry?: MetaEntry[] };
type ConnectedChannelAccount = {
  id: string;
  account_id: string;
  external_account_id: string;
  access_token_encrypted: string | null;
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Process each receiver entry against only its matching connected account. */
export async function processMetaWebhook(
  channel: Channel,
  provider: ChannelProvider,
  payload: unknown
): Promise<void> {
  const body = payload as MetaPayload;
  for (const entry of body.entry ?? []) {
    const externalAccountId = entry.id?.trim();
    if (!externalAccountId) continue;
    const supabase = adminClient();
    const { data: channelAccount, error } = await supabase
      .from('channel_accounts')
      .select('id, account_id, external_account_id, access_token_encrypted')
      .eq('channel', channel)
      .eq('external_account_id', externalAccountId)
      .eq('status', 'connected')
      .maybeSingle();
    if (error) throw error;
    if (!channelAccount) {
      console.warn(
        `[${channel} webhook] no connected account for receiver`,
        externalAccountId
      );
      continue;
    }
    const connectedAccount = channelAccount as ConnectedChannelAccount;
    const events = provider.parseWebhook(
      { entry: [entry] },
      connectedAccount.id
    );
    const profiles = new Map<
      string,
      Awaited<ReturnType<typeof getInstagramProfile>>
    >();
    for (const event of events) {
      if (channel === 'instagram') {
        let profile = profiles.get(event.externalUserId);
        if (profile === undefined) {
          profile = await getInstagramProfile(
            event.externalUserId,
            connectedAccount.access_token_encrypted
          );
          profiles.set(event.externalUserId, profile);
        }
        if (profile) {
          event.username = profile.username ?? event.username ?? null;
          event.displayName = profile.name ?? event.displayName ?? null;
          event.profilePictureUrl = profile.profilePictureUrl;
        }
      }
      const persisted = await persistInboundEvent(supabase, event);
      if (persisted.inserted) {
        await dispatchInboundToAiPipeline({
          accountId: connectedAccount.account_id,
          conversationId: persisted.conversationId,
          customerId: persisted.customerId,
          sourceMessageId: persisted.messageId,
        });
      }
      if (
        channel !== 'instagram' ||
        !persisted.inserted ||
        !event.text?.trim()
      ) {
        continue;
      }

      // Social conversations belong to the same workspace as WhatsApp, so
      // this reuses the exact AI configuration, knowledge base, handoff and
      // reply caps. Only the outbound transport differs.
      await dispatchInboundToAiReply({
        accountId: connectedAccount.account_id,
        conversationId: persisted.conversationId,
        sendText: async (text) => {
          const { externalMessageId } = await sendInstagramText({
            instagramAccountId: connectedAccount.external_account_id,
            recipientInstagramScopedId: event.externalUserId,
            encryptedAccessToken: connectedAccount.access_token_encrypted,
            text,
          });
          const sentAt = new Date().toISOString();
          const { error: messageError } = await supabase
            .from('messages')
            .insert({
              conversation_id: persisted.conversationId,
              sender_type: 'bot',
              content_type: 'text',
              content_text: text,
              message_id: externalMessageId,
              external_message_id: externalMessageId,
              direction: 'OUTBOUND',
              status: 'sent',
              sent_at: sentAt,
              ai_generated: true,
            });
          if (messageError) throw messageError;
          const { error: conversationError } = await supabase
            .from('conversations')
            .update({ last_message_text: text, last_message_at: sentAt })
            .eq('id', persisted.conversationId);
          if (conversationError) throw conversationError;
        },
      });
    }
  }
}
