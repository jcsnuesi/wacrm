import { createClient } from '@supabase/supabase-js';

import { persistInboundEvent } from './inbound-persistence';
import type { ChannelProvider } from './provider';
import type { Channel } from './types';

type MetaEntry = { id?: string };
type MetaPayload = { entry?: MetaEntry[] };

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
      .select('id')
      .eq('channel', channel)
      .eq('external_account_id', externalAccountId)
      .eq('status', 'connected')
      .maybeSingle();
    if (error) throw error;
    if (!channelAccount) {
      console.warn(`[${channel} webhook] no connected account for receiver`, externalAccountId);
      continue;
    }
    const events = provider.parseWebhook({ entry: [entry] }, channelAccount.id);
    for (const event of events) await persistInboundEvent(supabase, event);
  }
}
