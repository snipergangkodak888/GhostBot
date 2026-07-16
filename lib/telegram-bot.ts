import { AsyncLocalStorage } from "node:async_hooks"
import { getDb } from "@/lib/db"

const TELEGRAM_API = "https://api.telegram.org"

export type TelegramCaptureCall = {
  method: string
  body: Record<string, any>
  messageId?: number
  createdAt: string
}

type TelegramCaptureSession = {
  calls: TelegramCaptureCall[]
  nextMessageId: number
}

const telegramCapture = new AsyncLocalStorage<TelegramCaptureSession>()

export function isTelegramCaptureActive() {
  return Boolean(telegramCapture.getStore())
}

export async function withTelegramCapture<T>(work: () => Promise<T>) {
  const session: TelegramCaptureSession = { calls: [], nextMessageId: 1 }
  const result = await telegramCapture.run(session, work)
  return { result, calls: session.calls }
}

function captureTelegramCall(method: string, body: Record<string, any>, messageId?: number) {
  const session = telegramCapture.getStore()
  if (!session) return false
  session.calls.push({ method, body, ...(messageId ? { messageId } : {}), createdAt: new Date().toISOString() })
  return true
}

function capturedTelegramResponse(method: string, body: Record<string, any>) {
  const session = telegramCapture.getStore()
  if (!session) return null

  const createsMessage = method === "sendMessage"
  const messageId = createsMessage ? session.nextMessageId++ : Number(body.message_id || 0) || undefined
  captureTelegramCall(method, body, messageId)

  const result = createsMessage
    ? { message_id: messageId, chat: { id: body.chat_id }, text: body.text || "" }
    : true
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

export async function getTelegramBotToken() {
  if (isTelegramCaptureActive()) return "ghostbot-local-lab-token"
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
  const captured = capturedTelegramResponse(method, body)
  if (captured) return captured
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error) => {
    console.error(`[telegram] ${method} network error:`, error instanceof Error ? error.message : error)
    return null
  })
  return response
}

export async function telegramApiJson(token: string, method: string, body: Record<string, any>) {
  const response = await telegramApi(token, method, body)
  if (!response?.ok) {
    const detail = await response?.text().catch(() => response?.statusText || "unknown error")
    console.error(`[telegram] ${method} failed (${response?.status || "no response"}):`, detail)
    return null
  }
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

function inlineReplyMarkup(replyMarkup?: Record<string, any>) {
  if (replyMarkup?.inline_keyboard) return { inline_keyboard: replyMarkup.inline_keyboard }
  return undefined
}

function plainTelegramText(text: string) {
  return text
    .replace(/<\/?(b|strong|i|em|u|s|code|pre|a)\b[^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()
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
    const sendOptions = {
      parseMode: result.parseMode,
      replyMarkup: result.replyMarkup,
    }
    const editOptions = {
      parseMode: result.parseMode,
      replyMarkup: inlineReplyMarkup(result.replyMarkup),
    }

    if (loadingMessageId) {
      let edited = await editTelegramMessage(token, chatId, loadingMessageId, result.text, editOptions)
      if (!edited && result.parseMode === "HTML") {
        edited = await editTelegramMessage(token, chatId, loadingMessageId, plainTelegramText(result.text))
      }
      if (edited) return

      let sent = await sendTelegramMessage(token, chatId, result.text, sendOptions)
      if (!sent && result.parseMode === "HTML") {
        sent = await sendTelegramMessage(token, chatId, plainTelegramText(result.text), {
          replyMarkup: result.replyMarkup,
        })
      }
      if (!sent) {
        console.error("[telegram] failed to deliver response after loading message", { chatId, loadingMessageId })
      }
      return
    }

    let sent = await sendTelegramMessage(token, chatId, result.text, sendOptions)
    if (!sent && result.parseMode === "HTML") {
      sent = await sendTelegramMessage(token, chatId, plainTelegramText(result.text), {
        replyMarkup: result.replyMarkup,
      })
    }
    if (!sent) {
      console.error("[telegram] failed to deliver response", { chatId })
    }
  }

  try {
    await deliver(await params.work())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong."
    console.error("[telegram] async response failed:", error)
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

export async function sendTelegramPhoto(
  token: string,
  chatId: number | string,
  png: Buffer,
  caption?: string,
) {
  if (isTelegramCaptureActive()) {
    captureTelegramCall("sendPhoto", {
      chat_id: chatId,
      caption: caption || "",
      filename: "ghost-payroll-report.png",
      byte_length: png.byteLength,
    })
    return true
  }
  const form = new FormData()
  form.append("chat_id", String(chatId))
  form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "ghost-payroll-report.png")
  if (caption) form.append("caption", caption.slice(0, 1024))

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  }).catch((error) => {
    console.error("[telegram] sendPhoto network error:", error instanceof Error ? error.message : error)
    return null
  })

  if (!response?.ok) {
    const detail = await response?.text().catch(() => response?.statusText || "unknown error")
    console.error(`[telegram] sendPhoto failed (${response?.status || "no response"}):`, detail)
    return false
  }
  return true
}

export async function sendTelegramDocument(
  token: string,
  chatId: number | string,
  png: Buffer,
  caption?: string,
  filename = "ghost-payroll-report.png",
) {
  if (isTelegramCaptureActive()) {
    captureTelegramCall("sendDocument", {
      chat_id: chatId,
      caption: caption || "",
      filename,
      byte_length: png.byteLength,
    })
    return true
  }
  const form = new FormData()
  form.append("chat_id", String(chatId))
  form.append("document", new Blob([new Uint8Array(png)], { type: "image/png" }), filename)
  if (caption) form.append("caption", caption.slice(0, 1024))

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  }).catch((error) => {
    console.error("[telegram] sendDocument network error:", error instanceof Error ? error.message : error)
    return null
  })

  if (!response?.ok) {
    const detail = await response?.text().catch(() => response?.statusText || "unknown error")
    console.error(`[telegram] sendDocument failed (${response?.status || "no response"}):`, detail)
    return false
  }
  return true
}
