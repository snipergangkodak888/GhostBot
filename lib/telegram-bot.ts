import { getDb } from "@/lib/db"

const TELEGRAM_API = "https://api.telegram.org"

export async function getTelegramBotToken() {
  const db = await getDb()
  const settingsRow = await db.collection("settings").findOne({ key: "telegramBotToken" }).catch(() => null)
  return String(settingsRow?.value || process.env.TELEGRAM_BOT_TOKEN || "").trim()
}

let cachedBotUsername = ""

export async function getTelegramBotUsername() {
  if (cachedBotUsername) return cachedBotUsername
  const envUsername = String(process.env.NEXT_PUBLIC_BOT_USERNAME || "").trim().replace(/^@/, "")
  if (envUsername) {
    cachedBotUsername = envUsername.toLowerCase()
    return cachedBotUsername
  }
  const db = await getDb()
  const settingsRow = await db.collection("settings").findOne({ key: "telegramBotUsername" }).catch(() => null)
  cachedBotUsername = String(settingsRow?.value || "").trim().replace(/^@/, "").toLowerCase()
  return cachedBotUsername
}

export async function telegramApi(token: string, method: string, body: Record<string, any>) {
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
}

export async function telegramApiJson(token: string, method: string, body: Record<string, any>) {
  const response = await telegramApi(token, method, body)
  if (!response?.ok) return null
  return response.json().catch(() => null)
}

export type TelegramMessageOptions = {
  parseMode?: "HTML"
  replyMarkup?: Record<string, any>
  disableWebPagePreview?: boolean
}

export async function sendChatAction(token: string, chatId: number | string, action = "typing") {
  await telegramApi(token, "sendChatAction", { chat_id: chatId, action })
}

export async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  text: string,
  options: TelegramMessageOptions = {},
): Promise<number | null> {
  const payload = await telegramApiJson(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  })
  if (!payload?.ok) return null
  return payload.result?.message_id ?? null
}

export async function editTelegramMessage(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  options: TelegramMessageOptions = {},
) {
  const payload = await telegramApiJson(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  })
  return payload?.ok === true
}

export async function withTelegramLoading(
  token: string,
  chatId: number | string,
  params: {
    loadingText?: string
    delayMs?: number
    work: () => Promise<{ text: string; parseMode?: "HTML"; replyMarkup?: Record<string, any> }>
  },
) {
  const loadingText = params.loadingText || "⏳ One moment…"
  const delayMs = params.delayMs ?? 700

  void sendChatAction(token, chatId)
  const typingTimer = setInterval(() => void sendChatAction(token, chatId), 4000)

  let loadingMessagePromise: Promise<number | null> | null = null
  const loadingTimer = setTimeout(() => {
    loadingMessagePromise = sendTelegramMessage(token, chatId, loadingText)
  }, delayMs)

  const deliver = async (result: { text: string; parseMode?: "HTML"; replyMarkup?: Record<string, any> }) => {
    clearInterval(typingTimer)
    clearTimeout(loadingTimer)

    const loadingMessageId = loadingMessagePromise ? await loadingMessagePromise : null
    const options = {
      parseMode: result.parseMode,
      replyMarkup: result.replyMarkup,
    }

    if (loadingMessageId) {
      const edited = await editTelegramMessage(token, chatId, loadingMessageId, result.text, options)
      if (!edited) await sendTelegramMessage(token, chatId, result.text, options)
      return
    }

    await sendTelegramMessage(token, chatId, result.text, options)
  }

  try {
    await deliver(await params.work())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong."
    await deliver({ text: `⚠️ ${message}` })
  }
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
