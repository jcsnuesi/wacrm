import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  db: { kind: "service-role" },
  send: vi.fn(),
}))

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => h.db,
}))

vi.mock("@/lib/whatsapp/send-message", () => ({
  sendMessageToConversation: h.send,
}))

import { engineSendInteractive, engineSendText } from "./meta-send"

describe("provider-aware automation sends", () => {
  beforeEach(() => {
    h.send.mockReset()
    h.send.mockResolvedValue({
      messageId: "local-1",
      whatsappMessageId: "SM123",
      provider: "twilio",
    })
  })

  it("dispatches text through the conversation-pinned provider as bot", async () => {
    const result = await engineSendText({
      accountId: "account-1",
      userId: "user-1",
      conversationId: "conversation-1",
      contactId: "contact-1",
      text: "Hello",
    })

    expect(h.send).toHaveBeenCalledWith(h.db, "account-1", {
      conversationId: "conversation-1",
      messageType: "text",
      contentText: "Hello",
      senderType: "bot",
    })
    expect(result).toEqual({
      whatsapp_message_id: "SM123",
      provider: "twilio",
    })
  })

  it("passes an interactive payload without selecting Meta directly", async () => {
    const payload = {
      kind: "buttons" as const,
      body: "Choose",
      buttons: [{ id: "one", title: "One" }],
    }

    await engineSendInteractive({
      accountId: "account-1",
      userId: "user-1",
      conversationId: "conversation-1",
      contactId: "contact-1",
      payload,
    })

    expect(h.send).toHaveBeenCalledWith(h.db, "account-1", {
      conversationId: "conversation-1",
      messageType: "interactive",
      interactivePayload: payload,
      senderType: "bot",
    })
  })
})
