import { randomBytes } from "crypto"
import { getDb } from "@/lib/db"
import { normalizeTimeZone } from "@/lib/team-timezone"

export type TeamProfile = {
  firstName?: string
  lastName?: string
  username?: string
  languageCode?: string
}

export function generateGuardCode() {
  return `GHOST-${randomBytes(4).toString("hex").toUpperCase()}`
}

function normalizeCode(code: string) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "")
}

function isExpired(value?: string | Date | null) {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export async function getTeamAccess(telegramId: number | string | null | undefined) {
  const id = Number(telegramId)
  if (!Number.isFinite(id)) return { allowed: false, reason: "missing-user" }
  const db = await getDb()
  const member = await db.collection("guardMembers").findOne({ telegramId: id })
  if (!member) return { allowed: false, reason: "invite-required" }
  if (member.status !== "active") return { allowed: false, reason: "deactivated", member }
  return { allowed: true, reason: "active", member }
}

export async function getMemberTimeZone(telegramId: number | string | null | undefined) {
  const id = Number(telegramId)
  if (!Number.isFinite(id)) return ""
  const db = await getDb()
  const [member, user] = await Promise.all([
    db.collection("guardMembers").findOne({ telegramId: id }),
    db.collection("users").findOne({ telegramId: id }),
  ])
  return normalizeTimeZone(member?.timeZone || user?.timeZone)
}

export async function saveMemberTimeZone(telegramId: number | string, value: unknown, source: "bot" | "mini-app" | "admin" = "bot") {
  const id = Number(telegramId)
  const timeZone = normalizeTimeZone(value)
  if (!Number.isFinite(id)) return { ok: false as const, error: "Invalid Telegram user" }
  if (!timeZone) return { ok: false as const, error: "Invalid timezone" }

  const db = await getDb()
  const now = new Date()
  await Promise.all([
    db.collection("guardMembers").updateOne(
      { telegramId: id },
      { $set: { timeZone, timeZoneSource: source, timeZoneUpdatedAt: now, updatedAt: now } },
    ),
    db.collection("users").updateOne(
      { telegramId: id },
      { $set: { timeZone, timeZoneSource: source, timeZoneUpdatedAt: now, updatedAt: now } },
      { upsert: true },
    ),
  ])
  return { ok: true as const, timeZone }
}

export async function createGuardInviteCode(daysValid = 7) {
  const db = await getDb()
  const now = new Date()
  const expiresAt = daysValid > 0 ? new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000).toISOString() : null
  let code = generateGuardCode()
  for (let index = 0; index < 5; index++) {
    const existing = await db.collection("guardInviteCodes").findOne({ code })
    if (!existing) break
    code = generateGuardCode()
  }
  const doc = {
    code,
    status: "unused",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("guardInviteCodes").insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function redeemGuardInviteCode(params: {
  code: string
  telegramId: number
  profile?: TeamProfile
  source?: "app" | "bot"
}) {
  const code = normalizeCode(params.code)
  if (!code) return { ok: false, error: "Invite code is required" }
  const db = await getDb()
  const invite = await db.collection("guardInviteCodes").findOne({ code })
  if (!invite || invite.status === "deleted") return { ok: false, error: "Invalid invite code" }
  if (invite.status === "used") return { ok: false, error: "This invite code was already used" }
  if (isExpired(invite.expiresAt)) {
    await db.collection("guardInviteCodes").updateOne({ _id: invite._id }, { $set: { status: "expired", updatedAt: new Date() } })
    return { ok: false, error: "This invite code has expired" }
  }

  const now = new Date()
  const profile = params.profile || {}
  await db.collection("guardInviteCodes").updateOne(
    { _id: invite._id },
    {
      $set: {
        status: "used",
        usedByTelegramId: params.telegramId,
        usedAt: now,
        usedFrom: params.source || "app",
        updatedAt: now,
      },
    },
  )
  await db.collection("guardMembers").updateOne(
    { telegramId: params.telegramId },
    {
      $set: {
        telegramId: params.telegramId,
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        username: profile.username || "",
        languageCode: profile.languageCode || "en",
        status: "active",
        inviteCode: code,
        inviteCodeId: invite._id,
        activatedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  await db.collection("users").updateOne(
    { telegramId: params.telegramId },
    { $set: { guardAccess: "active", updatedAt: now } },
    { upsert: true },
  )
  return { ok: true }
}

export async function deactivateGuardMember(id: string) {
  const db = await getDb()
  const member = await db.collection("guardMembers").findOne({ _id: id })
  if (!member) return { ok: false, error: "Member not found" }
  const now = new Date()
  await db.collection("guardMembers").updateOne({ _id: id }, { $set: { status: "deactivated", deactivatedAt: now, updatedAt: now } })
  await db.collection("users").updateOne({ telegramId: member.telegramId }, { $set: { guardAccess: "deactivated", updatedAt: now } })
  return { ok: true }
}

export async function deleteGuardInviteCode(id: string) {
  const db = await getDb()
  await db.collection("guardInviteCodes").updateOne({ _id: id }, { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() } })
  return { ok: true }
}
