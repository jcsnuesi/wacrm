import { after } from 'next/server';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  formParams,
  isValidTwilioRequest,
  stripWhatsAppPrefix,
} from '@/lib/whatsapp/twilio-webhook';

export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params = formParams(rawBody);
  if (!isValidTwilioRequest(request, params)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  after(() => processInbound(params));
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    }
  );
}

async function processInbound(params: Record<string, string>): Promise<void> {
  const messageSid = params.MessageSid || params.SmsMessageSid;
  if (!messageSid || !params.From || !params.To) return;

  const db = supabaseAdmin();
  const senderLine = stripWhatsAppPrefix(params.To);
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('id, account_id, user_id')
    .eq('provider', 'twilio')
    .eq('sender_phone', senderLine)
    .eq('status', 'connected')
    .maybeSingle();
  if (configError || !config) {
    console.error('[twilio-inbound] no connected line for:', senderLine);
    return;
  }

  const { data: duplicate } = await db
    .from('messages')
    .select('id')
    .eq('message_id', messageSid)
    .limit(1);
  if (duplicate?.length) return;

  const customerPhone = stripWhatsAppPrefix(params.From);
  let contact = await findExistingContact(db, config.account_id, customerPhone);
  let contactCreated = false;
  if (!contact) {
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        phone: customerPhone,
        name: params.ProfileName || customerPhone,
      })
      .select('*')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        contact = await findExistingContact(
          db,
          config.account_id,
          customerPhone
        );
      } else {
        console.error('[twilio-inbound] contact insert failed:', error.message);
        return;
      }
    } else {
      contact = created;
      contactCreated = true;
    }
  }
  if (!contact) return;

  const conversationResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contact.id,
    config.id
  );
  if (!conversationResult) return;

  if (conversationResult.created) {
    await dispatchWebhookEvent(db, config.account_id, 'conversation.created', {
      conversation_id: conversationResult.id,
      contact_id: contact.id,
    });
  }

  let replyToMessageId: string | null = null;
  if (params.OriginalRepliedMessageSid) {
    const { data: parent } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationResult.id)
      .eq('message_id', params.OriginalRepliedMessageSid)
      .maybeSingle();
    replyToMessageId = parent?.id ?? null;
  }

  const numMedia = Number(params.NumMedia || '0');
  const mime = params.MediaContentType0 || '';
  const interactiveReplyId = params.ButtonPayload || null;
  const contentType = interactiveReplyId
    ? 'interactive'
    : numMedia > 0
      ? mediaContentType(mime)
      : 'text';
  const contentText = params.ButtonText || params.Body || null;
  const providerMediaUrl = numMedia > 0 ? params.MediaUrl0 || null : null;
  const localMediaUrl = providerMediaUrl
    ? `/api/whatsapp/twilio/media/${encodeURIComponent(messageSid)}`
    : null;

  const { data: inserted, error: insertError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationResult.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: localMediaUrl,
      provider_media_url: providerMediaUrl,
      message_id: messageSid,
      status: 'delivered',
      interactive_reply_id: interactiveReplyId,
      reply_to_message_id: replyToMessageId,
    })
    .select('id, created_at')
    .single();
  if (insertError || !inserted) {
    if (!isUniqueViolation(insertError)) {
      console.error(
        '[twilio-inbound] message insert failed:',
        insertError?.message
      );
    }
    return;
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: inserted.created_at,
      updated_at: new Date().toISOString(),
      unread_count: conversationResult.unreadCount + 1,
    })
    .eq('id', conversationResult.id);

  await dispatchWebhookEvent(db, config.account_id, 'message.received', {
    conversation_id: conversationResult.id,
    contact_id: contact.id,
    whatsapp_message_id: messageSid,
    content_type: contentType,
    text: contentText,
    contact_created: contactCreated,
  });
}

function mediaContentType(
  mime: string
): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

async function findOrCreateConversation(
  accountId: string,
  userId: string,
  contactId: string,
  configId: string
): Promise<{ id: string; created: boolean; unreadCount: number } | null> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('conversations')
    .select('id, unread_count')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('whatsapp_config_id', configId)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id,
      created: false,
      unreadCount: existing.unread_count || 0,
    };
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      whatsapp_config_id: configId,
    })
    .select('id, unread_count')
    .single();
  if (!error && created) {
    return { id: created.id, created: true, unreadCount: 0 };
  }
  if (isUniqueViolation(error)) {
    const { data: winner } = await db
      .from('conversations')
      .select('id, unread_count')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('whatsapp_config_id', configId)
      .maybeSingle();
    if (winner) {
      return {
        id: winner.id,
        created: false,
        unreadCount: winner.unread_count || 0,
      };
    }
  }
  console.error('[twilio-inbound] conversation insert failed:', error?.message);
  return null;
}
