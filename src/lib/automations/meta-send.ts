import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive"
import { sendMessageToConversation } from "@/lib/whatsapp/send-message"

import { supabaseAdmin } from "./admin-client"

interface CommonSendArgs {
  accountId: string
  /** Retained for call-site compatibility and audit context. */
  userId: string
  conversationId: string
  contactId: string
}

interface SendTextArgs extends CommonSendArgs {
  text: string
}

interface SendTemplateArgs extends CommonSendArgs {
  templateName: string
  language?: string
  params?: string[]
}

interface SendInteractiveArgs extends CommonSendArgs {
  payload: InteractiveMessagePayload
}

export interface AutomationSendResult {
  whatsapp_message_id: string
  provider: "meta" | "twilio"
}

/**
 * Automation sends use the same conversation-pinned provider dispatcher as
 * manual inbox sends. This guarantees a Twilio conversation never falls
 * through to Graph API and a Meta conversation keeps its phone retry logic.
 */
export async function engineSendText(
  args: SendTextArgs
): Promise<AutomationSendResult> {
  const result = await sendMessageToConversation(
    supabaseAdmin(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: "text",
      contentText: args.text,
      senderType: "bot",
    }
  )
  return {
    whatsapp_message_id: result.whatsappMessageId,
    provider: result.provider,
  }
}

export async function engineSendInteractive(
  args: SendInteractiveArgs
): Promise<AutomationSendResult> {
  const result = await sendMessageToConversation(
    supabaseAdmin(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: "interactive",
      interactivePayload: args.payload,
      senderType: "bot",
    }
  )
  return {
    whatsapp_message_id: result.whatsappMessageId,
    provider: result.provider,
  }
}

export async function engineSendTemplate(
  args: SendTemplateArgs
): Promise<AutomationSendResult> {
  const result = await sendMessageToConversation(
    supabaseAdmin(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: "template",
      templateName: args.templateName,
      templateLanguage: args.language,
      templateParams: args.params,
      senderType: "bot",
    }
  )
  return {
    whatsapp_message_id: result.whatsappMessageId,
    provider: result.provider,
  }
}
