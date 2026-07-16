import { NextRequest, NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { withTelegramCapture, type TelegramCaptureCall } from "@/lib/telegram-bot"
import { POST as handleTelegramWebhook } from "@/app/api/telegram/webhook/route"

export const dynamic = "force-dynamic"

const DEFAULT_TELEGRAM_ID = 990_000_001
const DEFAULT_CHAT_ID = 990_000_001

function isLabAvailable(req: NextRequest) {
  const appEnv = String(process.env.APP_ENV || "development").toLowerCase()
  const hostname = new URL(req.url).hostname
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
  return process.env.NODE_ENV !== "production" && appEnv !== "production" && isLocalhost
}

function unavailable() {
  return NextResponse.json({
    ok: false,
    error: "Telegram Bot Lab is available only from localhost while running Next.js in development mode.",
  }, { status: 403 })
}

function messageUpdate(params: {
  text: string
  telegramId: number
  chatId: number
  chatType: "private" | "group" | "supergroup"
  username: string
  firstName: string
  messageId: number
}) {
  const isGroup = params.chatType !== "private"
  return {
    update_id: Date.now(),
    message: {
      message_id: params.messageId,
      date: Math.floor(Date.now() / 1000),
      from: {
        id: params.telegramId,
        is_bot: false,
        first_name: params.firstName,
        username: params.username,
        language_code: "en",
      },
      chat: isGroup
        ? { id: params.chatId, type: params.chatType, title: "GhostBot Local Lab" }
        : { id: params.chatId, type: "private", first_name: params.firstName, username: params.username },
      text: params.text,
      entities: params.text.startsWith("/")
        ? [{ offset: 0, length: params.text.split(/\s/, 1)[0].length, type: "bot_command" }]
        : [],
    },
  }
}

function callbackUpdate(params: {
  callbackData: string
  telegramId: number
  chatId: number
  chatType: "private" | "group" | "supergroup"
  username: string
  firstName: string
  messageId: number
}) {
  const isGroup = params.chatType !== "private"
  return {
    update_id: Date.now(),
    callback_query: {
      id: `lab-${Date.now()}`,
      from: {
        id: params.telegramId,
        is_bot: false,
        first_name: params.firstName,
        username: params.username,
        language_code: "en",
      },
      message: {
        message_id: params.messageId,
        date: Math.floor(Date.now() / 1000),
        chat: isGroup
          ? { id: params.chatId, type: params.chatType, title: "GhostBot Local Lab" }
          : { id: params.chatId, type: "private", first_name: params.firstName, username: params.username },
        text: "Bot Lab callback source",
      },
      data: params.callbackData,
    },
  }
}

function visibleMessages(calls: TelegramCaptureCall[]) {
  const messages = new Map<number, Record<string, any>>()
  const attachments: Record<string, any>[] = []

  for (const call of calls) {
    if (call.method === "sendMessage" && call.messageId) {
      messages.set(call.messageId, {
        messageId: call.messageId,
        type: "text",
        text: String(call.body.text || ""),
        parseMode: call.body.parse_mode,
        replyMarkup: call.body.reply_markup,
      })
    } else if (call.method === "editMessageText") {
      const messageId = Number(call.body.message_id || call.messageId || 0)
      const previous = messages.get(messageId) || { messageId, type: "text" }
      messages.set(messageId, {
        ...previous,
        text: String(call.body.text || ""),
        parseMode: call.body.parse_mode,
        replyMarkup: call.body.reply_markup || previous.replyMarkup,
      })
    } else if (call.method === "deleteMessage") {
      messages.delete(Number(call.body.message_id || 0))
    } else if (call.method === "sendPhoto" || call.method === "sendDocument") {
      attachments.push({
        type: call.method === "sendPhoto" ? "photo" : "document",
        text: String(call.body.caption || ""),
        filename: call.body.filename,
        byteLength: call.body.byte_length,
      })
    }
  }

  return [...Array.from(messages.values()), ...attachments]
}

export async function POST(req: NextRequest) {
  if (!isLabAvailable(req)) return unavailable()

  const body = await req.json().catch(() => ({}))
  const text = String(body.text || "").trim()
  const callbackData = String(body.callbackData || "").trim()
  if (!text && !callbackData) {
    return NextResponse.json({ ok: false, error: "Provide text or callbackData." }, { status: 400 })
  }

  const telegramId = Number(body.telegramId || DEFAULT_TELEGRAM_ID)
  const requestedChatId = Number(body.chatId || DEFAULT_CHAT_ID)
  const requestedChatType = String(body.chatType || "private")
  const chatType = (["private", "group", "supergroup"].includes(requestedChatType)
    ? requestedChatType
    : "private") as "private" | "group" | "supergroup"
  const chatId = chatType === "private" ? Math.abs(requestedChatId) : -Math.abs(requestedChatId)
  const username = String(body.username || "ghostbot_lab")
  const firstName = String(body.firstName || "Bot Lab")
  const messageId = Number(body.messageId || Date.now() % 1_000_000)
  const update = callbackData
    ? callbackUpdate({ callbackData, telegramId, chatId, chatType, username, firstName, messageId })
    : messageUpdate({ text, telegramId, chatId, chatType, username, firstName, messageId })

  const captured = await withTelegramCapture(async () => {
    const webhookRequest = new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    })
    const response = await handleTelegramWebhook(webhookRequest)
    return { status: response.status, body: await response.json().catch(() => ({})) }
  })

  return NextResponse.json({
    ok: captured.result.status >= 200 && captured.result.status < 300,
    update,
    webhook: captured.result,
    messages: visibleMessages(captured.calls),
    calls: captured.calls,
  }, { status: captured.result.status })
}

export async function DELETE(req: NextRequest) {
  if (!isLabAvailable(req)) return unavailable()

  const telegramId = Number(new URL(req.url).searchParams.get("telegramId") || DEFAULT_TELEGRAM_ID)
  const db = await getDb()
  const [states, logs, actions] = await Promise.all([
    db.collection("opsBotStates").deleteMany({ telegramId }),
    db.collection("opsBotLogs").deleteMany({ telegramId }),
    db.collection("opsAiActions").deleteMany({ telegramId }),
  ])
  return NextResponse.json({
    ok: true,
    telegramId,
    deleted: states.deletedCount + logs.deletedCount + actions.deletedCount,
    note: "Conversation state was reset. Data changes made by confirmed bot actions were not reverted.",
  })
}
