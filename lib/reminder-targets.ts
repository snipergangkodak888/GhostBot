import { getDb } from "@/lib/db"

export type ReminderTarget = {
  telegramId: number
  username: string
  displayName: string
}

function cleanUsername(value: unknown) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase()
}

function displayName(member: any) {
  return [member?.firstName, member?.lastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ")
    || (member?.username ? String(member.username).replace(/^@/, "") : `Trader ${member?.telegramId || ""}`.trim())
}

export function reminderTargetFromMember(member: any): ReminderTarget | null {
  const telegramId = Number(member?.telegramId)
  if (!Number.isFinite(telegramId)) return null
  return {
    telegramId,
    username: cleanUsername(member?.username),
    displayName: displayName(member),
  }
}

export async function listReminderEligibleMembers(chatId?: number | string | null) {
  const db = await getDb()
  const [members, memberships] = await Promise.all([
    db.collection("guardMembers").find({ status: "active" }).sort({ firstName: 1 }).toArray(),
    chatId == null
      ? Promise.resolve([])
      : db.collection("guardChatMembers").find({ chatId: String(chatId), membershipStatus: "active" }).toArray(),
  ])
  const inChat = new Set(memberships.map((row: any) => Number(row.telegramId)).filter(Number.isFinite))
  const scoped = chatId == null ? members : members.filter((member: any) => inChat.has(Number(member.telegramId)))
  return scoped.map(reminderTargetFromMember).filter((member): member is ReminderTarget => Boolean(member))
}

export async function reminderTargetForTelegramId(telegramId: number) {
  const db = await getDb()
  return reminderTargetFromMember(await db.collection("guardMembers").findOne({ telegramId, status: "active" }))
}

export async function resolveReminderTargetUsernames(usernames: unknown, chatId?: number | string | null) {
  const requested = Array.from(new Set((Array.isArray(usernames) ? usernames : [])
    .map(cleanUsername)
    .filter(Boolean)))
  const members = await listReminderEligibleMembers(chatId)
  const byUsername = new Map(members.filter((member) => member.username).map((member) => [member.username, member]))
  const targets = requested.map((username) => byUsername.get(username)).filter((member): member is ReminderTarget => Boolean(member))
  const unresolved = requested.filter((username) => !byUsername.has(username))
  return { targets, unresolved }
}

export function reminderTargetsLabel(targetMode: unknown, targets: ReminderTarget[] = []) {
  if (targetMode === "creator") return targets[0]?.displayName || "You"
  if (targetMode === "specific") return targets.map((target) => target.displayName).filter(Boolean).join(", ") || "Selected traders"
  return "Everyone in this chat"
}
