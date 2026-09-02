import { getChatProfile, type ChatProfile } from "@/lib/chat-subscriptions"
import { getTeamAccess, normalizeTeamAccessRole, type TeamAccessRole } from "@/lib/team-access"

export type BotCapability = "launch" | "trade" | "finance" | "management"

export type BotPermissionContext = {
  telegramId: number
  chatId: number | string
  isGroup: boolean
  role: TeamAccessRole
  profile: ChatProfile | null
  configured: boolean
  capture: boolean
}

const MEMBER_CAPABILITIES: Record<TeamAccessRole, BotCapability[]> = {
  member: ["launch", "trade"],
  admin: ["launch", "trade", "finance", "management"],
}

const CHAT_CAPABILITIES: Record<ChatProfile, BotCapability[]> = {
  launch: ["launch"],
  trade: ["trade"],
  fee: ["finance"],
  finance: ["finance"],
  management: ["launch", "trade", "finance", "management"],
}

export async function getBotPermissionContext(params: {
  telegramId: number
  chatId: number | string
  capture?: boolean
}): Promise<BotPermissionContext> {
  const isGroup = Number(params.chatId) < 0
  if (params.capture) {
    return { telegramId: params.telegramId, chatId: params.chatId, isGroup, role: "admin", profile: isGroup ? "management" : null, configured: true, capture: true }
  }
  const [access, chat] = await Promise.all([
    getTeamAccess(params.telegramId),
    isGroup ? getChatProfile(params.chatId) : Promise.resolve(null),
  ])
  return {
    telegramId: params.telegramId,
    chatId: params.chatId,
    isGroup,
    role: normalizeTeamAccessRole(access.member?.accessRole),
    profile: (chat?.profile || null) as ChatProfile | null,
    configured: !isGroup || Boolean(chat?.profile),
    capture: false,
  }
}

export function canUseBotCapability(context: BotPermissionContext, capability: BotCapability) {
  if (!MEMBER_CAPABILITIES[context.role].includes(capability)) return false
  if (!context.isGroup) return true
  if (!context.profile) return capability === "management" && context.role === "admin"
  if (["fee", "finance", "management"].includes(context.profile) && context.role !== "admin") return false
  return CHAT_CAPABILITIES[context.profile].includes(capability)
}

// The scheduler is collaboratively editable by active Guard members, but only
// when the request originates from the configured Management Chat. It is kept
// separate from the broader management capability, which remains admin-only.
export function canOpenTraderSchedule(context: BotPermissionContext) {
  return (context.isGroup && context.profile === "management") || (!context.isGroup && context.role === "admin")
}

export function canEditLaunchSchedule(context: BotPermissionContext) {
  return context.profile === "launch" || (!context.isGroup && context.role === "admin")
}

export function botPermissionDeniedMessage(context: BotPermissionContext, capability: BotCapability) {
  if (context.isGroup && !context.profile) return "⛔ This chat has not been configured. A GhostBot admin must run /setchat launch, /setchat trade, /setchat fee, /setchat finance, or /setchat management."
  if (capability === "finance") return "⛔ Financial, revenue, receipt, and payroll information is not available in this chat."
  if (capability === "management") return "⛔ Only GhostBot admins can manage chat profiles and notification settings."
  if (capability === "trade") return "⛔ Project operations and trader functions are not available in this chat."
  return "⛔ Launch functions are not available in this chat."
}
