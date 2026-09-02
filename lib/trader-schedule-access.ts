import { createHash, randomBytes } from "node:crypto"
import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { getChatProfile } from "@/lib/chat-subscriptions"
import { getTeamAccess } from "@/lib/team-access"
import { supabaseRest } from "@/lib/supabase"
import { getTelegramBotToken, telegramChatMemberActive } from "@/lib/telegram-bot"

const issuer = "ghost-trader-schedule"
const secret = new TextEncoder().encode(process.env.SCHEDULE_SESSION_SECRET || process.env.ADMIN_JWT_SECRET || "dev-schedule-secret-change-me")
const defaultGrantMinutes = 24 * 60

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex") }

export async function createScheduleEditorGrant(params: { telegramId: number; sourceChatId: number | string; ttlMinutes?: number }) {
  const token = `sched_${randomBytes(18).toString("base64url")}`
  const expiresAt = new Date(Date.now() + (params.ttlMinutes || defaultGrantMinutes) * 60_000).toISOString()
  await supabaseRest("trader_schedule_editor_grants", {
    method: "POST",
    body: { token_hash: tokenHash(token), telegram_id: params.telegramId, source_chat_id: String(params.sourceChatId), expires_at: expiresAt },
  })
  return { token, expiresAt }
}

async function scheduleIdentityAllowed(telegramId: number, sourceChatId: string) {
  const [profile, botToken, access] = await Promise.all([getChatProfile(sourceChatId), getTelegramBotToken(), getTeamAccess(telegramId)])
  if (profile?.profile !== "management") return false
  if (access.allowed && access.member?.accessRole === "admin") return true
  return telegramChatMemberActive(botToken, sourceChatId, telegramId)
}

export async function exchangeScheduleEditorGrant(params: { token: string; telegramId: number }) {
  if (!/^sched_[A-Za-z0-9_-]{20,}$/.test(params.token)) return null
  const hash = tokenHash(params.token)
  const now = new Date().toISOString()
  const grants = await supabaseRest<Array<{ token_hash: string; telegram_id: number; source_chat_id: string; expires_at: string; used_at?: string | null }>>(
    `trader_schedule_editor_grants?token_hash=eq.${hash}&telegram_id=eq.${params.telegramId}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=*`,
  )
  const grant = grants[0]
  if (!grant) return null
  if (!(await scheduleIdentityAllowed(params.telegramId, grant.source_chat_id))) return null
  const used = await supabaseRest<any[]>(`trader_schedule_editor_grants?token_hash=eq.${hash}&used_at=is.null&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { used_at: now } })
  if (!used[0]) return null
  const session = await new SignJWT({ telegramId: params.telegramId, sourceChatId: grant.source_chat_id, scope: "schedule:edit" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(issuer).setIssuedAt().setExpirationTime("7d").sign(secret)
  return { session, sourceChatId: grant.source_chat_id }
}

export async function requireScheduleEditor() {
  try {
    const token = cookies().get("schedule_editor")?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, secret, { issuer })
    const telegramId = Number(payload.telegramId)
    const sourceChatId = String(payload.sourceChatId || "")
    if (payload.scope !== "schedule:edit" || !Number.isFinite(telegramId) || !sourceChatId) return null
    if (!(await scheduleIdentityAllowed(telegramId, sourceChatId))) return null
    return { telegramId, sourceChatId }
  } catch {
    return null
  }
}

export const scheduleEditorCookie = { httpOnly: true, secure: true, sameSite: "none" as const, maxAge: 60 * 60 * 24 * 7, path: "/" }
