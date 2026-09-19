import type { SupabaseClient } from '@supabase/supabase-js';

import type { NormalizedInboundEvent } from './provider';

type ChannelAccount = { id: string; account_id: string };

/**
 * Writes a provider-normalized inbound event into the canonical model. This
 * path intentionally never creates a legacy `contacts` record: Customer 360
 * is the source of truth for social identities.
 */
export async function persistInboundEvent(
  supabase: SupabaseClient,
  event: NormalizedInboundEvent
): Promise<void> {
  const { data: channelAccount, error: accountError } = await supabase
    .from('channel_accounts')
    .select('id, account_id')
    .eq('id', event.channelAccountId)
    .maybeSingle();
  if (accountError || !channelAccount) {
    throw new Error('Connected channel account was not found');
  }
  const account = channelAccount as ChannelAccount;

  const { data: currentIdentity, error: identityError } = await supabase
    .from('contact_identities')
    .select('id, customer_id')
    .eq('account_id', account.account_id)
    .eq('channel', event.channel)
    .eq('channel_account_id', account.id)
    .eq('external_id', event.externalUserId)
    .maybeSingle();
  if (identityError) throw identityError;

  let customerId = currentIdentity?.customer_id as string | undefined;
  if (!customerId) {
    const customerQuery = supabase
      .from('customers')
      .select('id')
      .eq('account_id', account.account_id)
      .eq('status', 'active')
      .limit(1);
    const { data: matches, error: matchError } = event.email
      ? await customerQuery.ilike('email', event.email.trim())
      : event.phone
        ? await customerQuery.eq('phone', event.phone.trim())
        : { data: [], error: null };
    if (matchError) throw matchError;
    customerId = matches?.[0]?.id as string | undefined;
  }

  if (!customerId) {
    const { data: customer, error: createCustomerError } = await supabase
      .from('customers')
      .insert({
        account_id: account.account_id,
        display_name: event.displayName ?? event.username ?? null,
        phone: event.phone ?? null,
        email: event.email ?? null,
      })
      .select('id')
      .single();
    if (createCustomerError || !customer) throw createCustomerError;
    customerId = customer.id as string;
  }

  // Keep Customer 360 ordered by its actual latest activity. A social
  // customer may already exist while a fresh inbound message arrives; in
  // that case no customer row would otherwise be touched and the profile
  // could remain pages away from the top of the customer list.
  const { error: touchCustomerError } = await supabase
    .from('customers')
    .update({ updated_at: event.occurredAt })
    .eq('id', customerId)
    .eq('account_id', account.account_id);
  if (touchCustomerError) throw touchCustomerError;

  let identityId = currentIdentity?.id as string | undefined;
  if (identityId) {
    const { error } = await supabase
      .from('contact_identities')
      .update({
        customer_id: customerId,
        username: event.username ?? null,
        display_name: event.displayName ?? null,
        phone: event.phone ?? null,
        email: event.email ?? null,
        last_seen_at: event.occurredAt,
      })
      .eq('id', identityId);
    if (error) throw error;
  } else {
    const { data: identity, error } = await supabase
      .from('contact_identities')
      .insert({
        account_id: account.account_id,
        customer_id: customerId,
        channel_account_id: account.id,
        channel: event.channel,
        external_id: event.externalUserId,
        username: event.username ?? null,
        display_name: event.displayName ?? null,
        phone: event.phone ?? null,
        email: event.email ?? null,
        metadata: { provider_payload: event.rawPayload },
        first_seen_at: event.occurredAt,
        last_seen_at: event.occurredAt,
      })
      .select('id')
      .single();
    if (error || !identity) throw error;
    identityId = identity.id as string;
  }

  const externalConversationId = event.externalConversationId ?? event.externalUserId;
  const { data: existingConversation, error: findConversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('channel_account_id', account.id)
    .eq('external_conversation_id', externalConversationId)
    .maybeSingle();
  if (findConversationError) throw findConversationError;

  let conversationId = existingConversation?.id as string | undefined;
  if (!conversationId) {
    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert({
        account_id: account.account_id,
        customer_id: customerId,
        customer_identity_id: identityId,
        channel_account_id: account.id,
        external_conversation_id: externalConversationId,
        status: 'open',
        last_message_text: event.text ?? null,
        last_message_at: event.occurredAt,
        unread_count: 1,
        started_at: event.occurredAt,
      })
      .select('id')
      .single();
    if (error || !conversation) throw error;
    conversationId = conversation.id as string;
  } else {
    const { error } = await supabase
      .from('conversations')
      .update({
        customer_id: customerId,
        customer_identity_id: identityId,
        last_message_text: event.text ?? null,
        last_message_at: event.occurredAt,
      })
      .eq('id', conversationId);
    if (error) throw error;
  }

  const { data: previous, error: previousError } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('external_message_id', event.externalMessageId)
    .maybeSingle();
  if (previousError || previous) return;

  const { error: messageError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: event.messageType,
    content_text: event.text ?? null,
    media_url: event.media?.url ?? null,
    message_id: event.externalMessageId,
    external_message_id: event.externalMessageId,
    direction: 'INBOUND',
    sender_identity_id: identityId,
    metadata: { provider_payload: event.rawPayload },
    sent_at: event.occurredAt,
    status: 'sent',
  });
  if (messageError) throw messageError;
}
