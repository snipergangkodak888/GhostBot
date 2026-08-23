import { getDb } from "@/lib/db"

export const CHAT_PURPOSES = ["launches", "performance", "payroll", "reminders", "fees"] as const
export type ChatPurpose = typeof CHAT_PURPOSES[number]

export function normalizeChatPurpose(value: unknown): ChatPurpose | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (["launch", "launches", "calendar", "launchcalendar"].includes(normalized)) return "launches"
  if (["performance", "daily", "dailyupdate", "dailyupdates", "dailyperformance", "projectupdates", "stats"].includes(normalized)) return "performance"
  if (["payroll", "pay"].includes(normalized)) return "payroll"
  if (["reminder", "reminders"].includes(normalized)) return "reminders"
  if (["fee", "fees", "revenue", "feeinbox", "revenueinbox"].includes(normalized)) return "fees"
  return null
}

export function chatPurposeLabel(purpose: ChatPurpose) {
  return {
    launches: "Launch updates",
    performance: "Daily project updates",
    payroll: "Payroll updates",
    reminders: "Team reminders",
    fees: "Revenue and fee alerts",
  }[purpose]
}

export async function setChatSubscription(params: {
  chatId: number | string
  purpose: ChatPurpose
  active: boolean
  title?: string
  chatType?: string
  telegramId?: number | null
}) {
  const db = await getDb()
  const now = new Date()
  await db.collection("opsChatSubscriptions").updateOne(
    { chatId: String(params.chatId), purpose: params.purpose },
    {
      $set: {
        chatId: String(params.chatId),
        purpose: params.purpose,
        status: params.active ? "active" : "inactive",
        title: String(params.title || "").trim(),
        chatType: String(params.chatType || "").trim(),
        updatedByTelegramId: params.telegramId || null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
}

export async function listChatSubscriptions(chatId: number | string) {
  const db = await getDb()
  return db.collection("opsChatSubscriptions").find({ chatId: String(chatId), status: "active" }).toArray()
}

export async function getSubscribedChats(purpose: ChatPurpose) {
  const db = await getDb()
  const rows = await db.collection("opsChatSubscriptions").find({ purpose, status: "active" }).toArray()
  const unique = new Map<string, { chatId: number | string; kind: "direct" | "group"; label: string }>()
  for (const row of rows) {
    if (!row.chatId) continue
    unique.set(String(row.chatId), {
      chatId: row.chatId,
      kind: String(row.chatType || "").includes("group") || String(row.chatId).startsWith("-") ? "group" : "direct",
      label: String(row.title || row.chatId),
    })
  }
  return Array.from(unique.values())
}
