import { getDb } from "@/lib/db"

const TELEGRAM_API = "https://api.telegram.org"

export async function getTelegramBotToken() {
  const db = await getDb()
  const settingsRow = await db.collection("settings").findOne({ key: "telegramBotToken" }).catch(() => null)
  return String(settingsRow?.value || process.env.TELEGRAM_BOT_TOKEN || "").trim()
}

export async function telegramApi(token: string, method: string, body: Record<string, any>) {
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
}

export async function sendTelegramText(token: string, chatId: number | string, text: string, replyMarkup?: Record<string, any>) {
  const response = await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
  if (!response?.ok) return false
  const payload = await response.json().catch(() => null)
  return payload?.ok !== false
}
