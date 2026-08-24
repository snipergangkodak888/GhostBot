import { getDb } from "@/lib/db"

export const CHAT_PURPOSES = ["launches", "performance", "finance", "payroll", "reminders", "fees"] as const
export type ChatPurpose = typeof CHAT_PURPOSES[number]

export const CHAT_PROFILES = ["launch", "trade", "fee", "finance", "management"] as const
export type ChatProfile = typeof CHAT_PROFILES[number]

const PROFILE_DEFAULT_NOTIFICATIONS: Record<ChatProfile, ChatPurpose[]> = {
  launch: ["launches"],
  trade: [],
  fee: ["fees"],
  finance: [],
  management: [],
}

const PROFILE_ALLOWED_NOTIFICATIONS: Record<ChatProfile, ChatPurpose[]> = {
  launch: ["launches"],
  trade: [],
  fee: ["fees"],
  finance: [],
  management: [],
}

export function normalizeChatPurpose(value: unknown): ChatPurpose | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (["launch", "launches", "calendar", "launchcalendar"].includes(normalized)) return "launches"
  if (["performance", "daily", "dailyupdate", "dailyupdates", "dailyperformance", "projectupdates", "stats", "trade", "tradefloor"].includes(normalized)) return null
  if (["finance", "financesummary", "financial", "financials"].includes(normalized)) return "finance"
  if (["payroll", "pay"].includes(normalized)) return "payroll"
  if (["reminder", "reminders"].includes(normalized)) return "reminders"
  if (["fee", "fees", "revenue", "feeinbox", "revenueinbox"].includes(normalized)) return "fees"
  return null
}

export function chatPurposeLabel(purpose: ChatPurpose) {
  return {
    launches: "Launch updates",
    performance: "Legacy daily project updates",
    finance: "Daily finance summary",
    payroll: "Payroll updates",
    reminders: "Team reminders",
    fees: "Revenue and fee alerts",
  }[purpose]
}

export function normalizeChatProfile(value: unknown): ChatProfile | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (["launch", "launchchat", "launches"].includes(normalized)) return "launch"
  if (["trade", "tradefloor", "trading"].includes(normalized)) return "trade"
  if (["fee", "fees", "feeinbox"].includes(normalized)) return "fee"
  if (["finance", "financechat"].includes(normalized)) return "finance"
  if (["management", "managementchat", "admin", "admins"].includes(normalized)) return "management"
  return null
}

export function chatProfileLabel(profile: ChatProfile) {
  return {
    launch: "Launch Chat",
    trade: "Trade Floor",
    fee: "Fee Inbox",
    finance: "Finance Chat",
    management: "Management Chat",
  }[profile]
}

export function defaultNotificationsForProfile(profile: ChatProfile) {
  return [...PROFILE_DEFAULT_NOTIFICATIONS[profile]]
}

export function notificationAllowedForProfile(profile: ChatProfile, purpose: ChatPurpose) {
  return PROFILE_ALLOWED_NOTIFICATIONS[profile].includes(purpose)
}

export async function setChatProfile(params: {
  chatId: number | string
  profile: ChatProfile
  title?: string
  chatType?: string
  telegramId: number
}) {
  const db = await getDb()
  const now = new Date()
  const previous = await db.collection("opsChatProfiles").findOne({ chatId: String(params.chatId) })
  await db.collection("opsChatProfiles").updateOne(
    { chatId: String(params.chatId) },
    {
      $set: {
        chatId: String(params.chatId),
        profile: params.profile,
        title: String(params.title || "").trim(),
        chatType: String(params.chatType || "").trim(),
        status: "active",
        updatedByTelegramId: params.telegramId,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

  const defaults = PROFILE_DEFAULT_NOTIFICATIONS[params.profile]
  for (const purpose of CHAT_PURPOSES) {
    await setChatSubscription({
      chatId: params.chatId,
      purpose,
      active: defaults.includes(purpose),
      title: params.title,
      chatType: params.chatType,
      telegramId: params.telegramId,
    })
  }
  await db.collection("opsPermissionAudit").insertOne({
    action: "set_chat_profile",
    chatId: String(params.chatId),
    previousProfile: previous?.profile || null,
    profile: params.profile,
    defaultNotifications: defaults,
    telegramId: params.telegramId,
    createdAt: now,
  })
  return { profile: params.profile, notifications: defaults }
}

export async function getChatProfile(chatId: number | string) {
  const db = await getDb()
  return db.collection("opsChatProfiles").findOne({ chatId: String(chatId), status: "active" })
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
  const [profile, rows] = await Promise.all([
    getChatProfile(chatId),
    db.collection("opsChatSubscriptions").find({ chatId: String(chatId), status: "active" }).toArray(),
  ])
  if (!profile?.profile) return []
  return rows.filter((row: any) => notificationAllowedForProfile(profile.profile as ChatProfile, row.purpose as ChatPurpose))
}

export async function getSubscribedChats(purpose: ChatPurpose) {
  const db = await getDb()
  const [rows, profiles] = await Promise.all([
    db.collection("opsChatSubscriptions").find({ purpose, status: "active" }).toArray(),
    db.collection("opsChatProfiles").find({ status: "active" }).toArray(),
  ])
  const profileByChat = new Map(profiles.map((profile: any) => [String(profile.chatId), profile.profile as ChatProfile]))
  const unique = new Map<string, { chatId: number | string; kind: "direct" | "group"; label: string }>()
  for (const row of rows) {
    if (!row.chatId) continue
    const profile = profileByChat.get(String(row.chatId))
    if (!profile || !notificationAllowedForProfile(profile, purpose)) continue
    unique.set(String(row.chatId), {
      chatId: row.chatId,
      kind: String(row.chatType || "").includes("group") || String(row.chatId).startsWith("-") ? "group" : "direct",
      label: String(row.title || row.chatId),
    })
  }
  return Array.from(unique.values())
}
