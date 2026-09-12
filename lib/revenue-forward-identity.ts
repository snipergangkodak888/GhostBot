import { createHash } from "node:crypto"

// Telegram usually hides the source client chat. Origin metadata identifies a
// repeated forward; it must never be used to infer the project.
export function forwardOriginIdentity(message: any) {
  const origin = message?.forward_origin
  if (origin?.type === "channel") return `channel:${origin.chat?.id}:${origin.message_id}`
  if (origin?.type === "chat") return `chat:${origin.sender_chat?.id}`
  if (origin?.type === "user") return `user:${origin.sender_user?.id}`
  if (origin?.type === "hidden_user") return `hidden:${origin.sender_user_name}`
  if (message?.forward_from_chat?.id) return `chat:${message.forward_from_chat.id}:${message.forward_from_message_id || ""}`
  if (message?.forward_from?.id) return `user:${message.forward_from.id}`
  if (message?.forward_sender_name) return `hidden:${message.forward_sender_name}`
  return ""
}

export function normalizedForwardText(text: string) {
  // Preserve case: Solana addresses and transaction signatures are case-sensitive.
  return String(text || "").trim().replace(/\s+/g, " ")
}

export function forwardedFeeIdentity(params: { chatId: number | string; messageId: number; text: string; messageDate?: Date; originIdentity?: string }) {
  const hasOriginalDate = params.messageDate && Number.isFinite(params.messageDate.getTime())
  const identity = hasOriginalDate
    ? [String(params.chatId), params.originIdentity || "unknown", params.messageDate!.toISOString(), normalizedForwardText(params.text)]
    : [String(params.chatId), String(params.messageId)]
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}
