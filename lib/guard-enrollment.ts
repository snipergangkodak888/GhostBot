import { randomBytes } from "crypto"
import { getDb } from "@/lib/db"
import { telegramApiJson } from "@/lib/telegram-bot"
import { normalizeTeamAccessRole, type TeamAccessRole } from "@/lib/team-access"
import type { ChatProfile } from "@/lib/chat-subscriptions"

const ENROLLMENT_PREFIX = "guard_"
const ACTIVE_TELEGRAM_STATUSES = new Set(["creator", "administrator", "member"])

type TelegramUser = {
  id?: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

type TelegramChat = {
  id?: number | string
  title?: string
  username?: string
  type?: string
}

function activeTelegramMember(member: any) {
  const status = String(member?.status || "")
  return ACTIVE_TELEGRAM_STATUSES.has(status) || (status === "restricted" && member?.is_member === true)
}

function chatMemberId(chatId: number | string, telegramId: number) {
  return `${String(chatId)}:${telegramId}`
}

function profileFromUser(user: TelegramUser) {
  return {
    firstName: String(user.first_name || ""),
    lastName: String(user.last_name || ""),
    username: String(user.username || ""),
    languageCode: String(user.language_code || "en"),
  }
}

export function guardEnrollmentTokenFromText(text: string) {
  const clean = String(text || "").trim()
  const startParameter = clean.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/i)?.[1] || clean
  return startParameter.startsWith(ENROLLMENT_PREFIX) ? startParameter.slice(ENROLLMENT_PREFIX.length) : ""
}

export function guardEnrollmentStartParameter(token: string) {
  return `${ENROLLMENT_PREFIX}${String(token || "").trim()}`
}

export function guardEnrollmentUrl(botUsername: string, token: string) {
  const username = String(botUsername || "").trim().replace(/^@/, "")
  if (!username || !token) return ""
  return `https://t.me/${username}?start=${guardEnrollmentStartParameter(token)}`
}

export async function createGuardEnrollmentLink(params: {
  chatId: number | string
  chatTitle?: string
  chatType?: string
  profile: ChatProfile
  telegramId: number
  expiresDays?: number
  rotate?: boolean
}) {
  const db = await getDb()
  const now = new Date()
  const rows = await db.collection("guardEnrollmentLinks").find({ chatId: String(params.chatId), status: "active" }).sort({ createdAt: -1 }).toArray()
  const reusable = rows.find((row: any) => !row.expiresAt || new Date(row.expiresAt).getTime() > now.getTime())
  if (reusable && !params.rotate) return reusable

  if (rows.length) {
    await db.collection("guardEnrollmentLinks").updateMany(
      { chatId: String(params.chatId), status: "active" },
      { $set: { status: "revoked", revokedAt: now, revokedByTelegramId: params.telegramId, updatedAt: now } },
    )
  }

  const expiresDays = Math.max(1, Math.min(90, Number(params.expiresDays || 30)))
  const token = randomBytes(18).toString("base64url")
  const document = {
    token,
    chatId: String(params.chatId),
    chatTitle: String(params.chatTitle || params.chatId),
    chatType: String(params.chatType || "group"),
    profile: params.profile,
    status: "active",
    expiresAt: new Date(now.getTime() + expiresDays * 24 * 60 * 60 * 1000).toISOString(),
    createdByTelegramId: params.telegramId,
    redemptionCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("guardEnrollmentLinks").insertOne(document)
  return { ...document, _id: result.insertedId }
}

export async function revokeGuardEnrollmentLinks(chatId: number | string, telegramId: number) {
  const db = await getDb()
  const now = new Date()
  const result = await db.collection("guardEnrollmentLinks").updateMany(
    { chatId: String(chatId), status: "active" },
    { $set: { status: "revoked", revokedAt: now, revokedByTelegramId: telegramId, updatedAt: now } },
  )
  return { ok: true as const, revoked: Number(result.modifiedCount || 0) }
}

export async function recordGuardChatMember(params: {
  chat: TelegramChat
  member: any
  source: "setchat_admin_sync" | "enrollment_link" | "chat_member_update" | "message_seen"
}) {
  const user = params.member?.user as TelegramUser | undefined
  if (!params.chat?.id || !user?.id || user.is_bot) return null
  const db = await getDb()
  const now = new Date()
  const existing = await db.collection("guardChatMembers").findOne({ _id: chatMemberId(params.chat.id, Number(user.id)) })
  const reportedStatus = String(params.member?.status || "member")
  const telegramStatus = params.source === "message_seen" && existing?.isTelegramAdmin === true
    ? String(existing.telegramStatus || "administrator")
    : reportedStatus
  const active = activeTelegramMember(params.member)
  const profile = profileFromUser(user)
  const document = {
    _id: chatMemberId(params.chat.id, Number(user.id)),
    chatId: String(params.chat.id),
    chatTitle: String(params.chat.title || params.chat.username || params.chat.id),
    chatType: String(params.chat.type || "group"),
    telegramId: Number(user.id),
    ...profile,
    telegramStatus,
    isTelegramAdmin: ["creator", "administrator"].includes(telegramStatus),
    membershipStatus: active ? "active" : "inactive",
    source: params.source,
    lastVerifiedAt: now,
    updatedAt: now,
  }
  await db.collection("guardChatMembers").updateOne(
    { _id: document._id },
    { $set: document, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )
  return document
}

async function activateGuardMember(user: TelegramUser, sourceChatId: string, source: "enrollment_link" | "chat_member_update") {
  const db = await getDb()
  const telegramId = Number(user.id)
  const existing = await db.collection("guardMembers").findOne({ telegramId })
  if (existing?.status === "deactivated" && existing.enrollmentManaged !== true) {
    return { ok: false as const, error: "Your Guard access was deactivated by an administrator." }
  }
  const now = new Date()
  const profile = profileFromUser(user)
  await db.collection("guardMembers").updateOne(
    { telegramId },
    {
      $set: {
        telegramId,
        ...profile,
        accessRole: normalizeTeamAccessRole(existing?.accessRole),
        status: "active",
        enrollmentManaged: existing ? existing.enrollmentManaged === true : true,
        enrollmentSource: source,
        enrollmentChatId: sourceChatId,
        activatedAt: existing?.activatedAt || now,
        updatedAt: now,
      },
      $unset: { accessSuspendedReason: "", deactivatedAt: "" },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  await db.collection("users").updateOne(
    { telegramId },
    { $set: { guardAccess: "active", updatedAt: now } },
    { upsert: true },
  )
  return { ok: true as const, accessRole: normalizeTeamAccessRole(existing?.accessRole) }
}

export async function verifyAndRedeemGuardEnrollment(params: {
  text: string
  telegramId: number
  user: TelegramUser
  token: string
}) {
  const enrollmentToken = guardEnrollmentTokenFromText(params.text)
  if (!enrollmentToken) return { ok: false as const, handled: false as const, error: "Enrollment link not found" }
  const db = await getDb()
  const link = await db.collection("guardEnrollmentLinks").findOne({ token: enrollmentToken, status: "active" })
  if (!link) return { ok: false as const, handled: true as const, error: "This Guard enrollment link is invalid or revoked." }
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
    await db.collection("guardEnrollmentLinks").updateOne({ _id: link._id }, { $set: { status: "expired", updatedAt: new Date() } })
    return { ok: false as const, handled: true as const, error: "This Guard enrollment link has expired. Ask an admin to refresh it." }
  }
  const chatProfile = await db.collection("opsChatProfiles").findOne({ chatId: String(link.chatId), status: "active" })
  if (!chatProfile) return { ok: false as const, handled: true as const, error: "The source Telegram group is no longer configured." }

  const membership = await telegramApiJson(params.token, "getChatMember", { chat_id: link.chatId, user_id: params.telegramId })
  if (!membership?.ok || !activeTelegramMember(membership.result)) {
    return { ok: false as const, handled: true as const, error: "Join the configured Telegram group before using this Guard enrollment link." }
  }
  const telegramMember = membership.result || { status: "member", user: params.user }
  if (!telegramMember.user) telegramMember.user = params.user
  await recordGuardChatMember({
    chat: { id: link.chatId, title: link.chatTitle, type: link.chatType },
    member: telegramMember,
    source: "enrollment_link",
  })
  const activated = await activateGuardMember(telegramMember.user || params.user, String(link.chatId), "enrollment_link")
  if (!activated.ok) return { ...activated, handled: true as const }
  const now = new Date()
  await db.collection("guardEnrollmentLinks").updateOne(
    { _id: link._id },
    { $inc: { redemptionCount: 1 }, $set: { lastRedeemedAt: now, updatedAt: now } },
  )
  await db.collection("opsPermissionAudit").insertOne({
    action: "guard_group_enrollment",
    chatId: String(link.chatId),
    telegramId: params.telegramId,
    accessRole: activated.accessRole,
    createdAt: now,
  })
  return { ok: true as const, handled: true as const, accessRole: activated.accessRole, chatId: String(link.chatId), chatTitle: link.chatTitle }
}

export async function syncTelegramChatAdministrators(params: {
  token: string
  chat: TelegramChat
}) {
  if (!params.chat.id) return { administrators: 0, memberCount: null }
  const [administratorsResult, countResult] = await Promise.all([
    telegramApiJson(params.token, "getChatAdministrators", { chat_id: params.chat.id }),
    telegramApiJson(params.token, "getChatMemberCount", { chat_id: params.chat.id }),
  ])
  const administrators = Array.isArray(administratorsResult?.result) ? administratorsResult.result : []
  for (const administrator of administrators) {
    await recordGuardChatMember({ chat: params.chat, member: administrator, source: "setchat_admin_sync" })
  }
  const memberCount = Number.isFinite(Number(countResult?.result)) ? Number(countResult.result) : null
  const db = await getDb()
  await db.collection("opsChatProfiles").updateOne(
    { chatId: String(params.chat.id) },
    { $set: { telegramMemberCount: memberCount, administratorsSyncedAt: new Date(), updatedAt: new Date() } },
  )
  return { administrators: administrators.length, memberCount }
}

export async function handleGuardChatMemberUpdate(update: any) {
  const chat = update?.chat as TelegramChat | undefined
  const member = update?.new_chat_member
  const user = member?.user as TelegramUser | undefined
  if (!chat?.id || !user?.id || user.is_bot) return { handled: false as const }
  const db = await getDb()
  const profile = await db.collection("opsChatProfiles").findOne({ chatId: String(chat.id), status: "active" })
  if (!profile) return { handled: false as const }
  const recorded = await recordGuardChatMember({ chat, member, source: "chat_member_update" })
  if (!recorded) return { handled: false as const }

  if (recorded.membershipStatus === "active") {
    const activated = await activateGuardMember(user, String(chat.id), "chat_member_update")
    return { handled: true as const, active: true, activated: activated.ok }
  }

  const guardMember = await db.collection("guardMembers").findOne({ telegramId: Number(user.id) })
  if (guardMember?.enrollmentManaged === true) {
    const [activeMemberships, activeProfiles] = await Promise.all([
      db.collection("guardChatMembers").find({ telegramId: Number(user.id), membershipStatus: "active" }).toArray(),
      db.collection("opsChatProfiles").find({ status: "active" }).toArray(),
    ])
    const activeProfileChatIds = new Set(activeProfiles.map((row: any) => String(row.chatId)))
    if (!activeMemberships.some((row: any) => activeProfileChatIds.has(String(row.chatId)))) {
      const now = new Date()
      await db.collection("guardMembers").updateOne(
        { _id: guardMember._id },
        { $set: { status: "inactive", accessSuspendedReason: "no_active_team_chats", updatedAt: now } },
      )
      await db.collection("users").updateOne(
        { telegramId: Number(user.id) },
        { $set: { guardAccess: "inactive", updatedAt: now } },
      )
    }
  }
  return { handled: true as const, active: false }
}

export async function handleGuardBotMembershipUpdate(update: any) {
  const chat = update?.chat as TelegramChat | undefined
  const status = String(update?.new_chat_member?.status || "")
  if (!chat?.id || !status) return { handled: false as const }
  const db = await getDb()
  const profile = await db.collection("opsChatProfiles").findOne({ chatId: String(chat.id) })
  if (!profile) return { handled: false as const }

  const active = activeTelegramMember(update.new_chat_member)
  const now = new Date()
  await db.collection("opsChatProfiles").updateOne(
    { chatId: String(chat.id) },
    { $set: { status: active ? "active" : "inactive", botMembershipStatus: status, botMembershipUpdatedAt: now, updatedAt: now } },
  )
  await db.collection("opsHostedGroups").updateOne(
    { chatId: String(chat.id) },
    { $set: { status: active ? "active" : "inactive", botMembershipStatus: status, updatedAt: now } },
  )
  return { handled: true as const, active }
}

export async function grantDiscoveredGuardAccess(telegramId: number, accessRole: TeamAccessRole, actor = "admin") {
  const db = await getDb()
  const discovered = await db.collection("guardChatMembers").findOne({ telegramId }, { sort: { lastVerifiedAt: -1 } })
  if (!discovered) return { ok: false as const, error: "Telegram member was not found" }
  const existing = await db.collection("guardMembers").findOne({ telegramId })
  const now = new Date()
  const role = normalizeTeamAccessRole(accessRole)
  await db.collection("guardMembers").updateOne(
    { telegramId },
    {
      $set: {
        telegramId,
        firstName: discovered.firstName || existing?.firstName || "",
        lastName: discovered.lastName || existing?.lastName || "",
        username: discovered.username || existing?.username || "",
        languageCode: discovered.languageCode || existing?.languageCode || "en",
        accessRole: role,
        status: "active",
        enrollmentManaged: false,
        enrollmentSource: "admin_dashboard",
        activatedAt: existing?.activatedAt || now,
        updatedAt: now,
      },
      $unset: { accessSuspendedReason: "", deactivatedAt: "" },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  await db.collection("users").updateOne({ telegramId }, { $set: { guardAccess: "active", updatedAt: now } }, { upsert: true })
  await db.collection("opsPermissionAudit").insertOne({
    action: "grant_discovered_guard_access",
    telegramId,
    previousRole: normalizeTeamAccessRole(existing?.accessRole),
    accessRole: role,
    actor,
    createdAt: now,
  })
  return { ok: true as const, accessRole: role }
}

export async function getGuardEnrollmentDashboard() {
  const db = await getDb()
  const [profiles, memberships, guardMembers, links] = await Promise.all([
    db.collection("opsChatProfiles").find({ status: "active" }).sort({ title: 1 }).toArray(),
    db.collection("guardChatMembers").find({}).sort({ lastVerifiedAt: -1 }).toArray(),
    db.collection("guardMembers").find({}).toArray(),
    db.collection("guardEnrollmentLinks").find({ status: "active" }).toArray(),
  ])
  const guardByTelegramId = new Map(guardMembers.map((member: any) => [Number(member.telegramId), member]))
  const membersByTelegramId = new Map<number, any>()
  for (const membership of memberships) {
    const telegramId = Number(membership.telegramId)
    if (!Number.isFinite(telegramId)) continue
    const current = membersByTelegramId.get(telegramId) || {
      telegramId,
      firstName: membership.firstName || "",
      lastName: membership.lastName || "",
      username: membership.username || "",
      isTelegramAdmin: false,
      lastVerifiedAt: membership.lastVerifiedAt,
      memberships: [],
    }
    current.isTelegramAdmin = current.isTelegramAdmin || membership.isTelegramAdmin === true
    current.memberships.push({
      chatId: membership.chatId,
      chatTitle: membership.chatTitle,
      telegramStatus: membership.telegramStatus,
      membershipStatus: membership.membershipStatus,
      lastVerifiedAt: membership.lastVerifiedAt,
    })
    membersByTelegramId.set(telegramId, current)
  }
  const discoveredMembers = Array.from(membersByTelegramId.values()).map((member: any) => {
    const guard = guardByTelegramId.get(member.telegramId)
    return {
      ...member,
      guardMemberId: guard?._id || null,
      accessRole: guard?.accessRole || null,
      guardStatus: guard?.status || "not_enrolled",
    }
  })
  const groups = profiles.map((profile: any) => {
    const activeMembers = memberships.filter((member: any) => String(member.chatId) === String(profile.chatId) && member.membershipStatus === "active")
    const enrolledMembers = activeMembers.filter((member: any) => guardByTelegramId.get(Number(member.telegramId))?.status === "active")
    const activeLink = links.find((link: any) => String(link.chatId) === String(profile.chatId) && (!link.expiresAt || new Date(link.expiresAt).getTime() > Date.now()))
    return {
      chatId: profile.chatId,
      title: profile.title || profile.chatId,
      profile: profile.profile,
      telegramMemberCount: profile.telegramMemberCount ?? null,
      discoveredCount: activeMembers.length,
      enrolledCount: enrolledMembers.length,
      enrollmentLinkStatus: activeLink ? "active" : "missing",
      enrollmentLinkExpiresAt: activeLink?.expiresAt || null,
      administratorsSyncedAt: profile.administratorsSyncedAt || null,
    }
  })
  return { groups, discoveredMembers }
}
