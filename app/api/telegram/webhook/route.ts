import { NextRequest, NextResponse } from "next/server"
import { answerOpsAi, answerOpsBot, answerProjectNotes, buildConversationContext, chooseOpsAiActionCandidate, executeOpsAiAction, formatOpsProjectDetails, proposeOpsAiAction, rejectOpsAiAction, type OpsAiOptions } from "@/lib/ops-bot"
import { getMemberTimeZone, getTeamAccess, guardCodeFromText, redeemGuardInviteCode, saveMemberTimeZone } from "@/lib/team-access"
import { getDb } from "@/lib/db"
import { deleteProjectCascade } from "@/lib/platform-data"
import { getSheetSchema, SHEET_KIND_ORDER, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"
import { dateKeyInTimeZone, detectExplicitTimeZone, formatTeamDateTime, parseContextualTeamDateTime, parseNaturalTeamDate, parseNaturalTeamDateTime, parseTeamDateTime, teamZoneLabel, TIME_ZONE_OPTIONS, timeZoneFromOption, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { parseReminderRequest, reminderRequestError, type ParsedReminderRequest } from "@/lib/reminder-parser"
import { listReminderEligibleMembers, reminderTargetForTelegramId, reminderTargetsLabel, resolveReminderTargetUsernames, type ReminderTarget } from "@/lib/reminder-targets"
import { editTelegramMessage, getTelegramBotToken, getTelegramBotUsername, isTelegramCaptureActive, sendChatAction, sendTelegramDocument, sendTelegramMessage, sendTelegramPhoto, telegramApi, telegramApiJson, withTelegramLoading } from "@/lib/telegram-bot"
import { savePayrollDay } from "@/lib/payroll-day"
import { loadDailyPayrollReport, parseReportDateFromText } from "@/lib/payroll-daily-report"
import { renderPayrollReportPng } from "@/lib/payroll-report-image"
import { miscIncomeCategoryLabel, parseIncomeLogCommand } from "@/lib/payroll-misc"
import { chatProfileLabel, chatPurposeLabel, getChatProfile, listChatSubscriptions, normalizeChatProfile, normalizeChatPurpose, notificationAllowedForProfile, setChatProfile, setChatSubscription, type ChatProfile } from "@/lib/chat-subscriptions"
import { formatLaunchDaySchedule } from "@/lib/launch-calendar"
import { projectFeeConfig } from "@/lib/revenue-projects"
import { revenueTransactionUrl } from "@/lib/revenue-explorer"
import { acceptReceiptMatch, assignFeeProject, classifyReceiptAsRevenue, confirmFeeExpectation, createForwardedFeeEvent, ensureDailyTradingFeeExpectations, getRevenueReceipt, listRevenueDay, setFeeQuoteAsset, setFeeType, updateReceiptClassification } from "@/lib/revenue-service"
import { feeProjectButtons, formatConsolidationCandidate, formatFeeExpectation, isFeeInboxChat, receiptClassificationButtons, revenueChainLabel } from "@/lib/revenue-telegram"
import { confirmConsolidationCandidate, getConsolidationCandidate, rejectConsolidationCandidate } from "@/lib/revenue-consolidation-candidates"
import { isGlobalRevenueFeeType, type FeeType } from "@/lib/revenue-types"
import { receiptAvailableAmount, receiptAvailableUsd } from "@/lib/revenue-allocations"
import { LAUNCH_CHAINS, launchPad, padsForChain, type LaunchChainId } from "@/lib/launch-math"
import { operationalLaunchVenue, operationalVenuesForChain } from "@/lib/launch-venues"
import { dailyProjectReviewButtons, dailyProjectReviewId, dailyProjectReviewText, type DailyProjectReviewRecord } from "@/lib/daily-project-review"
import { calculateLaunchQuote, defaultMmLiquidity, formatLaunchQuote, getLaunchAssetPrice, parseLaunchNumber, type LaunchTargetMetric } from "@/lib/launch-calculator"
import { botPermissionDeniedMessage, canUseBotCapability, getBotPermissionContext, type BotCapability, type BotPermissionContext } from "@/lib/bot-permissions"
import { createGuardEnrollmentLink, guardEnrollmentTokenFromText, guardEnrollmentUrl, handleGuardBotMembershipUpdate, handleGuardChatMemberUpdate, recordGuardChatMember, revokeGuardEnrollmentLinks, syncTelegramChatAdministrators, verifyAndRedeemGuardEnrollment } from "@/lib/guard-enrollment"
import { activateScheduledProject, activationLifecycleFields, cancelScheduledProject, cleanLaunchProjectName, confirmNoProjectReferrer, confirmStandardProjectFees, deactivateActiveProject, projectActivationReadiness, projectLaunchAt, projectLaunchDateKey, projectLaunchTimingStatus, rescheduleProject, setTentativeProjectLaunchDate } from "@/lib/project-lifecycle"
import { formatLaunchSetupReview, launchChainButtons, launchChainConfig, launchChainIdForProject, launchMethodButtons, launchQuoteButtons, launchSetupButtons, launchSetupReady, launchVenueButtons, launchVenueSelection } from "@/lib/launch-setup"
import { parseCustomQuoteTokenInput, resolveCustomQuoteToken } from "@/lib/custom-quote-token"
import { launchMethodLabel, normalizeLaunchMethod } from "@/lib/launch-method"
import { ghostBotOrganicChannelUrl, normalizeOrganicTicker, organicChannelCompletionMessage, organicChannelTitle, SUMO_TRADE_BOT_USERNAME, sumoBotChannelUrl, sumoSubscribeCommand, validOrganicTicker, validSumoProfileId } from "@/lib/organic-channel-setup"
import { telegramUserAutomationConfigured } from "@/lib/telegram-user-client"
import { queueOrganicChannelJob } from "@/lib/organic-channel-jobs"

type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }

function hasTelegramHtml(text: string) {
  return /<\/?(b|strong|i|em|u|s|code|pre|a)\b/i.test(text)
}

function replyKeyboard() {
  return {
    keyboard: [
      [{ text: "🏠 Home" }, { text: "📁 Projects" }],
      [{ text: "📈 Profit" }, { text: "💸 Payroll" }],
      [{ text: "📅 Calendar" }, { text: "🚀 Launch Calc" }],
      [{ text: "🔔 Reminders" }, { text: "📝 Notes" }],
      [{ text: "🧠 AI" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  }
}

function removeGroupKeyboard() {
  return { remove_keyboard: true }
}

async function sendMessage(token: string, chatId: number | string, text: string, inline?: InlineButton[][]) {
  const inGroup = isGroupChatId(chatId)
  return sendTelegramMessage(token, chatId, text, {
    parseMode: hasTelegramHtml(text) ? "HTML" : undefined,
    disableWebPagePreview: true,
    replyMarkup: inline
      ? { inline_keyboard: inline }
      : inGroup
        ? removeGroupKeyboard()
        : replyKeyboard(),
  })
}

function telegramMessageId(message: any) {
  const messageId = Number(message?.message_id || 0)
  return messageId > 0 ? messageId : null
}

async function deleteWorkflowMessages(token: string, chatId: number | string, messageIds: Array<unknown>) {
  const ids = Array.from(new Set(messageIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
  await Promise.all(ids.map((messageId) => telegramApiJson(token, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => null)))
}

async function editOrSendWorkflowMessage(
  token: string,
  chatId: number | string,
  messageId: number | null | undefined,
  text: string,
  buttons: InlineButton[][] = [],
) {
  if (messageId) {
    const edited = await editTelegramMessage(token, chatId, messageId, text, {
      parseMode: hasTelegramHtml(text) ? "HTML" : undefined,
      replyMarkup: { inline_keyboard: buttons },
    })
    if (edited) return messageId
  }
  return sendMessage(token, chatId, text, buttons.length ? buttons : undefined)
}

function botReplyMarkup(chatId: number | string, inline?: InlineButton[][]) {
  if (inline) return { inline_keyboard: inline }
  if (isGroupChatId(chatId)) return removeGroupKeyboard()
  return replyKeyboard()
}

function botReplyOptions(chatId: number | string, text: string, inline?: InlineButton[][]) {
  const replyMarkup = botReplyMarkup(chatId, inline)
  return {
    parseMode: hasTelegramHtml(text) ? "HTML" as const : undefined,
    ...(replyMarkup ? { replyMarkup } : {}),
  }
}

async function sendAsyncResponse(
  token: string,
  chatId: number | string,
  work: () => Promise<{ text: string; inline?: InlineButton[][] }>,
  loadingText = "⏳ One moment…",
) {
  await withTelegramLoading(token, chatId, {
    loadingText,
    work: async () => {
      const result = await work()
      return {
        text: result.text,
        ...botReplyOptions(chatId, result.text, result.inline),
      }
    },
  })
}

async function answerCallback(token: string, callbackId: string, text = "") {
  await telegramApi(token, "answerCallbackQuery", { callback_query_id: callbackId, text })
}

async function setBotCommands(token: string) {
  await telegramApi(token, "setMyCommands", {
    commands: [
      { command: "menu", description: "Show Ghost Team actions" },
      { command: "profit", description: "Show today profit" },
      { command: "projects", description: "Show active projects" },
      { command: "calendar", description: "Show the daily launch schedule" },
      { command: "addlaunch", description: "Add a launch step by step" },
      { command: "schedulelaunch", description: "Create a launch with guided setup" },
      { command: "organicsetup", description: "Set up organic trade notifications" },
      { command: "launchcalc", description: "Build a client launch-capital quote" },
      { command: "reminders", description: "Manage reminders" },
      { command: "setreminder", description: "Set a reminder in natural language" },
      { command: "payroll", description: "Manage payroll" },
      { command: "fees", description: "Show today’s revenue inbox" },
      { command: "report", description: "Spreadsheet-style payroll breakdown image" },
      { command: "log", description: "Log project trading or dev income" },
      { command: "notes", description: "Show project notes" },
      { command: "ai", description: "Ask AI about projects and data" },
      { command: "timezone", description: "Set your local timezone" },
      { command: "setchat", description: "Admin: configure this chat profile" },
      { command: "chatprofile", description: "Show this chat's access profile" },
      { command: "guardlink", description: "Admin: show, refresh, or revoke team enrollment" },
      { command: "subscribe", description: "Subscribe this chat to scheduled updates" },
      { command: "subscriptions", description: "Show scheduled updates for this chat" },
    ],
  })
}

function appBaseUrl(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || ""
  const proto = req.headers.get("x-forwarded-proto") || "https"
  return host ? `${proto}://${host}` : "https://ghost-sys.vercel.app"
}

function appUrl(req: NextRequest) {
  return `${appBaseUrl(req)}/telegram`
}

function helpMessage() {
  return [
    "🛡️ Ghost Team bot is ready.",
    "",
    "In groups, @mention me, reply to my message, or use a /command.",
    "Menu buttons only work in DMs — groups use @mention or /commands.",
    "",
    "Use the stable buttons below, or type:",
    "📈 /profit",
    "📁 /projects",
    "📅 /calendar",
    "➕ /addlaunch - add a launch step by step",
    "🗓️ /schedulelaunch - create a launch with guided setup",
    "📣 /organicsetup TICKER - set up organic trade notifications",
    "🚀 /launchcalc - build a launch-capital quote",
    "🔔 /reminders",
    "⏰ /setreminder WWR injection today at 8 PM ET",
    "💸 /payroll",
    "📊 /report [today|yesterday|YYYY-MM-DD]",
    "🧾 /log <project id> <trading|dev> <amount>",
    "📝 /notes - project notes",
    "🧠 @me your question",
    "🌍 /timezone - set your local timezone",
    "💰 /fees - show today’s revenue inbox",
    "⚙️ Admins: /setchat launch|trade|fee|finance|management",
    "🛡️ Admins: /guardlink show|refresh|revoke",
    "📣 /subscribe launches|fees (within the matching chat profile)",
  ].join("\n")
}

function timeZoneButtons(targetTelegramId: number) {
  return [
    TIME_ZONE_OPTIONS.slice(0, 4).map((option) => ({ text: option.label, callback_data: `tz:set:${option.key}:${targetTelegramId}` })),
    TIME_ZONE_OPTIONS.slice(4).map((option) => ({ text: option.label, callback_data: `tz:set:${option.key}:${targetTelegramId}` })),
  ]
}

function timeZonePrompt() {
  return "🌍 What timezone should I use for times you enter without a timezone?\n\nYou can also send /timezone Europe/London or another IANA timezone."
}

function reminderInputPrompt(savedTimeZone?: string) {
  return [
    ...(savedTimeZone ? [`✅ Timezone saved as ${teamZoneLabel(savedTimeZone)}.`, ""] : []),
    "🔔 What should I remind this chat about, and when?",
    "",
    "Write it naturally:",
    "• WWR injection today at 8 PM ET",
    "• Remind @alex tomorrow at 9 AM PT to check WWR",
    "• Every day at 10 AM ET post the risk check",
    "",
    "The reminder stays in this chat. “Remind me” tags you; @mentions tag selected traders.",
    "Send /cancel to stop.",
  ].join("\n")
}

function isRelativeDurationReminder(text: string) {
  return /\bin\s+(?:(?:\d+|half|an?)\s*(?:m(?:in(?:ute)?s?)?|h(?:ou)?rs?|hours?|days?|weeks?))\b/i.test(text)
}

async function maybeRequestReminderTimeZone(
  token: string,
  chatId: number | string,
  telegramId: number,
  text: string,
  stateAction = "timezone_for_reminder",
) {
  if (!/\bremind(?:er|ers)?\b/i.test(text)) return false
  if (detectExplicitTimeZone(text) || isRelativeDurationReminder(text) || await getMemberTimeZone(telegramId)) return false
  await setState(telegramId, { action: stateAction, pendingText: text }, chatId)
  await sendMessage(token, chatId, timeZonePrompt(), timeZoneButtons(telegramId))
  return true
}

function inviteMessage() {
  return [
    "🛡️ Access required",
    "",
    "Send your one-time Guard Team code to activate the bot and app.",
    "",
    "Example: GHOST-1A2B3C4D",
  ].join("\n")
}

async function ensureAccess(params: {
  token: string
  chatId: number | string
  telegramId: number | null
  text: string
  profile: any
  req: NextRequest
}) {
  if (isTelegramCaptureActive()) return true
  if (!params.telegramId) {
    await sendMessage(params.token, params.chatId, inviteMessage())
    return false
  }

  if (guardEnrollmentTokenFromText(params.text)) {
    const enrollment = await verifyAndRedeemGuardEnrollment({
      text: params.text,
      telegramId: params.telegramId,
      user: {
        id: params.telegramId,
        first_name: params.profile?.first_name || "",
        last_name: params.profile?.last_name || "",
        username: params.profile?.username || "",
        language_code: params.profile?.language_code || "en",
      },
      token: params.token,
    })
    if (!enrollment.ok) {
      await sendMessage(params.token, params.chatId, `⛔ ${enrollment.error}`)
      return false
    }
    const roleLabel = enrollment.accessRole === "admin" ? "Admin" : "Member"
    await sendMessage(params.token, params.chatId, `✅ Guard access activated as ${roleLabel}.\n\nVerified through ${enrollment.chatTitle || "your configured team group"}.${enrollment.accessRole === "admin" ? "" : " An admin can promote your role from the Guard Team dashboard."}`)
    return true
  }

  const access = await getTeamAccess(params.telegramId)
  if (access.allowed) return true

  if (access.reason === "deactivated") {
    await sendMessage(params.token, params.chatId, "⛔ Your Guard Team access is deactivated. Ask an admin to restore access.")
    return false
  }

  const code = guardCodeFromText(params.text)
  if (!code) {
    await sendMessage(params.token, params.chatId, inviteMessage())
    return false
  }

  const redeemed = await redeemGuardInviteCode({
    code,
    telegramId: params.telegramId,
    source: "bot",
    profile: {
      firstName: params.profile?.first_name || "",
      lastName: params.profile?.last_name || "",
      username: params.profile?.username || "",
      languageCode: params.profile?.language_code || "en",
    },
  })
  if (!redeemed.ok) {
    await sendMessage(params.token, params.chatId, `❌ ${redeemed.error || "Invalid invite code"}\n\n${inviteMessage()}`)
    return false
  }

  await sendMessage(params.token, params.chatId, `✅ Access activated.\n\n${helpMessage()}`)
  return true
}

function isGroupChat(chat: any) {
  return chat?.type === "group" || chat?.type === "supergroup"
}

function isGroupChatId(chatId: number | string) {
  return Number(chatId) < 0
}

async function botPermissions(telegramId: number, chatId: number | string) {
  if (isTelegramCaptureActive() && isGroupChatId(chatId)) {
    const chat = await getChatProfile(chatId)
    return {
      telegramId,
      chatId,
      isGroup: true,
      role: "admin" as const,
      profile: (chat?.profile || "management") as ChatProfile,
      configured: true,
      capture: true,
    }
  }
  return getBotPermissionContext({ telegramId, chatId, capture: isTelegramCaptureActive() })
}

async function requireCapability(token: string, context: BotPermissionContext, capability: BotCapability) {
  if (canUseBotCapability(context, capability)) return true
  await sendMessage(token, context.chatId, botPermissionDeniedMessage(context, capability))
  return false
}

function chatPrimaryCapability(context: BotPermissionContext): BotCapability {
  if (context.profile === "launch") return "launch"
  if (context.profile === "trade") return "trade"
  if (context.profile === "fee" || context.profile === "finance") return "finance"
  return context.role === "admin" ? "management" : "trade"
}

function aiPermissionPolicy(context: BotPermissionContext) {
  if (context.profile === "launch") return { capability: "launch" as const, dataScope: "launch" as const, allowedActionTypes: ["create_project", "update_project", "create_project_note", "create_reminder"] }
  if (context.profile === "trade" || context.role === "member") return { capability: "trade" as const, dataScope: "trade" as const, allowedActionTypes: ["update_project", "create_project_note", "create_reminder"] }
  if (context.profile === "finance") return { capability: "finance" as const, dataScope: "full" as const, allowedActionTypes: ["create_payroll"] }
  if (context.profile === "fee") return { capability: "finance" as const, dataScope: "full" as const, allowedActionTypes: ["none"] }
  return { capability: "management" as const, dataScope: "full" as const, allowedActionTypes: ["create_project", "update_project", "create_project_note", "create_reminder", "create_payroll", "add_sheet_row", "delete_project", "delete_reminder", "delete_payroll", "delete_sheet", "delete_sheet_row"] }
}

async function telegramUserIsChatAdmin(token: string, chatId: number | string, telegramId: number) {
  if (isTelegramCaptureActive()) return true
  if (!isGroupChatId(chatId)) return false
  const response = await telegramApiJson(token, "getChatMember", { chat_id: chatId, user_id: telegramId }).catch(() => null)
  return ["creator", "administrator"].includes(String(response?.result?.status || ""))
}

function profileAccessSummary(profile: ChatProfile) {
  return {
    launch: "launch schedule, launch calculator, natural-language launch management, and this chat's reminders",
    trade: "project operations, project notes, and this chat's reminders",
    fee: "receipt, fee, and consolidation review for admins",
    finance: "revenue summaries, profit, payroll, and reports for admins",
    management: "all bot functions for admins",
  }[profile]
}

async function prepareGuardEnrollment(token: string, chatId: number | string, telegramId: number, profile: ChatProfile, message?: any, rotate = false) {
  const chat = {
    id: chatId,
    title: message?.chat?.title || message?.chat?.username || String(chatId),
    username: message?.chat?.username || "",
    type: message?.chat?.type || "group",
  }
  const [link, synced, botUsername] = await Promise.all([
    createGuardEnrollmentLink({ chatId, chatTitle: chat.title, chatType: chat.type, profile, telegramId, rotate }),
    syncTelegramChatAdministrators({ token, chat }),
    getTelegramBotUsername(),
  ])
  return {
    link,
    synced,
    url: guardEnrollmentUrl(botUsername, String(link.token || "")),
  }
}

function chatTitle(message: any, chatId: number | string) {
  const chat = message?.chat
  if (chat?.title) return String(chat.title)
  if (chat?.username) return `@${chat.username}`
  const name = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ").trim()
  return name || (isGroupChatId(chatId) ? `Group ${chatId}` : "Direct message")
}

const GROUP_MENU_TEXTS = new Set([
  "🏠 Home",
  "📁 Projects",
  "🟡 Projects",
  "📈 Profit",
  "💸 Payroll",
  "📅 Calendar",
  "🟠 Calendar",
  "🚀 Launch Calc",
  "🔔 Reminders",
  "📝 Notes",
  "🧠 AI",
])

function isGroupMenuButton(text: string) {
  return GROUP_MENU_TEXTS.has(String(text || "").trim())
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function stripBotCommandSuffix(text: string) {
  return String(text || "").trim().replace(/^(\/\w+)@[\w]+\b/i, "$1")
}

function botCommandName(text: string) {
  const normalized = stripBotCommandSuffix(text)
  const match = normalized.match(/^\/([a-z0-9_]+)(?:\s|$)/i)
  return match?.[1]?.toLowerCase() || ""
}

function isBotCommand(text: string, ...names: string[]) {
  const command = botCommandName(text)
  return Boolean(command && names.includes(command))
}

function isSlashCommand(text: string, entities: any[] = []) {
  const normalized = stripBotCommandSuffix(text)
  if (!normalized.startsWith("/")) return false
  if (entities.some((entity) => entity.type === "bot_command" && entity.offset === 0)) return true
  return /^\/[a-z0-9_]+(?:@[\w]+)?(?:\s|$)/i.test(text)
}

function messageMentionsBot(text: string, entities: any[] = [], botUsername: string) {
  if (!botUsername) return false
  const lowerUsername = botUsername.toLowerCase()
  for (const entity of entities) {
    if (entity.type === "mention") {
      const mention = text.slice(entity.offset, entity.offset + entity.length).replace(/^@/, "").toLowerCase()
      if (mention === lowerUsername) return true
    }
    if (entity.type === "text_mention" && entity.user?.is_bot && String(entity.user.username || "").toLowerCase() === lowerUsername) {
      return true
    }
  }
  return new RegExp(`@${escapeRegex(botUsername)}(?:\\s|$)`, "i").test(text)
}

async function isReplyToBot(message: any, botUsername: string) {
  const reply = message?.reply_to_message
  if (!reply?.from?.is_bot) return false
  const replyUsername = String(reply.from.username || "").toLowerCase()
  if (botUsername && replyUsername === botUsername.toLowerCase()) return true
  if (!botUsername) return true
  const token = await getTelegramBotToken()
  if (!token) return false
  const payload = await telegramApiJson(token, "getMe", {})
  const botId = Number(payload?.result?.id || 0)
  return botId > 0 && Number(reply.from.id) === botId
}

function stripBotMention(text: string, entities: any[] = [], botUsername: string) {
  if (!botUsername) return text.trim()
  const lowerUsername = botUsername.toLowerCase()
  const mentionEntity = entities.find((entity) => {
    if (entity.type !== "mention") return false
    const mention = text.slice(entity.offset, entity.offset + entity.length).replace(/^@/, "").toLowerCase()
    return mention === lowerUsername
  })
  if (mentionEntity) {
    return `${text.slice(0, mentionEntity.offset)}${text.slice(mentionEntity.offset + mentionEntity.length)}`.trim()
  }
  return text.replace(new RegExp(`^@${escapeRegex(botUsername)}\\s*`, "i"), "").trim()
}

async function resolveGroupMessage(text: string, entities: any[] = [], message?: any) {
  const botUsername = await getTelegramBotUsername()
  const command = isSlashCommand(text, entities)
  const mention = messageMentionsBot(text, entities, botUsername)
  const menu = isGroupMenuButton(text)
  const reply = await isReplyToBot(message, botUsername)
  if (!command && !mention && !menu && !reply) {
    return { shouldRoute: false as const, routedText: "" }
  }
  const routedText = mention && !command ? stripBotMention(text, entities, botUsername) : text
  if (!routedText) return { shouldRoute: false as const, routedText: "" }
  return { shouldRoute: true as const, routedText }
}

async function hostGroupIfAllowed(chat: any, from: any) {
  if (!isGroupChat(chat) || !from?.id) return
  const configuredChat = await getChatProfile(chat.id)
  if (configuredChat?.profile) {
    await recordGuardChatMember({ chat, member: { status: "member", user: from }, source: "message_seen" })
  }
  const access = await getTeamAccess(Number(from.id))
  if (!access.allowed) return

  const now = new Date()
  const db = await getDb()
  await db.collection("opsHostedGroups").updateOne(
    { chatId: String(chat.id) },
    {
      $set: {
        chatId: String(chat.id),
        title: chat.title || chat.username || String(chat.id),
        type: chat.type,
        status: "active",
        hostedByTelegramId: Number(from.id),
        hostedByUsername: from.username || "",
        lastSeenAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
}

async function setState(telegramId: number, state: Record<string, any>, chatId: number | string) {
  const db = await getDb()
  await db.collection("opsBotStates").updateOne({ telegramId }, { $set: { telegramId, ...state, telegramChatId: String(chatId), updatedAt: new Date() } }, { upsert: true })
}

async function clearState(telegramId: number) {
  const db = await getDb()
  await db.collection("opsBotStates").deleteOne({ telegramId })
}

async function takeState(telegramId: number, chatId?: number | string) {
  const db = await getDb()
  const state = await db.collection("opsBotStates").findOne({ telegramId })
  if (state?.telegramChatId && chatId != null && String(state.telegramChatId) !== String(chatId)) return null
  const updatedAt = state?.updatedAt ? new Date(state.updatedAt).getTime() : 0
  if (state && updatedAt && Date.now() - updatedAt > 30 * 60 * 1000) {
    await db.collection("opsBotStates").deleteOne({ telegramId })
    return null
  }
  return state
}

async function finishState(
  token: string,
  chatId: number | string,
  telegramId: number,
  state: any,
  inboundMessage?: any,
  preserveMessageIds: Array<unknown> = [],
) {
  await clearState(telegramId)
  const preserve = new Set(preserveMessageIds.map(Number).filter(Boolean))
  const candidates = [state?.promptMessageId, telegramMessageId(inboundMessage)].filter((id) => !preserve.has(Number(id)))
  await deleteWorkflowMessages(token, chatId, candidates)
}

async function beginTextWorkflow(params: {
  token: string
  chatId: number | string
  telegramId: number
  state: Record<string, any>
  text: string
  reviewMessageId?: number | null
  buttons?: InlineButton[][]
}) {
  const messageId = await editOrSendWorkflowMessage(params.token, params.chatId, params.reviewMessageId, params.text, params.buttons)
  await setState(params.telegramId, {
    ...params.state,
    reviewMessageId: params.reviewMessageId || null,
    promptMessageId: messageId,
  }, params.chatId)
  return messageId
}

async function startOrganicChannelSetup(token: string, chatId: number | string, telegramId: number, tickerInput: unknown) {
  const inputParts = String(tickerInput || "").trim().split(/\s+/).filter(Boolean)
  const ticker = normalizeOrganicTicker(inputParts[0] || "")
  const suppliedProfileId = String(inputParts[1] || "").trim()
  if (!validOrganicTicker(ticker)) {
    await setState(telegramId, { action: "organic_setup_ticker" }, chatId)
    await sendMessage(token, chatId, "Send the token ticker only, without spaces.\n\nExample: SUMO\nSend /cancel to stop.")
    return
  }

  if (telegramUserAutomationConfigured()) {
    if (validSumoProfileId(suppliedProfileId)) {
      await queueOrganicSetup(token, chatId, telegramId, ticker, suppliedProfileId)
      return
    }
    await setState(telegramId, {
      action: "organic_auto_profile_id",
      ticker,
      startedAt: Date.now(),
    }, chatId)
    await sendMessage(token, chatId, [
      `📣 <b>Automated setup for $${ticker}</b>`,
      "",
      "Send the Sumo trading profile ID.",
      "Example: <code>67f9d846-8d06-47ed-b6e0-63380ed7d1d3</code>",
      "",
      "GhostBot will create the channel, apply the Sumo logo, add Sumo Bot as admin, create the invite, and return the ready-to-copy Sumo subscription command. It will not send the command automatically.",
    ].join("\n"))
    return
  }

  const botUsername = await getTelegramBotUsername()
  if (!botUsername) {
    await sendMessage(token, chatId, "⚠️ GhostBot's Telegram username is not configured, so I cannot build the channel setup link yet.")
    return
  }

  await setState(telegramId, {
    action: "organic_setup_awaiting_channel",
    ticker,
    startedAt: Date.now(),
  }, chatId)

  const title = organicChannelTitle(ticker)
  await sendMessage(token, chatId, [
    `📣 <b>Organic notifications setup for $${ticker}</b>`,
    "",
    "1. Create a new Telegram channel. A temporary name is fine.",
    "2. Tap <b>Add GhostBot</b> below and choose that channel.",
    "3. Tap <b>Add Sumo Bot</b> and choose the same channel.",
    "",
    `When GhostBot is added, I will rename it to <b>${title}</b>, capture the <code>-100…</code> channel ID, create the invite link, and ask you for the Sumo profile ID.`,
    "",
    "Set the channel photo to the black Sumo logo while Telegram is open. The logo image is not currently stored in GhostBot.",
  ].join("\n"), [[
    { text: "1 · Add GhostBot", url: ghostBotOrganicChannelUrl(botUsername) },
    { text: "2 · Add Sumo Bot", url: sumoBotChannelUrl() },
  ]])
}

async function queueOrganicSetup(
  token: string,
  sourceChatId: number | string,
  telegramId: number,
  ticker: string,
  profileId: string,
) {
  const queued = await queueOrganicChannelJob({
    ticker,
    profileId,
    sourceChatId: String(sourceChatId),
    requestedByTelegramId: telegramId,
  })
  await clearState(telegramId)
  if (queued.alreadyComplete) {
    await sendMessage(token, sourceChatId, organicChannelCompletionMessage(queued.job.inviteLink, queued.job.subscribeCommand))
    return
  }
  if (queued.requiresReview) {
    await sendMessage(token, sourceChatId, [
      `⚠️ <b>$${ticker} already has a partially created channel.</b>`,
      queued.job.channelBotApiId ? `Channel ID: <code>${queued.job.channelBotApiId}</code>` : "",
      "No new channel was created. An operator must review the existing channel before this setup can continue.",
    ].filter(Boolean).join("\n"))
    return
  }
  await sendMessage(token, sourceChatId, [
    queued.alreadyQueued ? "ℹ️ This setup is already queued." : `🚀 <b>$${ticker} setup queued</b>`,
    "",
    "The worker checks the queue every 10 seconds. Rolling safety limits may schedule it for later instead of creating channels in a burst.",
    queued.enabled && !queued.circuitOpen
      ? "When complete, it will return the invite link and ready-to-copy Sumo command here."
      : `Automated creation is currently paused${queued.circuitReason ? `: ${queued.circuitReason}` : "."}`,
    "Nothing will be posted to a client chat, and the Sumo command will not be sent automatically.",
  ].join("\n"))
}

async function handleOrganicChannelMembershipUpdate(token: string, update: any) {
  const chat = update?.chat
  const telegramId = Number(update?.from?.id || 0)
  const status = String(update?.new_chat_member?.status || "")
  if (chat?.type !== "channel" || !chat?.id || !telegramId || !["administrator", "creator"].includes(status)) return false

  const state = await takeState(telegramId)
  if (state?.action !== "organic_setup_awaiting_channel" || !validOrganicTicker(state.ticker)) return false
  const startedAt = Number(state.startedAt || 0)
  if (startedAt && Date.now() - startedAt > 24 * 60 * 60 * 1000) return false

  const ticker = normalizeOrganicTicker(state.ticker)
  const channelId = String(chat.id)
  const title = organicChannelTitle(ticker)
  const titleResult = await telegramApiJson(token, "setChatTitle", { chat_id: channelId, title })
  const inviteResult = await telegramApiJson(token, "createChatInviteLink", {
    chat_id: channelId,
    name: `${ticker} client invite`.slice(0, 32),
  })
  const inviteLink = String(inviteResult?.result?.invite_link || "")
  const sourceChatId = String(state.telegramChatId || telegramId)
  const now = new Date()
  const db = await getDb()
  await db.collection("organicTradeChannels").updateOne(
    { channelId },
    {
      $set: {
        channelId,
        ticker,
        title,
        inviteLink,
        setupStatus: "awaiting_profile_id",
        setupByTelegramId: telegramId,
        sourceChatId,
        titleConfigured: titleResult?.ok === true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  await setState(telegramId, {
    action: "organic_setup_profile_id",
    ticker,
    channelId,
    channelTitle: title,
    inviteLink,
    startedAt: state.startedAt || Date.now(),
  }, sourceChatId)

  await sendMessage(token, sourceChatId, [
    `✅ <b>Channel detected for $${ticker}</b>`,
    "",
    `Channel ID: <code>${channelId}</code>`,
    `Title: <b>${title}</b>${titleResult?.ok === true ? "" : "\n⚠️ I could not rename it. Give GhostBot permission to change channel info, then rename it manually."}`,
    inviteLink ? `Invite link: ${inviteLink}` : "⚠️ I could not create an invite link. Give GhostBot permission to invite subscribers, then create one manually.",
    "",
    "Now send the Sumo trading profile ID.",
    "Example: <code>67f9d846-8d06-47ed-b6e0-63380ed7d1d3</code>",
  ].join("\n"), [[{ text: "Add Sumo Bot", url: sumoBotChannelUrl() }]])
  return true
}

function money(value?: number) {
  return `$${Number(value || 0).toLocaleString()}`
}

function dateLabel(value?: string, timeZone = TEAM_TIME_ZONE) {
  if (!value) return "No date"
  const parsed = parseTeamDateTime(value, timeZone)
  if (parsed) return formatTeamDateTime(parsed, timeZone)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : formatTeamDateTime(date, timeZone)
}

function estDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function launchTargetPrompt(metric: LaunchTargetMetric, venueName: string) {
  return metric === "supply"
    ? `🎯 Enter the desired total supply control for ${venueName}.\n\nExample: 67.37%\n\nSend /cancel to stop.`
    : `🎯 Enter the desired launch market cap for ${venueName} in USD.\n\nExamples: $81.4K or 81400\n\nSend /cancel to stop.`
}

async function sendLaunchCalculatorStart(token: string, chatId: number | string, telegramId: number) {
  await clearState(telegramId)
  return sendMessage(token, chatId, "🚀 Launch capital calculator\n\nChoose the blockchain for this launch:", [
    ...LAUNCH_CHAINS.map((chain) => [{ text: chain.name, callback_data: `launch:chain:${chain.id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

async function sendLaunchVenuePicker(token: string, chatId: number | string, chainId: LaunchChainId) {
  const chain = LAUNCH_CHAINS.find((item) => item.id === chainId)
  const pads = padsForChain(chainId)
  if (!chain || !pads.length) return sendMessage(token, chatId, "No launch venues are configured for that chain yet.")
  return sendMessage(token, chatId, `Choose the ${chain.name} launchpad or DEX:`, [
    ...pads.map((pad) => [{ text: pad.name, callback_data: `launch:venue:${pad.id}` }]),
    [{ text: "⬅️ Chains", callback_data: "launch:start" }],
  ])
}

async function sendLaunchMetricPicker(token: string, chatId: number | string, venueId: string) {
  const pad = launchPad(venueId)
  if (!pad) return sendMessage(token, chatId, "That launch venue is not supported.")
  return sendMessage(token, chatId, `${pad.name}\n\nWhat should the calculator solve for?`, [
    [{ text: "🎯 Desired supply control", callback_data: `launch:metric:supply:${pad.id}` }],
    [{ text: "💵 Desired launch MC", callback_data: `launch:metric:market_cap:${pad.id}` }],
    [{ text: "⬅️ Venues", callback_data: `launch:chain:${pad.chainId}` }],
  ])
}

async function sendCalculatedLaunchQuote(
  token: string,
  chatId: number | string,
  telegramId: number,
  state: Record<string, any>,
  overrides: { target?: number; mmLiquidity?: number } = {},
) {
  const pad = launchPad(String(state.launchVenueId || ""))
  if (!pad) throw new Error("That launch venue is not supported.")
  const metric = String(state.launchMetric || "") as LaunchTargetMetric
  if (!(["supply", "market_cap"] as string[]).includes(metric)) throw new Error("Choose a target type first.")
  const target = overrides.target ?? Number(state.launchTarget)
  const mmLiquidity = overrides.mmLiquidity ?? (state.launchMmLiquidity == null ? undefined : Number(state.launchMmLiquidity))
  const valuation = await getLaunchAssetPrice(pad, { testFixtureOnly: isTelegramCaptureActive() })
  const quote = calculateLaunchQuote({
    venueId: pad.id,
    metric,
    target,
    assetPriceUsd: valuation.price,
    ...(pad.type === "amm" ? { initialLp: Number(state.launchInitialLp) } : {}),
    ...(mmLiquidity == null ? {} : { mmLiquidity }),
  })
  await setState(telegramId, {
    action: "launch_calc_result",
    launchVenueId: pad.id,
    launchMetric: metric,
    launchTarget: target,
    ...(pad.type === "amm" ? { launchInitialLp: quote.initialLp } : {}),
    launchMmLiquidity: quote.lines.find((line) => line.key === "mm")?.amount ?? defaultMmLiquidity(pad.id),
  }, chatId)
  return sendMessage(token, chatId, formatLaunchQuote(quote), [
    [{ text: "🎯 Change target", callback_data: "launch:adjust:target" }, { text: "💧 Change MM reserve", callback_data: "launch:adjust:mm" }],
    [{ text: "🆕 New launch quote", callback_data: "launch:start" }],
  ])
}

async function sendProjects(token: string, chatId: number | string) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).sort({ status: 1, updatedAt: -1 }).limit(8).toArray()
  const lines = projects.length
    ? projects.map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.status || "active"}${projectLaunchAt(p) ? ` - ${dateLabel(projectLaunchAt(p)!.toISOString())}` : ""}\nID: <code>${p._id}</code>`).join("\n\n")
    : "No projects yet."
  await sendMessage(token, chatId, `📁 Projects\n\n${lines}`, [
    [{ text: "➕ Add Project", callback_data: "project:add" }, { text: "📝 Notes", callback_data: "notes:project:all" }],
    ...projects.map((p: any) => [{ text: `Open ${p.name}`.slice(0, 60), callback_data: `project:view:${p._id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

async function sendProjectDetail(token: string, chatId: number | string, id: string) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: id })
  if (!project) return sendProjects(token, chatId)
  const sheets = await db.collection("opsSheets").find({ projectId: String(project._id) }).toArray()
  await sendMessage(token, chatId, formatOpsProjectDetails(project, sheets), [
    [{ text: "✏️ Edit", callback_data: `project:edit:${id}` }, { text: project.status === "active" ? "⏸ Deactivate" : project.status === "scheduled" || project.status === "in_progress" ? "🕒 Await Launch" : "▶️ Activate", callback_data: `project:toggle:${id}` }],
    [{ text: "📝 Notes", callback_data: `notes:project:${id}` }, { text: "🗑 Remove", callback_data: `project:delete:${id}` }],
    [{ text: "⬅️ Projects", callback_data: "projects:list" }],
  ])
}

async function sendProjectNotes(token: string, chatId: number | string, projectId?: string, messageId?: number | null) {
  const db = await getDb()
  const project = projectId && projectId !== "all" ? await db.collection("opsProjects").findOne({ _id: projectId }) : null
  const notes = await db.collection("opsProjectNotes")
    .find(project ? { projectId: String(project._id) } : {})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray()
  const lines = notes.length
    ? notes.map((note: any) => `• ${note.projectName} — ${note.authorName || "Team member"}${note.createdAt ? ` · ${dateLabel(note.createdAt)}` : ""}\n${note.text}`).join("\n\n")
    : "No notes yet."
  await editOrSendWorkflowMessage(token, chatId, messageId, `${project?.name ? `${project.name} Notes` : "Project Notes"}\n\n${lines}`, [
    ...(project ? [[{ text: "Add note", callback_data: `note:add:${project._id}` }]] : []),
    [{ text: "⬅️ Projects", callback_data: "projects:list" }],
  ])
}

async function sendDataProjects(token: string, chatId: number | string) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).sort({ updatedAt: -1 }).limit(10).toArray()
  await sendMessage(token, chatId, "📄 Choose a project to manage files.", [
    ...projects.map((p: any) => [{ text: p.name.slice(0, 60), callback_data: `data:project:${p._id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

async function sendProjectSheets(token: string, chatId: number | string, projectId: string) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  const sheets = await db.collection("opsSheets").find({ projectId }).sort({ updatedAt: -1 }).toArray()
  await sendMessage(token, chatId, `📄 Files${project?.name ? ` for ${project.name}` : ""}\n\n${sheets.length ? sheets.map((s: any) => `• ${s.title} (${s.sheetType || "custom"})`).join("\n") : "No files yet."}`, [
    [{ text: "➕ Add File", callback_data: `sheet:add:${projectId}` }],
    ...sheets.slice(0, 8).map((s: any) => [{ text: `Open ${s.title}`.slice(0, 60), callback_data: `sheet:view:${s._id}` }]),
    [{ text: "⬅️ Projects", callback_data: "data:list" }],
  ])
}

async function sendSheetDetail(token: string, chatId: number | string, sheetId: string) {
  const db = await getDb()
  const sheet = await db.collection("opsSheets").findOne({ _id: sheetId })
  if (!sheet) return sendDataProjects(token, chatId)
  const values = Array.isArray(sheet.values) ? sheet.values : []
  const preview = values.slice(1, 6).map((row: string[]) => `• ${row.filter(Boolean).slice(0, 3).join(" | ")}`).join("\n")
  await sendMessage(token, chatId, `📄 ${sheet.title}\n\nType: ${sheet.sheetType || "custom"}\nProject: ${sheet.projectName || "No project"}\nRows: ${Math.max(0, values.length - 1)}\n\n${preview || "No rows yet."}`, [
    [{ text: "➕ Add Row", callback_data: `sheet:addrow:${sheetId}` }, { text: "🗑 Remove File", callback_data: `sheet:delete:${sheetId}` }],
    [{ text: "⬅️ Files", callback_data: `data:project:${sheet.projectId || ""}` }],
  ])
}

async function sendReminders(token: string, chatId: number | string, messageId?: number | null) {
  const db = await getDb()
  const rows = await db.collection("opsReminders").find({ status: { $ne: "done" } }).sort({ dueAt: 1 }).toArray()
  const reminders = rows.filter((reminder: any) => reminder.deliveryScope === "chat" && String(reminder.telegramChatId || "") === String(chatId)).slice(0, 8)
  await editOrSendWorkflowMessage(token, chatId, messageId, `🔔 Reminders\n\n${reminders.length ? reminders.map((r: any, i: number) => `${i + 1}. ${r.title || r.message} - ${dateLabel(r.dueAt, String(r.timeZone || TEAM_TIME_ZONE))}${r.recurrence && r.recurrence !== "none" ? ` · ${r.recurrence}` : ""} · ${reminderTargetsLabel(r.targetMode, r.targetMembers)}${r.targetChatTitle ? ` → ${r.targetChatTitle}` : ""}`).join("\n") : "No reminders yet."}`, [
    [{ text: "➕ Add Reminder", callback_data: "reminder:add" }],
    ...reminders.map((r: any) => [{ text: `Open ${r.title || r.message}`.slice(0, 60), callback_data: `reminder:view:${r._id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

type ReminderDraft = Extract<ParsedReminderRequest, { ok: true }>

function reminderAudienceButtons(members: ReminderTarget[], selectedTargetIds: number[]) {
  const selected = new Set(selectedTargetIds)
  const memberButtons: InlineButton[][] = []
  for (let index = 0; index < members.length; index += 2) {
    memberButtons.push(members.slice(index, index + 2).map((member) => ({
      text: `${selected.has(member.telegramId) ? "✅" : "▫️"} ${member.displayName}`.slice(0, 32),
      callback_data: `reminderto:toggle:${member.telegramId}`,
    })))
  }
  return [
    [{ text: "Everyone", callback_data: "reminderto:everyone" }, { text: "Just me", callback_data: "reminderto:me" }],
    ...memberButtons.slice(0, 6),
    ...(selected.size ? [[{ text: `Save ${selected.size} selected`, callback_data: "reminderto:save" }]] : []),
    [{ text: "Cancel", callback_data: "reminderto:cancel" }],
  ]
}

async function showReminderAudiencePicker(
  token: string,
  chatId: number | string,
  messageId: number | null,
  selectedTargetIds: number[] = [],
  warning = "",
) {
  const members = await listReminderEligibleMembers(chatId)
  const selectedTargets = members.filter((member) => selectedTargetIds.includes(member.telegramId))
  const text = [
    warning ? `⚠️ ${warning}` : "👥 Who should be notified?",
    "",
    "The reminder will stay in this chat. Selected traders will be tagged when it fires.",
    ...(selectedTargets.length ? ["", `Selected: ${reminderTargetsLabel("specific", selectedTargets)}`] : []),
  ].join("\n")
  return editOrSendWorkflowMessage(token, chatId, messageId, text, reminderAudienceButtons(members, selectedTargetIds))
}

async function completeManualReminder(params: {
  token: string
  chatId: number | string
  telegramId: number
  draft: ReminderDraft
  targetMode: "everyone" | "creator" | "specific"
  targetMembers: ReminderTarget[]
  targetChatTitle: string
  workflowMessageId?: number | null
  state?: any
  inboundMessage?: any
}) {
  const db = await getDb()
  const now = new Date()
  const result = await db.collection("opsReminders").insertOne({
    title: params.draft.title,
    message: params.draft.message,
    dueAt: params.draft.dueAt,
    timeZone: params.draft.timeZone,
    recurrence: params.draft.recurrence,
    audience: "team",
    deliveryScope: "chat",
    telegramChatId: String(params.chatId),
    targetChatTitle: params.targetChatTitle,
    targetMode: params.targetMode,
    targetMembers: params.targetMembers,
    status: "scheduled",
    createdFrom: "bot",
    telegramId: params.telegramId,
    createdAt: now,
    updatedAt: now,
  })
  const confirmation = [
    "✅ Reminder set",
    "",
    `🔔 ${params.draft.title}`,
    `⏰ ${formatTeamDateTime(params.draft.dueAt, params.draft.timeZone)}`,
    ...(params.draft.recurrence !== "none" ? [`🔁 Repeats: ${params.draft.recurrence}`] : []),
    `👥 Notify: ${reminderTargetsLabel(params.targetMode, params.targetMembers)}`,
    `💬 Deliver to: ${params.targetChatTitle}`,
  ].join("\n")
  const confirmationMessageId = await editOrSendWorkflowMessage(params.token, params.chatId, params.workflowMessageId, confirmation, [
    [{ text: "Open reminder", callback_data: `reminder:view:${result.insertedId}` }],
    [{ text: "➕ Add another", callback_data: "reminder:add" }, { text: "⬅️ Reminders", callback_data: "reminders:list" }],
  ])
  if (params.state) {
    await finishState(params.token, params.chatId, params.telegramId, params.state, params.inboundMessage, confirmationMessageId ? [confirmationMessageId] : [])
  } else {
    await clearState(params.telegramId)
  }
  return result
}

function calendarDayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIME_ZONE, weekday: "long", month: "short", day: "numeric" }).format(new Date(`${dateKey}T12:00:00Z`))
}

function calendarTimeLabel(value: Date) {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(value)} ET`
}

function calendarLaunchLocation(project: any) {
  const chain = String(project.chain || project.revenueChain || "").toLowerCase()
  const chainLabel = chain === "solana" ? "Solana"
    : chain === "robinhood" ? "Robinhood"
      : chain === "bnb" ? "BNB Chain"
        : chain === "ethereum" ? "Ethereum"
          : chain === "base" ? "Base"
            : "Chain TBD"
  const venue = (operationalLaunchVenue(project.launchVenue)?.name || String(project.launchVenueLabel || ""))
    ?.replace(/^Uniswap\s+/i, "Uni ")
    .replace(/\s*\(full range\)$/i, "")
  return venue ? `${chainLabel}/${venue}` : chainLabel
}

async function calendarRows(requestedDateKey?: string) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({ status: { $ne: "inactive" } }).toArray()
  const today = dateKeyInTimeZone(new Date(), TEAM_TIME_ZONE)
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDateKey || "")) ? String(requestedDateKey) : today
  const launches = projects
    .map((project: any) => ({ project, dateKey: projectLaunchDateKey(project, TEAM_TIME_ZONE), launchAt: projectLaunchAt(project) }))
    .filter((row: any) => row.dateKey === targetDate)
    .sort((a: any, b: any) => a.launchAt && b.launchAt ? a.launchAt.getTime() - b.launchAt.getTime() : a.launchAt ? -1 : b.launchAt ? 1 : String(a.project.name || "").localeCompare(String(b.project.name || "")))
  return { launches, targetDate, today }
}

async function sendCalendar(token: string, chatId: number | string, requestedDateKey?: string, messageId?: number | null) {
  const { launches, targetDate, today } = await calendarRows(requestedDateKey)
  const launchLines = launches.map(({ project, launchAt }: any) => {
    const timing = launchAt ? calendarTimeLabel(launchAt) : "TBD"
    const location = calendarLaunchLocation(project)
    const method = normalizeLaunchMethod(project.launchMethod) ? ` · ${launchMethodLabel(project.launchMethod)}` : ""
    return `${timing} — ${project.name} · ${location}${method}`
  })
  const buttons: InlineButton[][] = launches.length
    ? [[{ text: "Open launches", callback_data: `calendar:edit:${targetDate}` }]]
    : []
  const header = targetDate === today ? `Today’s Launches — ${calendarDayLabel(targetDate)}` : `Launches — ${calendarDayLabel(targetDate)}`
  const text = `${header}\n\n${launchLines.length ? launchLines.join("\n") : "No launches scheduled."}`
  if (messageId) {
    const edited = await editTelegramMessage(token, chatId, messageId, text, { replyMarkup: { inline_keyboard: buttons } })
    if (edited) return
  }
  await sendMessage(token, chatId, text, buttons.length ? buttons : undefined)
}

async function showCalendarLaunchEditor(token: string, chatId: number | string, project: any, messageId?: number | null, notice = "") {
  const db = await getDb()
  const id = String(project._id)
  const scheduleVersion = Number(project.scheduleVersion || 0)
  const dateKey = projectLaunchDateKey(project, TEAM_TIME_ZONE) || dateKeyInTimeZone(new Date(), TEAM_TIME_ZONE)
  const launchAt = projectLaunchAt(project)
  const location = calendarLaunchLocation(project)
  const method = normalizeLaunchMethod(project.launchMethod) ? ` · ${launchMethodLabel(project.launchMethod)}` : ""
  const timing = launchAt ? calendarTimeLabel(launchAt) : "TBD"
  const timingStatus = projectLaunchTimingStatus(project)
  const scheduled = ["scheduled", "in_progress"].includes(String(project.status || ""))
  const notes = await db.collection("opsProjectNotes").find({ projectId: id }).sort({ createdAt: -1 }).limit(6).toArray()
  const noteLines = notes.map((note: any) => {
    const noteText = String(note.text || "").trim().replace(/\s*\n\s*/g, " ").slice(0, 350)
    return `• ${noteText}${note.authorName ? ` — ${note.authorName}` : ""}`
  })
  const buttons: InlineButton[][] = !scheduled
    ? []
    : timingStatus === "tentative"
      ? [
        [{ text: "Set exact time", callback_data: `lifecycle:settime:${id}:${scheduleVersion}` }],
        [{ text: "Move day", callback_data: `lifecycle:tentativeday:${id}:${scheduleVersion}` }],
      ]
      : [
        [{ text: "Change date or time", callback_data: `lifecycle:delay:${id}:${scheduleVersion}` }],
        [{ text: "Make time TBD / move day", callback_data: `lifecycle:tentativeday:${id}:${scheduleVersion}` }],
      ]
  buttons.push([{ text: "Change launch venue / DEX", callback_data: `calendar:venue:${id}:${scheduleVersion}` }])
  buttons.push([{ text: "Add note", callback_data: `calendar:addnote:${id}:${scheduleVersion}` }])
  if (scheduled) buttons.push([{ text: "Cancel launch", callback_data: `lifecycle:cancel:${id}:${scheduleVersion}` }])
  buttons.push([{ text: "Back to launches", callback_data: `calendar:edit:${dateKey}` }])
  const status = String(project.status || "scheduled").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())
  const text = [
    notice,
    `${project.name}\n${timing} · ${location}${method}\n${status}`,
    `Notes\n${noteLines.length ? noteLines.join("\n") : "No notes yet."}`,
  ].filter(Boolean).join("\n\n")
  return showLaunchSetupPicker(token, chatId, messageId, text, buttons)
}

async function acknowledgeTentativeLaunches(token: string, chatId: number | string, telegramId: number, dateKey: string, messageId?: number | null) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({ status: { $in: ["scheduled", "in_progress"] } }).toArray()
  const tentative = projects.filter((project: any) => projectLaunchTimingStatus(project) === "tentative"
    && projectLaunchDateKey(project, TEAM_TIME_ZONE) === dateKey
    && (!project.launchChatId || String(project.launchChatId) === String(chatId)))
  const now = new Date()
  for (const project of tentative) {
    await db.collection("opsProjects").updateOne(
      { _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion },
      { $set: { tentativeTimingAcknowledgedDate: dateKey, tentativeTimingAcknowledgedAt: now, tentativeTimingAcknowledgedByTelegramId: telegramId, updatedAt: now } },
    )
  }
  const names = tentative.map((project: any) => project.name || "Unnamed project")
  const text = names.length
    ? `Still TBD confirmed for today: ${names.join(", ")}.\n\nUse Edit launches if a time, day, or venue changes.`
    : "There are no longer any TBD launches scheduled for this day."
  const buttons: InlineButton[][] = names.length ? [[{ text: "Edit launches", callback_data: `calendar:edit:${dateKey}` }]] : []
  if (messageId) {
    const edited = await editTelegramMessage(token, chatId, messageId, text, { replyMarkup: { inline_keyboard: buttons } })
    if (edited) return
  }
  return sendMessage(token, chatId, text, buttons.length ? buttons : undefined)
}

async function sendPayroll(token: string, chatId: number | string) {
  const db = await getDb()
  const rows = await db.collection("opsPayroll").find({ status: { $ne: "paid" } }).sort({ date: -1 }).limit(8).toArray()
  await sendMessage(token, chatId, `💸 Payroll\n\n${rows.length ? rows.map((r: any) => `• ${r.member}: ${money(r.amount)} ${r.project ? `- ${r.project}` : ""} (${r.status || "pending"})`).join("\n") : "No pending payroll rows."}`, [
    [{ text: "➕ Add Payroll Row", callback_data: "payroll:add" }],
    ...rows.map((r: any) => [{ text: `Mark paid: ${r.member}`.slice(0, 60), callback_data: `payroll:paid:${r._id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

async function sendPayrollReport(token: string, chatId: number | string, text: string, req: NextRequest) {
  const date = parseReportDateFromText(text)
  void sendChatAction(token, chatId, "upload_photo")
  const loadingMessageId = await sendTelegramMessage(token, chatId, "📊 Rendering payroll sheet…")

  try {
    const report = await loadDailyPayrollReport(date)
    if (!report) {
      const message = `No payroll saved for ${date}.\n\nLog the day in the dashboard first, then try /report again.`
      if (loadingMessageId) {
        await telegramApi(token, "editMessageText", {
          chat_id: chatId,
          message_id: loadingMessageId,
          text: message,
        })
      } else {
        await sendMessage(token, chatId, message)
      }
      return
    }

    const png = await renderPayrollReportPng(report)
    const caption = `GHOST DAILY INCOME + EXPENSES · ${report.displayDate}`

    if (loadingMessageId) {
      await telegramApi(token, "deleteMessage", { chat_id: chatId, message_id: loadingMessageId }).catch(() => null)
    }
    const sent = await sendTelegramPhoto(token, chatId, png, caption)
      || await sendTelegramDocument(token, chatId, png, caption, `ghost-payroll-${date}.png`)
    if (sent) return

    const previewUrl = `${appBaseUrl(req)}/api/ops/payroll/report?date=${encodeURIComponent(date)}&format=html`
    const fallback = [
      `📊 Payroll breakdown for ${date}`,
      "",
      "Could not upload the image to Telegram.",
      "",
      `Open preview: ${previewUrl}`,
    ].join("\n")

    if (loadingMessageId) {
      await telegramApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: loadingMessageId,
        text: fallback,
        disable_web_page_preview: false,
      })
    } else {
      await sendMessage(token, chatId, fallback)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not render payroll report."
    if (loadingMessageId) {
      await telegramApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: loadingMessageId,
        text: `⚠️ ${message}`,
      })
    } else {
      await sendMessage(token, chatId, `⚠️ ${message}`)
    }
  }
}

async function logProjectIncome(token: string, chatId: number | string, text: string) {
  const parsed = parseIncomeLogCommand(text)
  if ("error" in parsed) {
    return sendMessage(token, chatId, parsed.error || "Invalid income command.")
  }
  const { projectId, isTrading, miscCategory, amount } = parsed

  const db = await getDb()
  const project = projectId ? await db.collection("opsProjects").findOne({ _id: projectId }) : null
  if (projectId && !project) return sendMessage(token, chatId, "Project ID was not found.")
  const date = estDateKey()
  const existing = await db.collection("dailyPayrollEntries").findOne({ date })
  const inputs = existing?.inputs || {}
  const clientIncome = Array.isArray(inputs.clientIncome) ? [...inputs.clientIncome] : []
  const devAllocations = Array.isArray(inputs.devAllocations) ? [...inputs.devAllocations] : []
  if (isTrading) clientIncome.push({ projectId, incomeType: "trading", income: amount })
  else devAllocations.push({ projectId: projectId || undefined, category: miscCategory, income: amount })

  const result = await savePayrollDay({
    date,
    notes: existing?.notes || "",
    teamPayroll: Array.isArray(inputs.teamPayroll) ? inputs.teamPayroll : [],
    clientIncome,
    devAllocations,
    rules: inputs.rules || {},
  })
  const referral = isTrading
    ? result.entry.calculation.referrals.filter((row: any) => row.clientAccountId === projectId).slice(-1)[0]
    : null
  const typeLabel = isTrading ? "Trading Income" : miscIncomeCategoryLabel(miscCategory)
  await sendMessage(token, chatId, [
    "✅ Income logged",
    "",
    project ? `Project: ${project.name}` : `Category: ${typeLabel}`,
    `Type: ${typeLabel}`,
    `Amount: ${money(amount)}`,
    referral ? `Referrer: ${referral.referrerName} - ${money(referral.amount)}` : "",
  ].filter(Boolean).join("\n"))
}

async function buildAiOptions(telegramId: number, chatId: number | string, message?: any, context?: BotPermissionContext): Promise<OpsAiOptions> {
  const messageTimestamp = Number(message?.date || message?.edit_date || 0) * 1000
  const referenceTime = messageTimestamp > 0 ? new Date(messageTimestamp) : new Date()
  const policy = aiPermissionPolicy(context || await botPermissions(telegramId, chatId))
  return {
    chatId,
    chatTitle: chatTitle(message, chatId),
    conversation: await buildConversationContext(telegramId, chatId, message),
    referenceTime: referenceTime.toISOString(),
    requestTimeZone: await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE,
    dataScope: policy.dataScope,
    allowedActionTypes: policy.allowedActionTypes,
  }
}

async function maybeProposeAction(text: string, telegramId: number, aiOptions: OpsAiOptions) {
  try {
    return await proposeOpsAiAction(text, telegramId, aiOptions)
  } catch (error) {
    console.error("[ops-ai] capability planner failed:", error instanceof Error ? error.message : error)
    return null
  }
}

async function sendAiResponse(token: string, chatId: number | string, telegramId: number, text: string, message?: any, permissionContext?: BotPermissionContext) {
  const context = permissionContext || await botPermissions(telegramId, chatId)
  const policy = aiPermissionPolicy(context)
  if (!(await requireCapability(token, context, policy.capability))) return
  if (await maybeRequestReminderTimeZone(token, chatId, telegramId, text)) return
  const aiOptions = await buildAiOptions(telegramId, chatId, message, context)
  await sendAsyncResponse(token, chatId, async () => {
    const proposed = await maybeProposeAction(text, telegramId, aiOptions)
    if (proposed) {
      return {
        text: proposed.message,
        inline: proposed.buttons || (proposed.actionId ? [
          [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
        ] : undefined),
      }
    }
    if (policy.dataScope === "launch") return { text: /\bnotes?\b/i.test(text) ? await answerProjectNotes(text) : "I can add, update, reschedule, cancel, or add notes to launches here. Use /calendar to view the schedule or /launchcalc for launch math. Financial questions are unavailable in this chat." }
    if (policy.dataScope === "trade") return { text: "I can update project operations, add project notes, and create one-time or recurring reminders for this Trade Floor. Financial and revenue questions are unavailable here." }
    if (context.profile === "fee") return { text: "Use receipt and fee messages in this chat to classify revenue, match expectations, or review consolidations." }
    return { text: await answerOpsAi(text, telegramId, aiOptions) }
  }, "🧠 Working on it…")
}

function aiCommandText(text: string) {
  const match = String(text || "").trim().match(/^\/ai(?:@\w+)?(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return String(match[1] || "").trim()
}

async function processState(token: string, chatId: number | string, telegramId: number, text: string, messageDateMs: number, message?: any, permissionContext?: BotPermissionContext) {
  const state = await takeState(telegramId, chatId)
  if (!state) return false
  const db = await getDb()
  const now = new Date()
  const context = permissionContext || await botPermissions(telegramId, chatId)

  if (text === "⬅️ Back" || text === "/cancel") {
    const reviewMessageId = Number(state.reviewMessageId || 0) || null
    if (String(state.action || "").startsWith("launch_setup") && state.actionId && reviewMessageId) {
      const draft = await getLaunchSetupAction(db, String(state.actionId), telegramId, chatId)
      await finishState(token, chatId, telegramId, state, message, [reviewMessageId])
      if (draft.ok) await showLaunchSetupReview(token, chatId, draft.action, reviewMessageId, "Edit cancelled.")
      else await editOrSendWorkflowMessage(token, chatId, reviewMessageId, "Edit cancelled.")
      return true
    }
    const resolvedMessageId = reviewMessageId || Number(state.promptMessageId || 0) || null
    if (resolvedMessageId) await editOrSendWorkflowMessage(token, chatId, resolvedMessageId, "Cancelled.")
    await finishState(token, chatId, telegramId, state, message, resolvedMessageId ? [resolvedMessageId] : [])
    if (!resolvedMessageId) await sendMessage(token, chatId, "Cancelled.")
    return true
  }

  const stateCapability: BotCapability = String(state.action || "").startsWith("launch_calc") || String(state.action || "").startsWith("launch_setup") || String(state.action || "").startsWith("add_launch_wizard") || String(state.action || "").startsWith("organic_setup") || state.action === "schedule_launch_request" || state.action === "reschedule_launch" || state.action === "tentative_launch_day" || state.action === "add_launch_note"
    ? "launch"
    : ["add_project", "edit_project", "add_reminder", "reminder_audience", "timezone_for_manual_reminder", "timezone_for_reminder"].includes(String(state.action || ""))
      ? (context.profile === "launch" ? "launch" : "trade")
      : ["add_project_note", "add_sheet_row"].includes(String(state.action || ""))
        ? "trade"
      : ["fee_project_search", "receipt_classification", "receipt_expectation", "add_payroll"].includes(String(state.action || ""))
        ? "finance"
        : chatPrimaryCapability(context)
  if (!(await requireCapability(token, context, stateCapability))) {
    await clearState(telegramId)
    return true
  }

  if (state.action === "add_launch_wizard_name") {
    const name = cleanLaunchProjectName(text).slice(0, 80)
    if (!name || !/[a-z0-9]/i.test(name)) {
      await setState(telegramId, state, chatId)
      await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || 0) || null, "Send the exact project name.\n\nExample: Pathelous\nSend /cancel to stop.")
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    const timeZone = await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE
    await setState(telegramId, { ...state, action: "add_launch_wizard_timing", name, timeZone, defaultLaunchDate: dateKeyInTimeZone(now, timeZone) }, chatId)
    await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || 0) || null, `When is ${name} launching?\n\nExamples: today at 4 PM ET · tomorrow at noon · Thursday at 3:30 PM\nFor an unknown time: today TBD\nSend /cancel to stop.`)
    await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
    return true
  }

  if (state.action === "add_launch_wizard_timing") {
    const timeZone = detectExplicitTimeZone(text) || String(state.timeZone || TEAM_TIME_ZONE)
    const tentative = /\b(?:tbd|time\s+(?:unknown|tentative|not\s+set)|no\s+exact\s+time)\b/i.test(text)
    let launchAt: string | null = null
    let tentativeLaunchDate: string | null = null
    if (tentative) {
      tentativeLaunchDate = parseNaturalTeamDate(text, timeZone, now) || state.defaultLaunchDate || null
    } else {
      const parsed = parseContextualTeamDateTime(text, { timeZone, now, defaultDate: state.defaultLaunchDate })
      if (parsed.date) launchAt = parsed.date.toISOString()
      else {
        const nextState = parsed.issue === "missing_time" && parsed.resolvedDateKey ? { ...state, defaultLaunchDate: parsed.resolvedDateKey } : state
        await setState(telegramId, nextState, chatId)
        const error = parsed.issue === "ambiguous_meridiem"
          ? "Is that AM or PM? Send “4 PM” or use 24-hour time such as “16:00”."
          : parsed.issue === "missing_time"
            ? `I understood the day as ${calendarDayLabel(parsed.resolvedDateKey || String(state.defaultLaunchDate))}. What time should it launch?`
            : "I could not read that timing. Try “today at 4 PM ET”, “tomorrow at noon”, or “today TBD”."
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || 0) || null, `${error}\n\nSend /cancel to stop.`)
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
    }
    if (!launchAt && !tentativeLaunchDate) {
      await setState(telegramId, state, chatId)
      await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || 0) || null, "I could not read that launch day. Try “today at 4 PM ET”, “tomorrow at noon”, or “today TBD”.\n\nSend /cancel to stop.")
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    const draft = await createGuidedLaunchDraft(db, { telegramId, chatId, name: String(state.name), launchAt, tentativeLaunchDate, timeZone })
    const promptMessageId = Number(state.promptMessageId || 0) || null
    await finishState(token, chatId, telegramId, state, message, promptMessageId ? [promptMessageId] : [])
    await showLaunchSetupPicker(token, chatId, promptMessageId, `Choose the chain for ${String(state.name)}:`, [
      ...launchChainButtons(String(draft._id)),
      [{ text: "Cancel", callback_data: `launchsetup:cancel:${draft._id}` }],
    ])
    return true
  }

  if (state.action === "schedule_launch_request") {
    await clearState(telegramId)
    await sendAiResponse(token, chatId, telegramId, text, message, context)
    return true
  }

  if (state.action === "organic_setup_ticker") {
    const inputParts = String(text || "").trim().split(/\s+/).filter(Boolean)
    const ticker = normalizeOrganicTicker(inputParts[0] || "")
    if (!validOrganicTicker(ticker)) {
      await setState(telegramId, state, chatId)
      await sendMessage(token, chatId, "Send a ticker using up to 20 letters, numbers, dots, dashes, or underscores.\n\nExample: SUMO\nSend /cancel to stop.")
      return true
    }
    await startOrganicChannelSetup(token, chatId, telegramId, inputParts.join(" "))
    return true
  }

  if (state.action === "organic_auto_profile_id") {
    const profileId = String(text || "").trim()
    if (!validSumoProfileId(profileId)) {
      await setState(telegramId, state, chatId)
      await sendMessage(token, chatId, "That does not look like a Sumo profile ID. Send the full UUID, for example:\n<code>67f9d846-8d06-47ed-b6e0-63380ed7d1d3</code>\n\nSend /cancel to stop.")
      return true
    }
    await queueOrganicSetup(token, chatId, telegramId, normalizeOrganicTicker(state.ticker), profileId)
    return true
  }

  if (state.action === "organic_setup_awaiting_channel") {
    await setState(telegramId, state, chatId)
    await sendMessage(token, chatId, "I am waiting for you to add GhostBot as an administrator to the new channel. Use the <b>Add GhostBot</b> button from the setup message, or send /cancel to stop.")
    return true
  }

  if (state.action === "organic_setup_profile_id") {
    const profileId = String(text || "").trim()
    if (!validSumoProfileId(profileId)) {
      await setState(telegramId, state, chatId)
      await sendMessage(token, chatId, "That does not look like a Sumo profile ID. Send the full UUID, for example:\n<code>67f9d846-8d06-47ed-b6e0-63380ed7d1d3</code>\n\nSend /cancel to stop.")
      return true
    }

    const channelId = String(state.channelId || "")
    const ticker = normalizeOrganicTicker(state.ticker)
    const inviteLink = String(state.inviteLink || "")
    const command = sumoSubscribeCommand(channelId, profileId)
    const administrators = await telegramApiJson(token, "getChatAdministrators", { chat_id: channelId, return_bots: true })
    const sumoIsAdmin = Array.isArray(administrators?.result) && administrators.result.some((member: any) =>
      String(member?.user?.username || "").toLowerCase() === SUMO_TRADE_BOT_USERNAME,
    )
    const now = new Date()
    const db = await getDb()
    await db.collection("organicTradeChannels").updateOne(
      { channelId },
      {
        $set: {
          ticker,
          profileId,
          subscribeCommand: command,
          inviteLink,
          sumoIsAdmin,
          setupStatus: "ready_to_subscribe",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
    await clearState(telegramId)
    const completion = organicChannelCompletionMessage(inviteLink || "Create an invite link in the notification channel manually.", command)
    await sendMessage(token, chatId, [completion, ...(
      sumoIsAdmin ? [] : ["", "⚠️ I could not verify Sumo Bot as an administrator. Add it before sending the command."]
    )].join("\n"), [
      [{ text: "Open Sumo Bot", url: `https://t.me/${SUMO_TRADE_BOT_USERNAME}` }, { text: "Add / verify Sumo admin", url: sumoBotChannelUrl() }],
      ...(inviteLink ? [[{ text: "Open notification channel", url: inviteLink }]] : []),
    ])
    return true
  }

  if (["launch_setup_name", "launch_setup_referrer", "launch_setup_refpct", "launch_setup_exact_time", "launch_setup_tentative_day", "launch_setup_custom_quote"].includes(String(state.action || ""))) {
    const draft = await getLaunchSetupAction(db, String(state.actionId || ""), telegramId, chatId)
    if (!draft.ok) {
      await finishState(token, chatId, telegramId, state, message)
      await sendMessage(token, chatId, `⚠️ ${draft.error}`)
      return true
    }
    let action = draft.action
    if (state.action === "launch_setup_custom_quote") {
      const parsed = parseCustomQuoteTokenInput(text)
      try {
        const customQuote = await resolveCustomQuoteToken(action.payload?.chain, parsed.symbol, parsed.address)
        action = await updateLaunchSetupAction(db, action, {
          ...customQuote,
          quoteAssets: [customQuote.quoteToken],
          dailyTradingFeeEnabled: true,
          dailyTradingFeeUsd: Number(action.payload?.dailyTradingFeeUsd || 500),
          launchFeeUsd: Number(action.payload?.launchFeeUsd || 1000),
          feeConfigurationConfirmed: Boolean(action.payload?.chain),
        })
        const reviewMessageId = Number(state.reviewMessageId || 0) || null
        await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
        if (action.guidedWizard) {
          await showLaunchSetupPicker(token, chatId, reviewMessageId, `Choose the launch method for ${String(action.payload?.name || "this launch")}:`, [
            ...launchMethodButtons(String(action._id)),
            [{ text: "Back to review", callback_data: `launchsetup:review:${action._id}` }],
          ])
        } else await showLaunchSetupReview(token, chatId, action, reviewMessageId, `${customQuote.quoteToken} verified from its contract.`)
      } catch (error) {
        await setState(telegramId, state, chatId)
        const detail = error instanceof Error ? error.message : "I could not verify that token."
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, `${detail}\n\nSend: SYMBOL | contract address\nExample: AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9\nSend /cancel to stop.`)
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      }
      return true
    }
    if (state.action === "launch_setup_exact_time") {
      const timeZone = detectExplicitTimeZone(text) || String(state.timeZone || action.payload?.launchTimeZone || TEAM_TIME_ZONE)
      if (/\b(?:tbd|time\s+(?:unknown|tentative|not\s+set)|no\s+exact\s+time)\b/i.test(text)) {
        const tentativeLaunchDate = parseNaturalTeamDate(text, timeZone, now)
          || String(state.defaultLaunchDate || state.tentativeLaunchDate || projectLaunchDateKey(action.payload, timeZone) || dateKeyInTimeZone(now, timeZone))
        action = await updateLaunchSetupAction(db, action, { launchAt: null, launchDate: null, tentativeLaunchDate, launchTimingStatus: "tentative", launchTimeZone: timeZone, status: "scheduled" })
        const reviewMessageId = Number(state.reviewMessageId || 0) || null
        await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
        await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Launch time changed to TBD. The launch day was kept.")
        return true
      }
      const parsed = parseContextualTeamDateTime(text, {
        timeZone,
        now,
        defaultDate: state.defaultLaunchDate || state.tentativeLaunchDate || action.payload?.tentativeLaunchDate || action.payload?.launchAt,
        defaultTime: state.defaultLaunchAt || action.payload?.launchAt,
      })
      if (!parsed.date) {
        const nextState = parsed.issue === "missing_time" && parsed.resolvedDateKey ? { ...state, defaultLaunchDate: parsed.resolvedDateKey } : state
        await setState(telegramId, nextState, chatId)
        const error = parsed.issue === "ambiguous_meridiem"
          ? "Is that AM or PM? Send “3 PM” or use 24-hour time such as “15:00”."
          : parsed.issue === "missing_time"
            ? `I understood the day as ${calendarDayLabel(parsed.resolvedDateKey || dateKeyInTimeZone(now, parsed.timeZone))}. What time should it launch?`
            : parsed.issue === "invalid_local_time"
              ? `That local time does not exist in ${teamZoneLabel(parsed.timeZone)}, likely because of a daylight-saving change. Send another time.`
              : "I could not read that timing. Try “12:30 PM ET”, “tomorrow at 2 PM”, or “Thursday at noon”."
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, `${error}\n\nSend /cancel to stop.`)
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      action = await updateLaunchSetupAction(db, action, { launchAt: parsed.date.toISOString(), launchDate: parsed.date.toISOString(), tentativeLaunchDate: null, launchTimingStatus: "confirmed", launchTimeZone: parsed.timeZone, status: "scheduled" })
      const reviewMessageId = Number(state.reviewMessageId || 0) || null
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Exact launch time updated.")
      return true
    }
    if (state.action === "launch_setup_tentative_day") {
      const timeZone = detectExplicitTimeZone(text) || String(state.timeZone || action.payload?.launchTimeZone || TEAM_TIME_ZONE)
      const tentativeLaunchDate = parseNaturalTeamDate(text, timeZone, now)
      if (!tentativeLaunchDate) {
        await setState(telegramId, state, chatId)
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, "I could not read that launch day. Send today, tomorrow, a calendar date, or YYYY-MM-DD. Send /cancel to stop.")
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      action = await updateLaunchSetupAction(db, action, { launchAt: null, launchDate: null, tentativeLaunchDate, launchTimingStatus: "tentative", launchTimeZone: timeZone, status: "scheduled" })
      const reviewMessageId = Number(state.reviewMessageId || 0) || null
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Tentative launch day updated. Exact time can be added later.")
      return true
    }
    if (state.action === "launch_setup_name") {
      const name = cleanLaunchProjectName(text).slice(0, 80)
      if (!name) {
        await setState(telegramId, state, chatId)
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, "Send a project name with at least one letter or number. Send /cancel to stop.")
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      action = await updateLaunchSetupAction(db, action, { name })
      const reviewMessageId = Number(state.reviewMessageId || 0) || null
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Project name updated.")
      return true
    }
    if (state.action === "launch_setup_referrer") {
      const [name = "", percentageText = ""] = text.split("|").map((part) => part.trim())
      const percentage = Number(percentageText)
      if (!name || !(percentage > 0 && percentage <= 100)) {
        await setState(telegramId, state, chatId)
        await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, "Send: Referrer name | Percentage\n\nExample: BK | 20\nSend /cancel to stop.")
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      action = await updateLaunchSetupAction(db, action, { referrer: name.slice(0, 80), referrerWallet: "", referrerAccountId: null, referralPercentage: percentage, referrerStatus: "assigned" })
      const reviewMessageId = Number(state.reviewMessageId || 0) || null
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Referrer updated.")
      return true
    }
    const percentage = Number(String(text).replace(/%/g, "").trim())
    if (!(percentage > 0 && percentage <= 100)) {
      await setState(telegramId, state, chatId)
      await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, "Send a referral percentage from 1 to 100. Send /cancel to stop.")
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    action = await updateLaunchSetupAction(db, action, { referralPercentage: percentage, referrerStatus: "assigned" })
    const reviewMessageId = Number(state.reviewMessageId || 0) || null
    await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
    await showLaunchSetupReview(token, chatId, action, reviewMessageId, "Referral percentage updated.")
    return true
  }

  if (state.action === "reschedule_launch") {
    const timeZone = detectExplicitTimeZone(text) || String(state.timeZone || await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE)
    if (/\b(?:tbd|time\s+(?:unknown|tentative|not\s+set)|no\s+exact\s+time)\b/i.test(text)) {
      const tentativeLaunchDate = parseNaturalTeamDate(text, timeZone, now)
        || String(state.defaultLaunchDate || dateKeyInTimeZone(now, timeZone))
      const result = await setTentativeProjectLaunchDate({ projectId: String(state.projectId), tentativeLaunchDate, telegramId, chatId, timeZone, expectedScheduleVersion: Number(state.scheduleVersion) })
      if (!result.ok) {
        await sendMessage(token, chatId, `⚠️ ${result.error}`)
        return true
      }
      const resolvedText = `✅ ${(result.project as any).name} is tentative\n${tentativeLaunchDate} · Time TBD`
      const reviewMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
      await editOrSendWorkflowMessage(token, chatId, reviewMessageId, resolvedText)
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      return true
    }
    const parsed = parseContextualTeamDateTime(text, {
      timeZone,
      now,
      defaultDate: state.defaultLaunchDate,
      defaultTime: state.defaultLaunchAt,
    })
    if (!parsed.date) {
      const nextState = parsed.issue === "missing_time" && parsed.resolvedDateKey ? { ...state, defaultLaunchDate: parsed.resolvedDateKey } : state
      await setState(telegramId, nextState, chatId)
      const error = parsed.issue === "ambiguous_meridiem"
        ? "Is that AM or PM? Send “3 PM” or use 24-hour time such as “15:00”."
        : parsed.issue === "missing_time"
          ? `I understood the day as ${calendarDayLabel(parsed.resolvedDateKey || dateKeyInTimeZone(now, parsed.timeZone))}. What time should it launch?`
          : parsed.issue === "invalid_local_time"
            ? `That local time does not exist in ${teamZoneLabel(parsed.timeZone)}, likely because of a daylight-saving change. Send another time.`
            : "I could not read that timing. Try “12:30 PM ET”, “tomorrow at 2 PM”, “Thursday this time”, or “next Thursday at noon”."
      await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, `${error}\n\nSend /cancel to stop.`)
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    const result = await rescheduleProject({ projectId: String(state.projectId), launchAt: parsed.date, telegramId, chatId, timeZone: parsed.timeZone, expectedScheduleVersion: Number(state.scheduleVersion) })
    if (!result.ok) {
      await sendMessage(token, chatId, `⚠️ ${result.error}`)
      return true
    }
    const resolvedText = `✅ ${(result.project as any).name} rescheduled\n${formatTeamDateTime(parsed.date, parsed.timeZone)}`
    const reviewMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
    await editOrSendWorkflowMessage(token, chatId, reviewMessageId, resolvedText)
    await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
    return true
  }

  if (state.action === "tentative_launch_day") {
    const timeZone = String(state.timeZone || await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE)
    const tentativeLaunchDate = parseNaturalTeamDate(text, timeZone, now)
    if (!tentativeLaunchDate) {
      await setState(telegramId, state, chatId)
      await editOrSendWorkflowMessage(token, chatId, Number(state.promptMessageId || state.reviewMessageId || 0) || null, `I could not read that launch day. Send today, tomorrow, a calendar date, or YYYY-MM-DD.\n\nCurrent schedule timezone: ${teamZoneLabel(timeZone)}. Send /cancel to stop.`)
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    const result = await setTentativeProjectLaunchDate({ projectId: String(state.projectId), tentativeLaunchDate, telegramId, chatId, timeZone, expectedScheduleVersion: Number(state.scheduleVersion) })
    if (!result.ok) {
      await sendMessage(token, chatId, `⚠️ ${result.error}`)
      return true
    }
    const resolvedText = `✅ ${(result.project as any).name} is tentative\n${tentativeLaunchDate} · Time TBD`
    const reviewMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
    await editOrSendWorkflowMessage(token, chatId, reviewMessageId, resolvedText)
    await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
    return true
  }

  if (state.action === "add_launch_note") {
    const project = await db.collection("opsProjects").findOne({ _id: String(state.projectId) })
    const noteText = String(text || "").trim()
    const reviewMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
    if (!project || String(project.status || "") === "inactive") {
      await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
      await editOrSendWorkflowMessage(token, chatId, reviewMessageId, "This launch is no longer available. Open /calendar for the latest schedule.")
      return true
    }
    if (!noteText) {
      await setState(telegramId, state, chatId)
      await editOrSendWorkflowMessage(token, chatId, reviewMessageId, `Send one note for ${project.name}.\n\nIt will appear as a separate bullet. Send /cancel to stop.`)
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    await db.collection("opsProjectNotes").insertOne({
      text: noteText,
      projectId: String(project._id),
      projectName: project.name,
      authorName: state.authorName || "Team member",
      authorTelegramId: telegramId,
      createdAt: now,
      updatedAt: now,
    })
    await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
    const updated = await db.collection("opsProjects").findOne({ _id: String(project._id) })
    if (updated) await showCalendarLaunchEditor(token, chatId, updated, reviewMessageId, "Note added.")
    return true
  }

  if (state.action === "add_project" || state.action === "edit_project") {
    const [name = "", owner = "", launchDate = "", status = "active"] = text.split("|").map((part) => part.trim())
    if (!name) {
      await sendMessage(token, chatId, "Send: Project Name | Owner | YYYY-MM-DD | active")
      return true
    }
    const payload = { name, owner, launchDate, status: status || "active", updatedAt: now }
    if (state.action === "edit_project") await db.collection("opsProjects").updateOne({ _id: state.projectId }, { $set: payload })
    else await db.collection("opsProjects").insertOne({ ...payload, revenueToday: 0, profitThisWeek: 0, createdAt: now })
    await clearState(telegramId)
    await sendMessage(token, chatId, state.action === "edit_project" ? "✅ Project updated." : "✅ Project created.")
    await sendProjects(token, chatId)
    return true
  }

  if (state.action === "add_reminder") {
    const defaultTimeZone = await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE
    const parsed = parseReminderRequest(text, {
      timeZone: defaultTimeZone,
      now: messageDateMs > 0 ? new Date(messageDateMs) : now,
    })
    const workflowMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
    if (!parsed.ok) {
      await editOrSendWorkflowMessage(token, chatId, workflowMessageId, [
        `⚠️ ${reminderRequestError(parsed)}`,
        "",
        reminderInputPrompt(),
      ].join("\n"))
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    const targetChatTitle = chatTitle(message, chatId)
    if (parsed.targetMode === "unspecified") {
      await setState(telegramId, {
        action: "reminder_audience",
        reminderDraft: parsed,
        targetChatTitle,
        selectedTargetIds: [],
        reviewMessageId: workflowMessageId,
        promptMessageId: workflowMessageId,
      }, chatId)
      await showReminderAudiencePicker(token, chatId, workflowMessageId)
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    let targetMode: "everyone" | "creator" | "specific" = parsed.targetMode
    let targetMembers: ReminderTarget[] = []
    if (targetMode === "creator") {
      const creator = await reminderTargetForTelegramId(telegramId)
      if (!creator) {
        await editOrSendWorkflowMessage(token, chatId, workflowMessageId, "⚠️ I couldn’t identify your enrolled Telegram account. Try choosing Everyone or another trader.")
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      targetMembers = [creator]
    } else if (targetMode === "specific") {
      const resolved = await resolveReminderTargetUsernames(parsed.targetUsernames, chatId)
      if (resolved.unresolved.length || !resolved.targets.length) {
        const missing = resolved.unresolved.map((username) => `@${username}`).join(", ")
        await editOrSendWorkflowMessage(token, chatId, workflowMessageId, `⚠️ I couldn’t find ${missing || "those traders"} among the enrolled members of this chat. Send the reminder again or choose people from the reminder picker.`)
        await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
        return true
      }
      targetMembers = resolved.targets
    }
    await completeManualReminder({ token, chatId, telegramId, draft: parsed, targetMode, targetMembers, targetChatTitle, workflowMessageId, state, inboundMessage: message })
    return true
  }

  if (state.action === "add_project_note") {
    const project = await db.collection("opsProjects").findOne({ _id: state.projectId })
    if (!project || !text.trim()) {
      await editOrSendWorkflowMessage(token, chatId, Number(state.reviewMessageId || state.promptMessageId || 0) || null, "Send one note as a single message. Send /cancel to stop.")
      await deleteWorkflowMessages(token, chatId, [telegramMessageId(message)])
      return true
    }
    await db.collection("opsProjectNotes").insertOne({
      text: text.trim(),
      projectId: String(project._id),
      projectName: project.name,
      authorName: state.authorName || "Team member",
      authorTelegramId: telegramId,
      createdAt: now,
      updatedAt: now,
    })
    const reviewMessageId = Number(state.reviewMessageId || state.promptMessageId || 0) || null
    await finishState(token, chatId, telegramId, state, message, reviewMessageId ? [reviewMessageId] : [])
    await sendProjectNotes(token, chatId, String(project._id), reviewMessageId)
    return true
  }

  if (state.action === "fee_project_search") {
    const term = text.trim().toLowerCase()
    const [fee, projects] = await Promise.all([
      db.collection("revenueFeeEvents").findOne({ _id: state.feeId }),
      db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ name: 1 }).toArray(),
    ])
    const explicitAsset = String(fee?.grossAsset || fee?.quoteAsset || "").toUpperCase()
    const matches = projects.filter((project: any) => {
      const config = projectFeeConfig(project)
      return config.chain && String(project.name || "").toLowerCase().includes(term) && (!explicitAsset || explicitAsset === "USD" || config.quoteAssets.includes(explicitAsset))
    }).slice(0, 10)
    if (!matches.length) {
      await sendMessage(token, chatId, "No configured active project matched that name. Try another search or /cancel.")
      return true
    }
    await clearState(telegramId)
    await sendMessage(token, chatId, "Choose the existing project for this fee:", matches.map((project: any) => [{ text: project.name, callback_data: `fee:project:${state.feeId}:${project._id}` }]))
    return true
  }

  if (state.action === "add_payroll") {
    const [member = "", amount = "0", project = "", date = new Date().toISOString().slice(0, 10)] = text.split("|").map((part) => part.trim())
    if (!member) {
      await sendMessage(token, chatId, "Send: Member | Amount | Project | YYYY-MM-DD")
      return true
    }
    await db.collection("opsPayroll").insertOne({ member, amount: Number(amount || 0), project, date, currency: "USD", status: "pending", createdFrom: "bot", telegramId, createdAt: now, updatedAt: now })
    await clearState(telegramId)
    await sendMessage(token, chatId, "✅ Payroll row added.")
    await sendPayroll(token, chatId)
    return true
  }

  if (state.action === "add_sheet_row") {
    const sheet = await db.collection("opsSheets").findOne({ _id: state.sheetId })
    if (!sheet) {
      await clearState(telegramId)
      await sendMessage(token, chatId, "Data file was not found.")
      return true
    }
    const kind = (sheet.sheetType || "custom") as SheetKind
    const values = valuesForKind(kind, sheet.values)
    const headers = values[0] || getSheetSchema(kind).headers
    const row = text.split("|").map((part) => part.trim())
    const normalized = headers.map((_, index) => row[index] || "")
    await db.collection("opsSheets").updateOne({ _id: state.sheetId }, { $set: { values: [headers, ...values.slice(1), normalized], updatedAt: now } })
    await clearState(telegramId)
    await sendMessage(token, chatId, "✅ Data row added.")
    await sendSheetDetail(token, chatId, state.sheetId)
    return true
  }

  if (state.action === "launch_calc_lp") {
    const initialLp = parseLaunchNumber(text)
    if (!(Number(initialLp) > 0)) {
      await sendMessage(token, chatId, "Enter an initial LP greater than zero, such as 0.5. Send /cancel to stop.")
      return true
    }
    const pad = launchPad(String(state.launchVenueId || ""))
    if (!pad) {
      await clearState(telegramId)
      await sendMessage(token, chatId, "That launch venue is no longer available.")
      return true
    }
    await setState(telegramId, { action: "launch_calc_value", launchInitialLp: initialLp }, chatId)
    await sendMessage(token, chatId, launchTargetPrompt(state.launchMetric as LaunchTargetMetric, pad.name))
    return true
  }

  if (state.action === "launch_calc_value") {
    const target = parseLaunchNumber(text)
    if (!(Number(target) > 0)) {
      const metric = state.launchMetric as LaunchTargetMetric
      await sendMessage(token, chatId, metric === "supply" ? "Enter a valid percentage, such as 67.37%." : "Enter a valid USD market cap, such as $81.4K.")
      return true
    }
    try {
      await sendCalculatedLaunchQuote(token, chatId, telegramId, state, { target: Number(target) })
    } catch (error) {
      await sendMessage(token, chatId, `⚠️ ${error instanceof Error ? error.message : "I could not calculate that launch."}\n\nTry another target or send /cancel.`)
    }
    return true
  }

  if (state.action === "launch_calc_mm") {
    const mmLiquidity = parseLaunchNumber(text)
    if (mmLiquidity == null || mmLiquidity < 0) {
      await sendMessage(token, chatId, "Enter the MM reserve in the native asset, such as 5 or 30. Send /cancel to stop.")
      return true
    }
    try {
      await sendCalculatedLaunchQuote(token, chatId, telegramId, state, { mmLiquidity })
    } catch (error) {
      await sendMessage(token, chatId, `⚠️ ${error instanceof Error ? error.message : "I could not recalculate that launch."}`)
    }
    return true
  }

  if (state.action === "ai") {
    const startedAt = Number(state.startedAt || 0)
    if (startedAt && messageDateMs && messageDateMs <= startedAt) return true
    await clearState(telegramId)
    await sendAiResponse(token, chatId, telegramId, text, message, context)
    return true
  }

  return false
}

const DIRECT_RECEIPT_FEE_TYPES = ["daily_trading", "dev_allocation", "fee_collector", "fee_rebate", "sumo_ref_claim", "other"] as const

function receiptTypeButtons(receiptId: string) {
  return [
    [{ text: "Daily trading", callback_data: `receipt:type:${receiptId}:daily_trading` }, { text: "Dev allocation", callback_data: `receipt:type:${receiptId}:dev_allocation` }],
    [{ text: "Fee collector", callback_data: `receipt:type:${receiptId}:fee_collector` }, { text: "Fee rebate", callback_data: `receipt:type:${receiptId}:fee_rebate` }],
    [{ text: "Sumo ref claim", callback_data: `receipt:type:${receiptId}:sumo_ref_claim` }, { text: "Other revenue", callback_data: `receipt:type:${receiptId}:other` }],
    [{ text: "Liquidation / launch expectation", callback_data: `receipt:existing:${receiptId}` }],
  ]
}

function feeTypeLabel(value: unknown) {
  return String(value || "Revenue").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function receiptSummary(receipt: any) {
  const available = receiptAvailableAmount(receipt)
  const original = Number(receipt.amount || 0)
  const availableUsd = receiptAvailableUsd(receipt)
  const value = availableUsd == null ? "Awaiting USD value" : availableUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
  const prior = available < original - 0.00000001 ? ` available from ${original.toLocaleString("en-US", { maximumFractionDigits: 8 })} received` : ""
  return `${available.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${receipt.asset}${prior} · ${value} · ${revenueChainLabel(receipt.chain)}`
}

async function compatibleReceiptProjects(receipt: any, feeType: FeeType) {
  const db = await getDb()
  if (feeType === "daily_trading") await ensureDailyTradingFeeExpectations(receipt.date)
  const projects = await db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ name: 1 }).toArray()
  const compatible = []
  for (const project of projects) {
    const config = projectFeeConfig(project)
    if (config.chain !== receipt.chain || !config.quoteAssets.includes(receipt.asset)) continue
    if (feeType === "daily_trading") {
      if (!config.dailyTradingFeeEnabled) continue
      const scheduled = await db.collection("revenueFeeEvents").findOne({ sourceKey: `daily:${receipt.date}:${project._id}` })
      if (!scheduled || ["confirmed", "ignored", "waived"].includes(scheduled.status)) continue
    }
    compatible.push(project)
  }
  return compatible
}

async function sendReceiptProjectPicker(token: string, chatId: number | string, telegramId: number, receiptId: string, feeType: FeeType) {
  const receipt = await getRevenueReceipt(receiptId)
  if (!receipt || receipt.direction !== "incoming" || receipt.status !== "unclassified") return sendMessage(token, chatId, "This receipt is no longer available for revenue classification.")
  const projects = await compatibleReceiptProjects(receipt, feeType)
  await setState(telegramId, { action: "receipt_classification", receiptId, feeType }, chatId)
  if (!projects.length) return sendMessage(token, chatId, `No eligible ${feeTypeLabel(feeType)} project accepts ${receipt.asset} on ${revenueChainLabel(receipt.chain)}. Configure or review it in Revenue Inbox.`)
  return sendMessage(token, chatId, `${receiptSummary(receipt)}\n\nChoose the project:`, projects.slice(0, 12).map((project: any) => [{ text: `${project.name} · ${revenueChainLabel(project.chain)}`.slice(0, 60), callback_data: `receipt:project:${project._id}` }]))
}

async function sendReceiptConfirmation(token: string, chatId: number | string, telegramId: number, projectId?: string | null) {
  const state = await takeState(telegramId, chatId)
  if (state?.action !== "receipt_classification" || !state.receiptId || !DIRECT_RECEIPT_FEE_TYPES.includes(state.feeType)) return sendMessage(token, chatId, "This classification menu expired. Start again from the receipt message.")
  const db = await getDb()
  const [receipt, project] = await Promise.all([
    getRevenueReceipt(String(state.receiptId)),
    projectId ? db.collection("opsProjects").findOne({ _id: projectId }) : Promise.resolve(null),
  ])
  if (!receipt || receipt.status !== "unclassified") return sendMessage(token, chatId, "This receipt was already classified.")
  if (!isGlobalRevenueFeeType(state.feeType) && !project) return sendMessage(token, chatId, "Choose an existing project first.")
  const available = receiptAvailableAmount(receipt)
  const availableUsd = receiptAvailableUsd(receipt)
  const expectedUsd = state.feeType === "daily_trading" ? Number(projectFeeConfig(project).dailyTradingFeeUsd || 500) : Number(availableUsd || 0)
  const variance = availableUsd == null ? null : availableUsd - expectedUsd
  await setState(telegramId, { ...state, projectId: project ? String(project._id) : null }, chatId)
  const text = [
    `<b>Confirm revenue classification</b>`,
    "",
    `Project: <b>${project?.name || (state.feeType === "sumo_ref_claim" ? "Sumo ref claim" : "Fee rebate")}</b>`,
    `Type: <b>${feeTypeLabel(state.feeType)}</b>`,
    `Receipt: <b>${receiptSummary(receipt)}</b>`,
    state.feeType === "daily_trading" ? `Recognized revenue: <b>$${expectedUsd.toFixed(2)}</b>` : "",
    variance == null || state.feeType !== "daily_trading" ? "" : `Conversion variance: <b>${variance >= 0 ? "+" : ""}$${variance.toFixed(2)}</b>`,
    "",
    "This records accounting only; no funds are moved.",
  ].filter(Boolean).join("\n")
  return sendMessage(token, chatId, text, [[{ text: "✅ Confirm", callback_data: `receipt:confirm:${receipt._id}` }, { text: "⬅️ Back", callback_data: `receipt:classify:${receipt._id}` }]])
}

async function sendExistingExpectationPicker(token: string, chatId: number | string, telegramId: number, receiptId: string) {
  const receipt = await getRevenueReceipt(receiptId)
  if (!receipt || receipt.direction !== "incoming" || receipt.status !== "unclassified") return sendMessage(token, chatId, "This receipt is no longer available.")
  const db = await getDb()
  const fees = await db.collection("revenueFeeEvents").find({
    date: receipt.date,
    chain: receipt.chain,
    quoteAsset: receipt.asset,
    status: { $in: ["awaiting_receipt", "match_proposed"] },
  }).sort({ createdAt: -1 }).toArray()
  await setState(telegramId, { action: "receipt_expectation", receiptId }, chatId)
  const eligible = fees.filter((fee: any) => ["liquidation", "launch", "daily_trading"].includes(fee.feeType)).slice(0, 12)
  if (!eligible.length) return sendMessage(token, chatId, "No compatible liquidation, launch, or daily expectation is waiting for this receipt. Forward the standardized cashout message first or use Revenue Inbox.")
  return sendMessage(token, chatId, `${receiptSummary(receipt)}\n\nChoose the existing expectation:`, eligible.map((fee: any) => [{ text: `${fee.projectName || "Project"} · ${feeTypeLabel(fee.feeType)} · ${fee.expectedUsd == null ? `${fee.expectedAssetAmount} ${fee.quoteAsset}` : `$${Number(fee.expectedUsd).toFixed(2)}`}`.slice(0, 60), callback_data: `receipt:expect:${fee._id}` }]))
}

async function getLaunchSetupAction(db: any, actionId: string, telegramId: number, chatId: number | string) {
  const action = await db.collection("opsAiActions").findOne({ _id: actionId })
  if (!action || String(action.actionType || "") !== "create_project" || !(action.payload?.launchAt || action.payload?.launchDate || action.payload?.tentativeLaunchDate)) return { ok: false as const, error: "This launch draft was not found." }
  if (action.telegramId && Number(action.telegramId) !== telegramId) return { ok: false as const, error: "Only the person who started this launch draft can change it." }
  if (action.chatId && String(action.chatId) !== String(chatId)) return { ok: false as const, error: "This launch draft must be completed in the chat where it was started." }
  if (action.status !== "pending") return { ok: false as const, error: `This launch draft is already ${action.status}.` }
  return { ok: true as const, action }
}

async function updateLaunchSetupAction(db: any, action: any, changes: Record<string, any>) {
  const payload = { ...(action.payload || {}), ...changes }
  await db.collection("opsAiActions").updateOne({ _id: action._id, status: "pending" }, { $set: { payload, updatedAt: new Date() } })
  return { ...action, payload }
}

async function showLaunchSetupReview(token: string, chatId: number | string, action: any, messageId?: number | null, notice = "") {
  const text = formatLaunchSetupReview(action, notice)
  const buttons = launchSetupButtons(action)
  if (messageId) {
    const edited = await editTelegramMessage(token, chatId, messageId, text, { parseMode: "HTML", replyMarkup: { inline_keyboard: buttons } })
    if (edited) return
  }
  await sendMessage(token, chatId, text, buttons)
}

async function showLaunchSetupPicker(token: string, chatId: number | string, messageId: number | null | undefined, text: string, buttons: InlineButton[][]) {
  if (messageId) {
    const edited = await editTelegramMessage(token, chatId, messageId, text, { parseMode: hasTelegramHtml(text) ? "HTML" : undefined, replyMarkup: { inline_keyboard: buttons } })
    if (edited) return
  }
  await sendMessage(token, chatId, text, buttons)
}

async function createGuidedLaunchDraft(db: any, params: {
  telegramId: number
  chatId: number | string
  name: string
  launchAt?: string | null
  tentativeLaunchDate?: string | null
  timeZone: string
}) {
  const now = new Date()
  const launchAt = params.launchAt || null
  const tentativeLaunchDate = params.tentativeLaunchDate || null
  const record = {
    telegramId: params.telegramId,
    chatId: String(params.chatId),
    request: "/addlaunch",
    actionType: "create_project",
    summary: `Add ${params.name} to the launch calendar`,
    payload: {
      name: params.name,
      launchAt,
      launchDate: launchAt,
      tentativeLaunchDate,
      launchTimingStatus: launchAt ? "confirmed" : "tentative",
      launchTimeZone: params.timeZone,
      status: "scheduled",
      referrerStatus: "pending",
      dailyTradingFeeEnabled: true,
      dailyTradingFeeUsd: 500,
      launchFeeUsd: 1000,
      feeConfigurationConfirmed: false,
    },
    preview: [],
    warnings: [],
    permissionScope: "launch",
    allowedActionTypes: ["create_project"],
    needsChoice: false,
    guidedWizard: true,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("opsAiActions").insertOne(record)
  return { ...record, _id: String(result.insertedId) }
}

async function guidedReferrerButtons(db: any, actionId: string): Promise<InlineButton[][]> {
  const accounts = (await db.collection("accounts").find({}).sort({ name: 1 }).toArray())
    .filter((account: any) => String(account.type || "").toUpperCase() === "REFERRER" && String(account.status || "active").toLowerCase() !== "inactive")
    .slice(0, 10)
  return [
    ...accounts.map((account: any, index: number) => [{ text: String(account.name || `Referrer ${index + 1}`).slice(0, 48), callback_data: `launchsetup:setref:${actionId}:${index}` }]),
    [{ text: "Enter manually", callback_data: `launchsetup:manualref:${actionId}` }],
    [{ text: "No referrer", callback_data: `launchsetup:noref:${actionId}` }],
    [{ text: "Back to review", callback_data: `launchsetup:review:${actionId}` }],
  ]
}

async function handleCallback(token: string, chatId: number | string, telegramId: number, data: string, req: NextRequest, callbackMessage?: any) {
  const db = await getDb()
  const [area, action, id, extra] = data.split(":")
  const context = await botPermissions(telegramId, chatId)
  const callbackCapability: BotCapability | null = area === "launch" || area === "lifecycle" || area === "launchsetup" || area === "organic" || area === "calendar" || area === "tentative"
    ? "launch"
    : ["reminder", "reminders", "reminderto", "eod"].includes(area)
      ? (context.profile === "launch" ? "launch" : "trade")
    : ["project", "projects", "notes", "note", "data", "sheet"].includes(area)
      ? "trade"
      : ["receipt", "consol", "fee", "payroll"].includes(area)
        ? "finance"
        : area === "ai"
          ? aiPermissionPolicy(context).capability
          : null
  if (callbackCapability && !(await requireCapability(token, context, callbackCapability))) return

  if (area === "eod") {
    const workflowMessageId = Number(callbackMessage?.message_id || 0) || null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id || "")) {
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, "This project check is no longer available.")
    }
    const reviewId = dailyProjectReviewId(chatId, id)
    const stored = await db.collection("opsDailyProjectReviews").findOne({ _id: reviewId, chatId: String(chatId), dateKey: id }) as DailyProjectReviewRecord | null
    if (!stored) return editOrSendWorkflowMessage(token, chatId, workflowMessageId, "This project check is no longer available.")

    const activeRows = await db.collection("opsProjects").find({ status: "active" }).toArray()
    const activeIds = new Set(activeRows.map((project: any) => String(project._id)))
    const availableProjects = (stored.projects || []).filter((project) => activeIds.has(project.projectId))
    const availableIds = new Set(availableProjects.map((project) => project.projectId))
    const selectedProjectIds = (stored.selectedProjectIds || []).filter((projectId) => availableIds.has(projectId))
    let review: DailyProjectReviewRecord = { ...stored, projects: availableProjects, selectedProjectIds }

    if (stored.status === "completed") {
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review: stored, stage: "complete", currentActiveProjects: availableProjects }))
    }

    if (action === "pick") {
      const index = Number(extra)
      const chosen = Number.isInteger(index) && index >= 0 ? stored.projects?.[index] : null
      if (chosen && activeIds.has(chosen.projectId)) {
        const selected = new Set(selectedProjectIds)
        if (selected.has(chosen.projectId)) selected.delete(chosen.projectId)
        else selected.add(chosen.projectId)
        review = { ...review, selectedProjectIds: Array.from(selected), status: "pending" }
      }
      await db.collection("opsDailyProjectReviews").updateOne(
        { _id: reviewId },
        { $set: { projects: review.projects, selectedProjectIds: review.selectedProjectIds, status: "pending", updatedAt: new Date() } },
      )
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review }), dailyProjectReviewButtons(review))
    }

    if (action === "review") {
      if (!selectedProjectIds.length) return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review }), dailyProjectReviewButtons(review))
      await db.collection("opsDailyProjectReviews").updateOne({ _id: reviewId }, { $set: { status: "confirming", updatedAt: new Date() } })
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review, stage: "confirm" }), dailyProjectReviewButtons(review, "confirm"))
    }

    if (action === "back") {
      await db.collection("opsDailyProjectReviews").updateOne({ _id: reviewId }, { $set: { status: "pending", updatedAt: new Date() } })
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review }), dailyProjectReviewButtons(review))
    }

    const member = await db.collection("guardMembers").findOne({ telegramId })
    const reviewerName = [member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.username || callbackMessage?.from?.first_name || "Trade Floor member"
    const completedAt = new Date()

    if (action === "keep") {
      review = { ...review, status: "completed", completedAction: "kept_active", completedByTelegramId: telegramId, completedByName: reviewerName, deactivatedProjectIds: [] }
      await db.collection("opsDailyProjectReviews").updateOne(
        { _id: reviewId },
        { $set: { projects: review.projects, selectedProjectIds: [], status: "completed", completedAction: "kept_active", completedByTelegramId: telegramId, completedByName: reviewerName, deactivatedProjectIds: [], completedAt, updatedAt: completedAt } },
      )
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review, stage: "complete", currentActiveProjects: availableProjects }))
    }

    if (action === "confirm") {
      if (!selectedProjectIds.length) return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review }), dailyProjectReviewButtons(review))
      const deactivatedProjectIds: string[] = []
      for (const projectId of selectedProjectIds) {
        const result = await deactivateActiveProject({ projectId, telegramId, source: "daily_trade_review", chatId, reviewDate: id, now: completedAt })
        if (result.ok && "deactivated" in result && result.deactivated) deactivatedProjectIds.push(projectId)
      }
      const deactivatedIds = new Set(deactivatedProjectIds)
      const stillActive = availableProjects.filter((project) => !deactivatedIds.has(project.projectId) && activeIds.has(project.projectId))
      review = { ...review, status: "completed", completedAction: "deactivated", completedByTelegramId: telegramId, completedByName: reviewerName, deactivatedProjectIds }
      await db.collection("opsDailyProjectReviews").updateOne(
        { _id: reviewId },
        { $set: { selectedProjectIds: [], status: "completed", completedAction: "deactivated", completedByTelegramId: telegramId, completedByName: reviewerName, deactivatedProjectIds, completedAt, updatedAt: completedAt } },
      )
      return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review, stage: "complete", currentActiveProjects: stillActive }))
    }

    return editOrSendWorkflowMessage(token, chatId, workflowMessageId, dailyProjectReviewText({ review }), dailyProjectReviewButtons(review))
  }

  if (area === "organic" && action === "start") {
    const launchAction = await db.collection("opsAiActions").findOne({ _id: id })
    const suggestedTicker = normalizeOrganicTicker(launchAction?.payload?.ticker || launchAction?.payload?.symbol || launchAction?.payload?.name || "")
    return startOrganicChannelSetup(token, chatId, telegramId, validOrganicTicker(suggestedTicker) ? suggestedTicker : "")
  }

  if (area === "calendar") {
    const messageId = Number(callbackMessage?.message_id || 0) || null
    if (context.profile !== "launch") return sendMessage(token, chatId, "⛔ Launch schedule editing must be handled in the configured Launch Chat.")

    if (action === "day") return sendCalendar(token, chatId, id, messageId)

    if (action === "edit") {
      const { launches, targetDate } = await calendarRows(id)
      if (!launches.length) return sendCalendar(token, chatId, targetDate, messageId)
      const launchButtons: InlineButton[][] = launches.slice(0, 20).map(({ project, launchAt }: any) => [{
        text: `${launchAt ? new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(launchAt) : "TBD"} — ${String(project.name || "Unnamed project")}`.slice(0, 60),
        callback_data: `calendar:launch:${project._id}:${Number(project.scheduleVersion || 0)}`,
      }])
      launchButtons.push([{ text: "Back to calendar", callback_data: `calendar:day:${targetDate}` }])
      return showLaunchSetupPicker(token, chatId, messageId, `Launches — ${calendarDayLabel(targetDate)}\n\nChoose a launch:`, launchButtons)
    }

    if (action === "launch") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      const scheduleVersion = Number(extra || 0)
      if (!project || String(project.status || "") === "inactive" || Number(project.scheduleVersion || 0) !== scheduleVersion) {
        return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest version.")
      }
      return showCalendarLaunchEditor(token, chatId, project, messageId)
    }

    if (action === "addnote") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      const scheduleVersion = Number(extra || 0)
      if (!project || String(project.status || "") === "inactive" || Number(project.scheduleVersion || 0) !== scheduleVersion) {
        return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest version.")
      }
      const member = await db.collection("guardMembers").findOne({ telegramId })
      await beginTextWorkflow({
        token,
        chatId,
        telegramId,
        reviewMessageId: messageId,
        state: {
          action: "add_launch_note",
          projectId: id,
          scheduleVersion,
          authorName: member?.name || member?.firstName || member?.username || "Team member",
        },
        text: `Send one note for ${project.name}.\n\nIt will appear as a separate bullet. Send /cancel to stop.`,
      })
      return
    }

    if (action === "venue") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      const scheduleVersion = Number(extra || 0)
      if (!project || String(project.status || "") === "inactive" || Number(project.scheduleVersion || 0) !== scheduleVersion) {
        return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest version.")
      }
      const chainId = launchChainIdForProject(project.chain || project.revenueChain)
      if (!chainId) return sendMessage(token, chatId, "⚠️ Set the project chain before choosing its launch venue / DEX.")
      const venueButtons: InlineButton[][] = operationalVenuesForChain(chainId).map((venue) => [{
        text: venue.name,
        callback_data: `calendar:setvenue:${id}:${venue.id}~${scheduleVersion}`,
      }])
      venueButtons.push([{ text: "Back", callback_data: `calendar:launch:${id}:${scheduleVersion}` }])
      return showLaunchSetupPicker(token, chatId, messageId, `Choose the launch venue / DEX for ${project.name}:`, venueButtons)
    }

    if (action === "setvenue") {
      const [venueId, rawVersion] = String(extra || "").split("~")
      const scheduleVersion = Number(rawVersion || 0)
      const project = await db.collection("opsProjects").findOne({ _id: id })
      const venue = operationalLaunchVenue(venueId)
      const chainId = launchChainIdForProject(project?.chain || project?.revenueChain)
      if (!project || !venue || !chainId || venue.chainId !== chainId || String(project.status || "") === "inactive" || Number(project.scheduleVersion || 0) !== scheduleVersion) {
        return editOrSendWorkflowMessage(token, chatId, messageId, "That venue is no longer available. Open /calendar and try again.")
      }
      const now = new Date()
      await db.collection("opsProjects").updateOne(
        { _id: id, status: project.status, scheduleVersion },
        { $set: { launchVenue: venue.id, launchVenueLabel: venue.name, launchFundingAsset: venue.symbol, launchVenueUpdatedAt: now, launchVenueUpdatedByTelegramId: telegramId, updatedAt: now } },
      )
      const updated = await db.collection("opsProjects").findOne({ _id: id })
      if (!updated || updated.launchVenue !== venue.id) return sendMessage(token, chatId, "⚠️ I could not update that launch venue. Open /calendar and try again.")
      return showCalendarLaunchEditor(token, chatId, updated, messageId, `Launch venue updated to ${venue.name}.`)
    }
  }

  if (area === "tentative" && action === "ack") {
    const messageId = Number(callbackMessage?.message_id || 0) || null
    if (context.profile !== "launch") return sendMessage(token, chatId, "⛔ Tentative launch confirmations must be handled in the configured Launch Chat.")
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : dateKeyInTimeZone(new Date(), TEAM_TIME_ZONE)
    return acknowledgeTentativeLaunches(token, chatId, telegramId, dateKey, messageId)
  }

  if (area === "launchsetup") {
    const draft = await getLaunchSetupAction(db, id, telegramId, chatId)
    if (!draft.ok) return sendMessage(token, chatId, `⚠️ ${draft.error}`)
    let launchAction = draft.action
    const messageId = Number(callbackMessage?.message_id || 0) || null

    if (action === "review") return showLaunchSetupReview(token, chatId, launchAction, messageId)
    if (action === "timing") {
      return showLaunchSetupPicker(token, chatId, messageId, `🕒 <b>Choose timing for ${String(launchAction.payload?.name || "this launch")}</b>`, [
        [{ text: "Set exact date and time", callback_data: `launchsetup:exacttime:${id}` }],
        [{ text: "Set tentative day · Time TBD", callback_data: `launchsetup:tentativeday:${id}` }],
        [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
      ])
    }
    if (action === "method") {
      return showLaunchSetupPicker(token, chatId, messageId, `🧩 <b>Choose the launch method for ${String(launchAction.payload?.name || "this launch")}</b>`, [
        ...launchMethodButtons(id),
        [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
      ])
    }
    if (action === "setmethod") {
      const launchMethod = normalizeLaunchMethod(extra)
      if (!launchMethod) return sendMessage(token, chatId, "⚠️ That launch method is not available.")
      launchAction = await updateLaunchSetupAction(db, launchAction, { launchMethod })
      if (launchAction.guidedWizard) {
        return showLaunchSetupPicker(token, chatId, messageId, `Does ${String(launchAction.payload?.name || "this launch")} have a referrer?`, await guidedReferrerButtons(db, id))
      }
      return showLaunchSetupReview(token, chatId, launchAction, messageId, `${launchMethodLabel(launchMethod)} selected.`)
    }
    if (action === "exacttime") {
      const defaultLaunchDate = projectLaunchDateKey(launchAction.payload, launchAction.payload?.launchTimeZone || TEAM_TIME_ZONE) || dateKeyInTimeZone(new Date(), launchAction.payload?.launchTimeZone || TEAM_TIME_ZONE)
      const defaultLaunchAt = projectLaunchAt(launchAction.payload)?.toISOString() || null
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "launch_setup_exact_time", actionId: id, tentativeLaunchDate: launchAction.payload?.tentativeLaunchDate, defaultLaunchDate, defaultLaunchAt, timeZone: launchAction.payload?.launchTimeZone || TEAM_TIME_ZONE }, text: [
        `Send the launch timing for ${launchAction.payload?.name || "this launch"}.`,
        "",
        `A time by itself keeps ${calendarDayLabel(defaultLaunchDate)}.`,
        defaultLaunchAt ? `A day by itself keeps ${calendarTimeLabel(new Date(defaultLaunchAt))}.` : "If you send only a day, I’ll ask for the time next.",
        "Examples: 12:30 PM ET · tomorrow at 2 PM · Thursday this time · next Thursday at noon · TBD",
        "Send /cancel to stop.",
      ].join("\n"), buttons: [[{ text: "Set time to TBD", callback_data: `launchsetup:maketbd:${id}` }]] })
      return
    }
    if (action === "maketbd") {
      const timeZone = launchAction.payload?.launchTimeZone || TEAM_TIME_ZONE
      const tentativeLaunchDate = projectLaunchDateKey(launchAction.payload, timeZone) || dateKeyInTimeZone(new Date(), timeZone)
      launchAction = await updateLaunchSetupAction(db, launchAction, { launchAt: null, launchDate: null, tentativeLaunchDate, launchTimingStatus: "tentative", launchTimeZone: timeZone, status: "scheduled" })
      await clearState(telegramId)
      return showLaunchSetupReview(token, chatId, launchAction, messageId, "Launch time changed to TBD. The launch day was kept.")
    }
    if (action === "tentativeday") {
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "launch_setup_tentative_day", actionId: id, timeZone: launchAction.payload?.launchTimeZone || TEAM_TIME_ZONE }, text: "Send the tentative launch day.\n\nExamples: today, tomorrow, August 25, or 2026-08-25\nSend /cancel to stop." })
      return
    }
    if (action === "name") {
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "launch_setup_name", actionId: id }, text: `Send the exact project name for this launch.\n\nCurrent name: ${launchAction.payload?.name || "Not selected"}\nSend /cancel to stop.` })
      return
    }
    if (action === "chain") {
      return showLaunchSetupPicker(token, chatId, messageId, `⛓ <b>Choose the chain for ${String(launchAction.payload?.name || "this launch")}</b>`, [
        ...launchChainButtons(id),
        [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
      ])
    }
    if (action === "setchain") {
      const chain = launchChainConfig(extra as LaunchChainId)
      if (!chain?.chain) return sendMessage(token, chatId, "⚠️ That chain is not available.")
      const currentVenue = operationalLaunchVenue(launchAction.payload?.launchVenue)
      const venueStillMatches = currentVenue?.chainId === chain.chainId
      launchAction = await updateLaunchSetupAction(db, launchAction, {
        chain: chain.chain,
        revenueChain: chain.chain,
        quoteToken: chain.nativeQuoteToken,
        quoteAssets: [chain.nativeQuoteToken],
        quoteTokenAddress: "",
        quoteTokenDecimals: null,
        launchVenue: venueStillMatches ? currentVenue?.id : "",
        launchFundingAsset: venueStillMatches ? currentVenue?.symbol : "",
        dailyTradingFeeEnabled: true,
        dailyTradingFeeUsd: Number(launchAction.payload?.dailyTradingFeeUsd || 500),
        launchFeeUsd: Number(launchAction.payload?.launchFeeUsd || 1000),
        feeConfigurationConfirmed: true,
      })
      if (launchAction.guidedWizard) {
        const chainId = launchChainIdForProject(chain.chain)
        return showLaunchSetupPicker(token, chatId, messageId, `Choose the launchpad / DEX for ${String(launchAction.payload?.name || "this launch")}:`, [
          ...launchVenueButtons(id, chainId!),
          [{ text: "Back to review", callback_data: `launchsetup:review:${id}` }],
        ])
      }
      return showLaunchSetupReview(token, chatId, launchAction, messageId, venueStillMatches ? "Chain updated." : "Chain updated. Choose the launchpad / DEX for this chain.")
    }
    if (action === "venue") {
      const chainId = launchChainIdForProject(launchAction.payload?.chain)
      if (!chainId) {
        return showLaunchSetupPicker(token, chatId, messageId, "Choose the chain first:", [
          ...launchChainButtons(id),
          [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
        ])
      }
      return showLaunchSetupPicker(token, chatId, messageId, `🚀 <b>Choose the launchpad / DEX for ${String(launchAction.payload?.name || "this launch")}</b>`, [
        ...launchVenueButtons(id, chainId),
        [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
      ])
    }
    if (action === "setvenue") {
      const selection = launchVenueSelection(extra)
      if (!selection) return sendMessage(token, chatId, "⚠️ That launchpad / DEX is not available.")
      launchAction = await updateLaunchSetupAction(db, launchAction, selection)
      if (launchAction.guidedWizard) {
        return showLaunchSetupPicker(token, chatId, messageId, `Choose the quote token for ${String(launchAction.payload?.name || "this launch")}:`, [
          ...launchQuoteButtons(id, launchAction.payload?.chain),
          [{ text: "Back to review", callback_data: `launchsetup:review:${id}` }],
        ])
      }
      return showLaunchSetupReview(token, chatId, launchAction, messageId, "Launchpad, chain, quote token, and standard fees updated.")
    }
    if (action === "quote") {
      return showLaunchSetupPicker(token, chatId, messageId, `💱 <b>Choose the quote token for ${String(launchAction.payload?.name || "this launch")}</b>`, [
        ...launchQuoteButtons(id, launchAction.payload?.chain),
        [{ text: "⬅️ Back to review", callback_data: `launchsetup:review:${id}` }],
      ])
    }
    if (action === "setquote") {
      const quoteToken = String(extra || "").trim().toUpperCase()
      if (!launchQuoteButtons(id, launchAction.payload?.chain).some((row) => row.some((button) => button.text === quoteToken))) return sendMessage(token, chatId, "⚠️ That quote token is not available for the selected chain.")
      launchAction = await updateLaunchSetupAction(db, launchAction, {
        quoteToken,
        quoteAssets: [quoteToken],
        quoteTokenAddress: "",
        quoteTokenDecimals: null,
        dailyTradingFeeEnabled: true,
        dailyTradingFeeUsd: Number(launchAction.payload?.dailyTradingFeeUsd || 500),
        launchFeeUsd: Number(launchAction.payload?.launchFeeUsd || 1000),
        feeConfigurationConfirmed: Boolean(launchAction.payload?.chain),
      })
      if (launchAction.guidedWizard) {
        return showLaunchSetupPicker(token, chatId, messageId, `Choose the launch method for ${String(launchAction.payload?.name || "this launch")}:`, [
          ...launchMethodButtons(id),
          [{ text: "Back to review", callback_data: `launchsetup:review:${id}` }],
        ])
      }
      return showLaunchSetupReview(token, chatId, launchAction, messageId, "Quote token updated.")
    }
    if (action === "customquote") {
      await beginTextWorkflow({
        token,
        chatId,
        telegramId,
        reviewMessageId: messageId,
        state: { action: "launch_setup_custom_quote", actionId: id },
        text: `Send the custom quote token for ${launchAction.payload?.name || "this launch"}.\n\nFormat: SYMBOL | contract address\nExample: AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9\nSend /cancel to stop.`,
      })
      return
    }
    if (action === "noref") {
      launchAction = await updateLaunchSetupAction(db, launchAction, { referrer: "", referrerWallet: "", referrerAccountId: null, referralPercentage: 0, referrerStatus: "none" })
      return showLaunchSetupReview(token, chatId, launchAction, messageId, "No referrer confirmed.")
    }
    if (action === "referrer") {
      return showLaunchSetupPicker(token, chatId, messageId, "<b>Choose the referrer</b>", await guidedReferrerButtons(db, id))
    }
    if (action === "setref") {
      const accounts = (await db.collection("accounts").find({}).sort({ name: 1 }).toArray())
        .filter((account: any) => String(account.type || "").toUpperCase() === "REFERRER" && String(account.status || "active").toLowerCase() !== "inactive")
        .slice(0, 10)
      const account = accounts[Number(extra)]
      if (!account) return sendMessage(token, chatId, "⚠️ That referrer is no longer available.")
      const percentage = Number(account.referralPercentage || account.referrerPercentage || account.defaultPercentage || 0)
      launchAction = await updateLaunchSetupAction(db, launchAction, {
        referrer: String(account.name || "Referrer"),
        referrerWallet: String(account.wallet || account.source || ""),
        referrerAccountId: String(account._id),
        referralPercentage: percentage,
        referrerStatus: "assigned",
      })
      if (percentage > 0) return showLaunchSetupReview(token, chatId, launchAction, messageId, "Referrer updated.")
      return showLaunchSetupPicker(token, chatId, messageId, `Choose the referral percentage for <b>${String(account.name || "this referrer")}</b>:`, [
        [10, 15, 20, 25].map((value) => ({ text: `${value}%`, callback_data: `launchsetup:setpct:${id}:${value}` })),
        [{ text: "✏️ Custom percentage", callback_data: `launchsetup:custompct:${id}` }],
      ])
    }
    if (action === "setpct") {
      const percentage = Number(extra)
      if (!(percentage > 0 && percentage <= 100)) return sendMessage(token, chatId, "⚠️ Choose a referral percentage from 1 to 100.")
      launchAction = await updateLaunchSetupAction(db, launchAction, { referralPercentage: percentage, referrerStatus: "assigned" })
      return showLaunchSetupReview(token, chatId, launchAction, messageId, "Referral percentage updated.")
    }
    if (action === "manualref") {
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "launch_setup_referrer", actionId: id }, text: "Send the referrer as: Name | Percentage\n\nExample: BK | 20\nSend /cancel to stop." })
      return
    }
    if (action === "custompct") {
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "launch_setup_refpct", actionId: id }, text: "Send the referral percentage from 1 to 100.\n\nSend /cancel to stop." })
      return
    }
    if (action === "cancel") {
      const text = await rejectOpsAiAction(id, telegramId)
      if (messageId) {
        const edited = await editTelegramMessage(token, chatId, messageId, text, { replyMarkup: { inline_keyboard: [] } })
        if (edited) return
      }
      return sendMessage(token, chatId, text)
    }
    if (action === "create") {
      if (!launchSetupReady(launchAction.payload)) return showLaunchSetupReview(token, chatId, launchAction, messageId, "Complete the remaining setup before creating this launch.")
      const policy = aiPermissionPolicy(context)
      const text = await executeOpsAiAction(id, telegramId, { allowedActionTypes: policy.allowedActionTypes, currentChatId: chatId, dataScope: policy.dataScope })
      const launchDate = launchAction.payload?.launchAt || launchAction.payload?.launchDate || launchAction.payload?.tentativeLaunchDate
      const schedule = text.startsWith("✅") && launchDate ? await formatLaunchDaySchedule(launchDate) : ""
      const finalText = [text, schedule].filter(Boolean).join("\n\n")
      const organicButtons: InlineButton[][] = text.startsWith("✅")
        ? [[{ text: "📣 Set up organic notifications", callback_data: `organic:start:${id}` }]]
        : []
      if (messageId) {
        const edited = await editTelegramMessage(token, chatId, messageId, finalText, { parseMode: hasTelegramHtml(finalText) ? "HTML" : undefined, replyMarkup: { inline_keyboard: organicButtons } })
        if (edited) return
      }
      return sendMessage(token, chatId, finalText, organicButtons.length ? organicButtons : undefined)
    }
  }

  if (area === "lifecycle") {
    if (context.profile !== "launch") return sendMessage(token, chatId, "⛔ Launch activation confirmations must be handled in the configured Launch Chat.")
    const messageId = Number(callbackMessage?.message_id || 0) || null
    const scheduleVersion = Number(extra || 0)
    if (action === "settime") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      if (!project || !["scheduled", "in_progress"].includes(String(project.status || "")) || Number(project.scheduleVersion || 0) !== scheduleVersion) return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest schedule.")
      const timeZone = project.launchTimeZone || TEAM_TIME_ZONE
      const defaultLaunchDate = projectLaunchDateKey(project, timeZone) || dateKeyInTimeZone(new Date(), timeZone)
      const defaultLaunchAt = projectLaunchAt(project)?.toISOString() || null
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "reschedule_launch", projectId: id, scheduleVersion, defaultLaunchDate, defaultLaunchAt, timeZone }, text: [
        `Send the launch timing for ${project.name}.`,
        "",
        `A time by itself applies to ${calendarDayLabel(defaultLaunchDate)}.`,
        "Examples: 12:30 PM ET · tomorrow at 2 PM · Thursday at noon · next Thursday at 3 PM · TBD",
        "Send /cancel to stop.",
      ].join("\n"), buttons: [[{ text: "Set time to TBD", callback_data: `lifecycle:maketbd:${id}:${scheduleVersion}` }]] })
      return
    }
    if (action === "maketbd") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      if (!project || !["scheduled", "in_progress"].includes(String(project.status || "")) || Number(project.scheduleVersion || 0) !== scheduleVersion) return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest schedule.")
      const timeZone = project.launchTimeZone || TEAM_TIME_ZONE
      const tentativeLaunchDate = projectLaunchDateKey(project, timeZone) || dateKeyInTimeZone(new Date(), timeZone)
      const result = await setTentativeProjectLaunchDate({ projectId: id, tentativeLaunchDate, telegramId, chatId, timeZone, expectedScheduleVersion: scheduleVersion })
      await clearState(telegramId)
      return editOrSendWorkflowMessage(token, chatId, messageId, result.ok ? `✅ ${(result.project as any).name} is tentative\n${tentativeLaunchDate} · Time TBD` : `⚠️ ${result.error}`)
    }
    if (action === "tentativeday") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      if (!project || !["scheduled", "in_progress"].includes(String(project.status || "")) || Number(project.scheduleVersion || 0) !== scheduleVersion) return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest schedule.")
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "tentative_launch_day", projectId: id, scheduleVersion, timeZone: project.launchTimeZone || TEAM_TIME_ZONE }, text: `Send the tentative launch day for ${project.name}.\n\nExamples: today, tomorrow, August 25, or 2026-08-25\nThe time will remain TBD. Send /cancel to stop.` })
      return
    }
    if (action === "ontime" || action === "now") {
      const result = await activateScheduledProject({ projectId: id, telegramId, actual: action === "ontime" ? "scheduled" : "now", expectedScheduleVersion: scheduleVersion })
      if (!result.ok) {
        const readiness = result.readiness
        const buttons: InlineButton[][] = []
        if (readiness?.missing?.includes("fee configuration") && readiness.chain && readiness.quoteToken) buttons.push([{ text: "✅ Use standard $1K launch + $500/day fees", callback_data: `lifecycle:fees:${id}:${scheduleVersion}` }])
        if (readiness?.missing?.includes("referrer decision")) buttons.push([{ text: "Confirm no referrer", callback_data: `lifecycle:refnone:${id}:${scheduleVersion}` }])
        return editOrSendWorkflowMessage(token, chatId, messageId, `⚠️ ${result.error}`, buttons)
      }
      if (result.alreadyActive) return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is already active.`)
      return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is Active\nDaily trading fees begin ${result.dailyFeeStartDate}.`)
    }
    if (action === "delay") {
      const project = await db.collection("opsProjects").findOne({ _id: id })
      if (!project || !["scheduled", "in_progress"].includes(String(project.status || "")) || Number(project.scheduleVersion || 0) !== scheduleVersion) return editOrSendWorkflowMessage(token, chatId, messageId, "This launch was already updated. Open /calendar for the latest schedule.")
      const timeZone = project.launchTimeZone || TEAM_TIME_ZONE
      const defaultLaunchDate = projectLaunchDateKey(project, timeZone) || dateKeyInTimeZone(new Date(), timeZone)
      const defaultLaunchAt = projectLaunchAt(project)?.toISOString() || null
      await beginTextWorkflow({ token, chatId, telegramId, reviewMessageId: messageId, state: { action: "reschedule_launch", projectId: id, scheduleVersion, defaultLaunchDate, defaultLaunchAt, timeZone }, text: [
        `Send the new timing for ${project.name}.`,
        "",
        `A time by itself keeps ${calendarDayLabel(defaultLaunchDate)}.`,
        defaultLaunchAt ? `A day by itself keeps ${calendarTimeLabel(new Date(defaultLaunchAt))}.` : "If you send only a day, I’ll ask for the time next.",
        "Examples: 12:30 PM ET · tomorrow at 2 PM · Thursday this time · same time tomorrow · TBD",
        "Send /cancel to stop.",
      ].join("\n"), buttons: [[{ text: "Set time to TBD", callback_data: `lifecycle:maketbd:${id}:${scheduleVersion}` }]] })
      return
    }
    if (action === "cancel") {
      const result = await cancelScheduledProject(id, telegramId, new Date(), scheduleVersion)
      return editOrSendWorkflowMessage(token, chatId, messageId, result.ok ? `✅ ${(result.project as any).name} was cancelled.` : `⚠️ ${result.error}`)
    }
    if (action === "fees") {
      const result = await confirmStandardProjectFees(id, telegramId, scheduleVersion)
      if (!result.ok) return editOrSendWorkflowMessage(token, chatId, messageId, `⚠️ ${result.error}`)
      if (result.alreadyActive) return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is already active.`)
      if (result.activated) return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is Active\nDaily trading fees begin ${result.dailyFeeStartDate}.`)
      const readiness = result.readiness
      return editOrSendWorkflowMessage(token, chatId, messageId, readiness.ready ? "✅ Fee setup confirmed. This launch is ready to activate." : `Fee setup confirmed. Still needed: ${readiness.missing.join(", ")}.`)
    }
    if (action === "refnone") {
      const result = await confirmNoProjectReferrer(id, telegramId, scheduleVersion)
      if (!result.ok) return editOrSendWorkflowMessage(token, chatId, messageId, `⚠️ ${result.error}`)
      if (result.alreadyActive) return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is already active.`)
      if (result.activated) return editOrSendWorkflowMessage(token, chatId, messageId, `✅ ${(result.project as any).name} is Active\nDaily trading fees begin ${result.dailyFeeStartDate}.`)
      const readiness = result.readiness
      return editOrSendWorkflowMessage(token, chatId, messageId, readiness.ready ? "✅ No referrer confirmed. This launch is ready to activate." : `No referrer confirmed. Still needed: ${readiness.missing.join(", ")}.`)
    }
  }

  if (area === "tz" && action === "set") {
    if (extra && Number(extra) !== telegramId) return
    const timeZone = timeZoneFromOption(id)
    const saved = await saveMemberTimeZone(telegramId, timeZone, "bot")
    if (!saved.ok) return sendMessage(token, chatId, `⚠️ ${saved.error}`)
    const state = await takeState(telegramId, chatId)
    if (state?.action === "timezone_for_reminder" && state.pendingText) {
      await clearState(telegramId)
      await sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}. Continuing your reminder…`)
      return sendAiResponse(token, chatId, telegramId, String(state.pendingText), undefined, context)
    }
    if (state?.action === "timezone_for_manual_reminder") {
      return beginTextWorkflow({
        token,
        chatId,
        telegramId,
        reviewMessageId: Number(state.reviewMessageId || state.promptMessageId || 0) || null,
        state: { action: "add_reminder" },
        text: reminderInputPrompt(saved.timeZone),
      })
    }
    await clearState(telegramId)
    return sendMessage(token, chatId, `✅ Your timezone is now ${saved.timeZone} (${teamZoneLabel(saved.timeZone)}).\nCurrent local time: ${formatTeamDateTime(new Date(), saved.timeZone)}`)
  }

  if (data === "main:menu") {
    const workflowMessageId = Number(callbackMessage?.message_id || 0) || null
    return editOrSendWorkflowMessage(token, chatId, workflowMessageId, helpMessage())
  }

  if (area === "launch" && action === "start") return sendLaunchCalculatorStart(token, chatId, telegramId)
  if (area === "launch" && action === "chain") return sendLaunchVenuePicker(token, chatId, id as LaunchChainId)
  if (area === "launch" && action === "venue") return sendLaunchMetricPicker(token, chatId, id)
  if (area === "launch" && action === "metric") {
    const pad = launchPad(extra)
    const metric = id as LaunchTargetMetric
    if (!pad || !(["supply", "market_cap"] as string[]).includes(metric)) return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (pad.type === "amm") {
      await setState(telegramId, { action: "launch_calc_lp", launchVenueId: pad.id, launchMetric: metric }, chatId)
      return sendMessage(token, chatId, `💧 What initial LP should ${pad.name} use?\n\nThis sets the opening price. Type another amount or use the suggested default.`, [
        [{ text: `Use ${pad.defaultLp} ${pad.symbol}`, callback_data: `launch:lp:default:${pad.id}` }],
        [{ text: "⬅️ Target type", callback_data: `launch:venue:${pad.id}` }],
      ])
    }
    await setState(telegramId, { action: "launch_calc_value", launchVenueId: pad.id, launchMetric: metric }, chatId)
    return sendMessage(token, chatId, launchTargetPrompt(metric, pad.name))
  }
  if (area === "launch" && action === "lp") {
    const pad = launchPad(extra)
    const state = await takeState(telegramId, chatId)
    if (!pad || state?.launchVenueId !== pad.id || state?.action !== "launch_calc_lp") return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (id === "default") {
      await setState(telegramId, { action: "launch_calc_value", launchInitialLp: pad.defaultLp }, chatId)
      return sendMessage(token, chatId, launchTargetPrompt(state.launchMetric as LaunchTargetMetric, pad.name))
    }
  }
  if (area === "launch" && action === "adjust") {
    const state = await takeState(telegramId, chatId)
    const pad = launchPad(String(state?.launchVenueId || ""))
    if (!pad || state?.action !== "launch_calc_result") return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (id === "target") {
      await setState(telegramId, { action: "launch_calc_value" }, chatId)
      return sendMessage(token, chatId, launchTargetPrompt(state.launchMetric as LaunchTargetMetric, pad.name))
    }
    if (id === "mm") {
      await setState(telegramId, { action: "launch_calc_mm" }, chatId)
      return sendMessage(token, chatId, `💧 Enter the ${pad.symbol} amount to reserve for initial MM trading.\n\nCurrent reserve: ${state.launchMmLiquidity} ${pad.symbol}\n\nSend /cancel to stop.`)
    }
  }

  if (area === "receipt" && action === "classify") {
    const receipt = await getRevenueReceipt(id)
    if (!receipt || receipt.direction !== "incoming" || receipt.status !== "unclassified") return sendMessage(token, chatId, "This receipt is no longer available for classification.")
    await clearState(telegramId)
    return sendMessage(token, chatId, `${receiptSummary(receipt)}\n\nChoose the revenue type:`, receiptTypeButtons(id))
  }
  if (area === "receipt" && action === "type") {
    if (!DIRECT_RECEIPT_FEE_TYPES.includes(extra as any)) return sendMessage(token, chatId, "That receipt classification is unsupported.")
    if (isGlobalRevenueFeeType(extra)) {
      await setState(telegramId, { action: "receipt_classification", receiptId: id, feeType: extra }, chatId)
      return sendReceiptConfirmation(token, chatId, telegramId, null)
    }
    return sendReceiptProjectPicker(token, chatId, telegramId, id, extra as FeeType)
  }
  if (area === "receipt" && action === "project") return sendReceiptConfirmation(token, chatId, telegramId, id)
  if (area === "receipt" && action === "confirm") {
    const state = await takeState(telegramId, chatId)
    if (state?.action !== "receipt_classification" || String(state.receiptId) !== id || !DIRECT_RECEIPT_FEE_TYPES.includes(state.feeType)) return sendMessage(token, chatId, "This classification menu expired. Start again from the receipt message.")
    const confirmed = await classifyReceiptAsRevenue({ receiptId: id, feeType: state.feeType as FeeType, projectId: state.projectId || null }, telegramId)
    await clearState(telegramId)
    return sendMessage(token, chatId, `✅ Revenue classified by Telegram. The admin app is already updated.\n\n${formatFeeExpectation(confirmed)}`)
  }
  if (area === "receipt" && action === "existing") return sendExistingExpectationPicker(token, chatId, telegramId, id)
  if (area === "receipt" && action === "expect") {
    const state = await takeState(telegramId, chatId)
    if (state?.action !== "receipt_expectation" || !state.receiptId) return sendMessage(token, chatId, "This expectation menu expired. Start again from the receipt message.")
    const confirmed = await acceptReceiptMatch(id, telegramId, [String(state.receiptId)])
    await clearState(telegramId)
    return sendMessage(token, chatId, `✅ Receipt linked to the existing expectation.\n\n${formatFeeExpectation(confirmed)}`)
  }

  if (area === "consol" && action === "view") {
    const batch = await getConsolidationCandidate(id)
    if (!batch) return sendMessage(token, chatId, "Consolidation batch was not found.")
    if (batch.status === "confirmed") return sendMessage(token, chatId, `✅ This batch is already confirmed internal.\n\n${formatConsolidationCandidate(batch)}`)
    if (batch.status === "rejected") return sendMessage(token, chatId, "This batch was rejected and its receipts remain available for revenue review.")
    return sendMessage(token, chatId, formatConsolidationCandidate(batch), [
      [{ text: "✅ Confirm all internal", callback_data: `consol:confirm:${id}` }],
      [{ text: "Not consolidation", callback_data: `consol:reject:${id}` }, { text: "Open detailed review", url: `${appBaseUrl(req)}/admin/revenue` }],
    ])
  }
  if (area === "consol" && action === "confirm") {
    const batch = await confirmConsolidationCandidate(id, telegramId)
    return sendMessage(token, chatId, `✅ Consolidation confirmed. Every source and destination leg is now internal.\n\n${formatConsolidationCandidate(batch)}`)
  }
  if (area === "consol" && action === "reject") {
    const batch = await rejectConsolidationCandidate(id, telegramId)
    await sendMessage(token, chatId, "Consolidation suggestion rejected. The destination receipts remain unclassified and can be handled below or in Revenue Inbox.")
    for (const receipt of (batch?.receipts || []).filter((row: any) => (batch?.destinationReceiptIds || []).includes(String(row._id))).slice(0, 10)) {
      const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
      await sendMessage(token, chatId, receiptSummary(receipt), receiptClassificationButtons(String(receipt._id), transactionUrl))
    }
    return
  }

  if (area === "fee" && action === "type") {
    const fee = await setFeeType(id, extra as FeeType)
    return sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nNow choose the existing project:`, await feeProjectButtons(id))
  }
  if (area === "fee" && action === "project") {
    const fee = await assignFeeProject(id, extra)
    const activeFeeId = String(fee._id || id)
    if (fee.status === "awaiting_asset") {
      const project = await db.collection("opsProjects").findOne({ _id: fee.projectId })
      const assets = projectFeeConfig(project).quoteAssets
      return sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nWhich quote asset was cashed out?`, assets.map((asset) => [{ text: asset, callback_data: `fee:asset:${activeFeeId}:${asset}` }]))
    }
    return sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nConfirm this expectation before matching wallet receipts.`, [[{ text: "✅ Confirm expectation", callback_data: `fee:confirm:${activeFeeId}` }]])
  }
  if (area === "fee" && action === "asset") {
    const fee = await setFeeQuoteAsset(id, extra)
    return sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nConfirm this expectation before matching wallet receipts.`, [[{ text: "✅ Confirm expectation", callback_data: `fee:confirm:${id}` }]])
  }
  if (area === "fee" && action === "confirm") {
    const fee = await confirmFeeExpectation(id, telegramId)
    if (!fee) return sendMessage(token, chatId, "Fee entry was not found.")
    return sendMessage(token, chatId, fee.status === "match_proposed" ? `${formatFeeExpectation(fee)}\n\nI found ${fee.proposedReceiptIds.length} receipt(s) that add up to the expected fee.` : `${formatFeeExpectation(fee)}\n\nNo exact receipt combination is available yet. I’ll keep it waiting.`, fee.status === "match_proposed" ? [[{ text: "✅ Accept receipt match", callback_data: `fee:match:${id}` }]] : undefined)
  }
  if (area === "fee" && action === "match") {
    const fee = await acceptReceiptMatch(id, telegramId)
    return sendMessage(token, chatId, `✅ Fee verified and ready for payroll accounting.\n\n${formatFeeExpectation(fee)}`)
  }
  if (area === "fee" && action === "search") {
    await setState(telegramId, { action: "fee_project_search", feeId: id }, chatId)
    return sendMessage(token, chatId, "Type part of the existing project name. Send /cancel to stop.")
  }
  if (area === "fee" && action === "receipt") {
    const receipt = await getRevenueReceipt(id)
    if (!receipt) return sendMessage(token, chatId, "Receipt was not found.")
    const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
    return sendMessage(token, chatId, `Revenue receipt\n\n${receipt.amount} ${receipt.asset}\nChain: ${revenueChainLabel(receipt.chain)}\nStatus: ${receipt.status}\nTransaction: ${receipt.transactionHash}`, receiptClassificationButtons(id, transactionUrl))
  }
  if (area === "fee" && (action === "internal" || action === "ignore")) {
    const receipt = await getRevenueReceipt(id)
    if (action === "internal" && receipt?.consolidationBatchId) {
      const batch = await getConsolidationCandidate(String(receipt.consolidationBatchId))
      if (batch && ["collecting", "suggested"].includes(batch.status)) return sendMessage(token, chatId, formatConsolidationCandidate(batch), [[{ text: "✅ Confirm entire batch internal", callback_data: `consol:confirm:${batch._id}` }, { text: "Review", callback_data: `consol:view:${batch._id}` }]])
    }
    await updateReceiptClassification(id, action === "internal" ? "internal" : "ignored")
    return sendMessage(token, chatId, action === "internal" ? "✅ Marked as an internal movement; it will not count as new revenue." : "✅ Receipt ignored.")
  }
  if (data === "projects:list") return sendProjects(token, chatId)
  if (data === "data:list") return sendDataProjects(token, chatId)
  if (area === "notes" && action === "project") return sendProjectNotes(token, chatId, id, Number(callbackMessage?.message_id || 0) || null)

  if (area === "ai" && action === "confirm") {
    const pendingLaunch = await db.collection("opsAiActions").findOne({ _id: id })
    if (pendingLaunch?.status === "pending" && pendingLaunch.actionType === "create_project" && (pendingLaunch.payload?.launchAt || pendingLaunch.payload?.launchDate || pendingLaunch.payload?.tentativeLaunchDate) && aiPermissionPolicy(context).dataScope === "launch") {
      return showLaunchSetupReview(token, chatId, pendingLaunch, Number(callbackMessage?.message_id || 0) || null, "Review every launch detail before creating it.")
    }
    const previewMessageId = Number(callbackMessage?.message_id || 0) || null
    return sendAsyncResponse(token, chatId, async () => {
      const pending = await db.collection("opsAiActions").findOne({ _id: id })
      const policy = aiPermissionPolicy(context)
      const text = await executeOpsAiAction(id, telegramId, { allowedActionTypes: policy.allowedActionTypes, currentChatId: chatId, dataScope: policy.dataScope })
      if (text.startsWith("✅") && pending?.actionType === "create_reminder" && previewMessageId) {
        await deleteWorkflowMessages(token, chatId, [previewMessageId])
      }
      const launchDate = pending?.payload?.launchDate || pending?.payload?.startDate
      const changedLaunch = ["create_project", "update_project"].includes(String(pending?.actionType || "")) && launchDate
      if (!text.startsWith("✅") || !changedLaunch) return { text }
      const schedule = await formatLaunchDaySchedule(launchDate)
      return { text: `${text}\n\n${schedule}` }
    }, "✅ Applying…")
  }
  if (area === "ai" && action === "reject") {
    return sendAsyncResponse(token, chatId, async () => ({
      text: await rejectOpsAiAction(id, telegramId),
    }))
  }
  if (area === "ai" && (action === "newest" || action === "oldest")) {
    return sendAsyncResponse(token, chatId, async () => {
      const picked = await chooseOpsAiActionCandidate(id, action, telegramId)
      return {
        text: picked.message,
        inline: picked.ok ? [
          [{ text: "✅ Confirm", callback_data: `ai:confirm:${id}` }, { text: "❌ Refuse", callback_data: `ai:reject:${id}` }],
        ] : undefined,
      }
    }, "🧠 Working on it…")
  }

  if (area === "project" && action === "add") {
    await setState(telegramId, { action: "add_project" }, chatId)
    return sendMessage(token, chatId, "➕ Send the new project like this:\n\nProject Name | Owner | YYYY-MM-DD | active\n\nSend /cancel to stop.")
  }
  if (area === "project" && action === "view") return sendProjectDetail(token, chatId, id)
  if (area === "project" && action === "edit") {
    await setState(telegramId, { action: "edit_project", projectId: id }, chatId)
    return sendMessage(token, chatId, "✏️ Send updated project:\n\nProject Name | Owner | YYYY-MM-DD | active\n\nSend /cancel to stop.")
  }
  if (area === "project" && action === "toggle") {
    const project = await db.collection("opsProjects").findOne({ _id: id })
    if (!project) return sendMessage(token, chatId, "Project not found.")
    if (["scheduled", "in_progress"].includes(String(project.status || ""))) return sendMessage(token, chatId, "🕒 This project is Scheduled. Confirm it from the Launch Chat prompt when the token launches, or update the launch time if it is delayed.")
    if (project.status === "active") {
      await deactivateActiveProject({ projectId: id, telegramId, source: "project_management", chatId })
    } else if (projectLaunchAt(project)) {
      const readiness = projectActivationReadiness(project)
      if (!readiness.ready) return sendMessage(token, chatId, `⚠️ Complete ${readiness.missing.join(", ")} before activation.`)
      await db.collection("opsProjects").updateOne({ _id: id }, { $set: activationLifecycleFields(project, { actual: "now", telegramId, source: "manual_dashboard" }) })
    } else {
      await db.collection("opsProjects").updateOne({ _id: id }, { $set: { status: "active", activatedAt: new Date().toISOString(), activationSource: "project_management", updatedAt: new Date() } })
    }
    return sendProjectDetail(token, chatId, id)
  }
  if (area === "project" && action === "delete") {
    const result = await deleteProjectCascade(id)
    await sendMessage(token, chatId, `🗑 Project and ${result.deleted} related records removed.`)
    return sendProjects(token, chatId)
  }

  if (area === "note" && action === "add") {
    const member = await db.collection("guardMembers").findOne({ telegramId })
    await beginTextWorkflow({
      token,
      chatId,
      telegramId,
      reviewMessageId: Number(callbackMessage?.message_id || 0) || null,
      state: { action: "add_project_note", projectId: id, authorName: member?.name || member?.firstName || member?.username || "Team member" },
      text: "Send one note as a single message. It will be timestamped and attributed to you.\n\nSend /cancel to stop.",
    })
    return
  }

  if (area === "data" && action === "project") return sendProjectSheets(token, chatId, id)
  if (area === "sheet" && action === "add") {
    return sendMessage(token, chatId, "Choose data file type:", [
      ...SHEET_KIND_ORDER.map((kind) => [{ text: `Create ${getSheetSchema(kind).title}`, callback_data: `sheet:create:${id}:${kind}` }]),
      [{ text: "⬅️ Back", callback_data: `data:project:${id}` }],
    ])
  }
  if (area === "sheet" && action === "create") {
    const kind = (extra || "custom") as SheetKind
    const project = await db.collection("opsProjects").findOne({ _id: id })
    const schema = getSheetSchema(kind)
    const sheet = { title: schema.title, tabName: schema.tabName, category: schema.category, sheetType: kind, description: `Created from bot.`, projectId: id, projectName: project?.name || "", values: [schema.headers], sourceType: "bot", createdAt: new Date(), updatedAt: new Date() }
    await db.collection("opsSheets").insertOne(sheet)
    await sendMessage(token, chatId, "✅ Data file created.")
    return sendProjectSheets(token, chatId, id)
  }
  if (area === "sheet" && action === "view") return sendSheetDetail(token, chatId, id)
  if (area === "sheet" && action === "addrow") {
    const sheet = await db.collection("opsSheets").findOne({ _id: id })
    const headers = getSheetSchema(sheet?.sheetType || "custom").headers
    await setState(telegramId, { action: "add_sheet_row", sheetId: id }, chatId)
    return sendMessage(token, chatId, `➕ Send row values separated by |:\n\n${headers.join(" | ")}\n\nSend /cancel to stop.`)
  }
  if (area === "sheet" && action === "delete") {
    const sheet = await db.collection("opsSheets").findOne({ _id: id })
    await db.collection("opsSheets").deleteOne({ _id: id })
    await sendMessage(token, chatId, "🗑 Data file removed.")
    return sheet?.projectId ? sendProjectSheets(token, chatId, sheet.projectId) : sendDataProjects(token, chatId)
  }

  if (area === "reminderto") {
    const state = await takeState(telegramId, chatId)
    const messageId = Number(callbackMessage?.message_id || state?.promptMessageId || 0) || null
    if (state?.action !== "reminder_audience" || !state.reminderDraft?.ok) {
      return editOrSendWorkflowMessage(token, chatId, messageId, "This reminder picker expired. Open /reminders and try again.")
    }
    if (action === "cancel") {
      await clearState(telegramId)
      return editOrSendWorkflowMessage(token, chatId, messageId, "Cancelled.")
    }
    const members = await listReminderEligibleMembers(chatId)
    const selectedTargetIds = Array.isArray(state.selectedTargetIds) ? state.selectedTargetIds.map(Number).filter(Number.isFinite) : []
    if (action === "toggle") {
      const targetId = Number(id)
      if (!members.some((member) => member.telegramId === targetId)) {
        return showReminderAudiencePicker(token, chatId, messageId, selectedTargetIds, "That trader is no longer available in this chat.")
      }
      const nextSelected = selectedTargetIds.includes(targetId)
        ? selectedTargetIds.filter((telegramIdValue: number) => telegramIdValue !== targetId)
        : [...selectedTargetIds, targetId]
      await setState(telegramId, {
        action: "reminder_audience",
        reminderDraft: state.reminderDraft,
        targetChatTitle: state.targetChatTitle,
        selectedTargetIds: nextSelected,
        reviewMessageId: state.reviewMessageId || messageId,
        promptMessageId: messageId,
      }, chatId)
      return showReminderAudiencePicker(token, chatId, messageId, nextSelected)
    }
    let targetMode: "everyone" | "creator" | "specific" = "everyone"
    let targetMembers: ReminderTarget[] = []
    if (action === "me") {
      const creator = await reminderTargetForTelegramId(telegramId)
      if (!creator) return showReminderAudiencePicker(token, chatId, messageId, selectedTargetIds, "I couldn’t identify your enrolled Telegram account.")
      targetMode = "creator"
      targetMembers = [creator]
    } else if (action === "save") {
      targetMembers = members.filter((member) => selectedTargetIds.includes(member.telegramId))
      if (!targetMembers.length) return showReminderAudiencePicker(token, chatId, messageId, selectedTargetIds, "Choose at least one trader, or use Everyone.")
      targetMode = "specific"
    } else if (action !== "everyone") {
      return showReminderAudiencePicker(token, chatId, messageId, selectedTargetIds)
    }
    await completeManualReminder({
      token,
      chatId,
      telegramId,
      draft: state.reminderDraft,
      targetMode,
      targetMembers,
      targetChatTitle: String(state.targetChatTitle || callbackMessage?.chat?.title || chatId),
      workflowMessageId: messageId,
    })
    return
  }

  if (area === "reminder" && action === "add") {
    const reviewMessageId = Number(callbackMessage?.message_id || 0) || null
    if (!(await getMemberTimeZone(telegramId))) {
      await setState(telegramId, { action: "timezone_for_manual_reminder", reviewMessageId, promptMessageId: reviewMessageId }, chatId)
      return editOrSendWorkflowMessage(token, chatId, reviewMessageId, timeZonePrompt(), timeZoneButtons(telegramId))
    }
    return beginTextWorkflow({
      token,
      chatId,
      telegramId,
      reviewMessageId,
      state: { action: "add_reminder" },
      text: reminderInputPrompt(),
    })
  }
  if (area === "reminder" && action === "view") {
    const workflowMessageId = Number(callbackMessage?.message_id || 0) || null
    const reminder = await db.collection("opsReminders").findOne({ _id: id, deliveryScope: "chat", telegramChatId: String(chatId) })
    if (!reminder) return sendReminders(token, chatId, workflowMessageId)
    return editOrSendWorkflowMessage(token, chatId, workflowMessageId, `🔔 ${reminder.title}\n\nDue: ${dateLabel(reminder.dueAt, String(reminder.timeZone || TEAM_TIME_ZONE))}\nRepeat: ${reminder.recurrence || "none"}\nNotify: ${reminderTargetsLabel(reminder.targetMode, reminder.targetMembers)}\nStatus: ${reminder.status || "scheduled"}\n\n${reminder.message || ""}`, [
      [{ text: "✅ Mark Done", callback_data: `reminder:done:${id}` }, { text: "🗑 Remove", callback_data: `reminder:delete:${id}` }],
      [{ text: "⬅️ Reminders", callback_data: "reminders:list" }],
    ])
  }
  if (area === "reminder" && action === "done") {
    await db.collection("opsReminders").updateOne({ _id: id, deliveryScope: "chat", telegramChatId: String(chatId) }, { $set: { status: "done", updatedAt: new Date() } })
    return sendReminders(token, chatId, Number(callbackMessage?.message_id || 0) || null)
  }
  if (area === "reminder" && action === "delete") {
    await db.collection("opsReminders").deleteOne({ _id: id, deliveryScope: "chat", telegramChatId: String(chatId) })
    return sendReminders(token, chatId, Number(callbackMessage?.message_id || 0) || null)
  }
  if (data === "reminders:list") return sendReminders(token, chatId, Number(callbackMessage?.message_id || 0) || null)

  if (area === "payroll" && action === "add") {
    await setState(telegramId, { action: "add_payroll" }, chatId)
    return sendMessage(token, chatId, "➕ Send payroll row like this:\n\nMember | Amount | Project | YYYY-MM-DD\n\nSend /cancel to stop.")
  }
  if (area === "payroll" && action === "paid") {
    await db.collection("opsPayroll").updateOne({ _id: id }, { $set: { status: "paid", updatedAt: new Date() } })
    return sendPayroll(token, chatId)
  }

  return sendMessage(token, chatId, helpMessage())
}

async function routeText(token: string, chatId: number | string, telegramId: number, text: string, req: NextRequest, messageDateMs: number, message?: any) {
  const commandText = stripBotCommandSuffix(text)
  const context = await botPermissions(telegramId, chatId)
  const setChatCommand = commandText.match(/^\/setchat(?:\s+(.+))?$/i)
  if (setChatCommand) {
    if (context.role !== "admin") return sendMessage(token, chatId, botPermissionDeniedMessage(context, "management"))
    if (!isGroupChatId(chatId)) return sendMessage(token, chatId, "⛔ /setchat must be run inside the Telegram group being configured.")
    if (!(await telegramUserIsChatAdmin(token, chatId, telegramId))) return sendMessage(token, chatId, "⛔ You must also be a Telegram administrator of this group to change its profile.")
    const profile = normalizeChatProfile(setChatCommand[1])
    if (!profile) return sendMessage(token, chatId, "Choose a profile: /setchat launch, /setchat trade, /setchat fee, /setchat finance, or /setchat management.")
    const configured = await setChatProfile({
      chatId,
      profile,
      title: message?.chat?.title || message?.chat?.username || "",
      chatType: message?.chat?.type || "group",
      telegramId,
    })
    const enrollment = await prepareGuardEnrollment(token, chatId, telegramId, profile, message)
    const notifications = configured.notifications.map(chatPurposeLabel)
    return sendMessage(token, chatId, [
      `✅ This chat is now the ${chatProfileLabel(profile)}.`,
      "",
      `Access: ${profileAccessSummary(profile)}`,
      `Automatic notifications: ${notifications.length ? notifications.join(", ") : "none"}`,
      "",
      `Guard enrollment: ${enrollment.synced.memberCount == null ? "member count unavailable" : `${enrollment.synced.memberCount} Telegram members`} · ${enrollment.synced.administrators} administrator candidate(s) synced`,
      enrollment.url ? "Existing team members should tap the button once. Telegram membership is verified before access is granted." : "Bot username is missing, so the Guard enrollment button could not be generated.",
    ].join("\n"), enrollment.url ? [[{ text: "🛡 Join GhostBot Guard", url: enrollment.url }]] : undefined)
  }
  if (/^\/chatprofile$/i.test(commandText)) {
    const profile = await getChatProfile(chatId)
    if (!profile?.profile) return sendMessage(token, chatId, "This chat is not configured yet. A GhostBot admin can use /setchat.")
    const notifications = (await listChatSubscriptions(chatId)).map((row: any) => chatPurposeLabel(row.purpose)).filter(Boolean)
    return sendMessage(token, chatId, `${chatProfileLabel(profile.profile as ChatProfile)}\n\nAccess: ${profileAccessSummary(profile.profile as ChatProfile)}\nAutomatic notifications: ${notifications.length ? notifications.join(", ") : "none"}`)
  }
  const guardLinkCommand = commandText.match(/^\/guardlink(?:\s+(show|refresh|revoke))?$/i)
  if (guardLinkCommand) {
    if (context.role !== "admin") return sendMessage(token, chatId, botPermissionDeniedMessage(context, "management"))
    if (!isGroupChatId(chatId)) return sendMessage(token, chatId, "⛔ /guardlink must be run inside the configured Telegram group.")
    if (!(await telegramUserIsChatAdmin(token, chatId, telegramId))) return sendMessage(token, chatId, "⛔ You must also be a Telegram administrator of this group to manage its Guard enrollment link.")
    const configuredChat = await getChatProfile(chatId)
    if (!configuredChat?.profile) return sendMessage(token, chatId, "Configure this group with /setchat before creating a Guard enrollment link.")
    const action = String(guardLinkCommand[1] || "show").toLowerCase()
    if (action === "revoke") {
      const revoked = await revokeGuardEnrollmentLinks(chatId, telegramId)
      return sendMessage(token, chatId, `✅ Guard enrollment link revoked${revoked.revoked ? "" : "; there was no active link"}. Existing Guard access is unchanged.`)
    }
    const enrollment = await prepareGuardEnrollment(token, chatId, telegramId, configuredChat.profile as ChatProfile, message, action === "refresh")
    if (!enrollment.url) return sendMessage(token, chatId, "The bot username is not configured, so I could not generate the enrollment URL.")
    return sendMessage(token, chatId, `${action === "refresh" ? "✅ A new Guard enrollment link replaced the previous link." : "🛡 Guard team enrollment"}\n\nTelegram membership is verified before Member access is granted. The link expires ${dateLabel(enrollment.link.expiresAt)}.`, [[{ text: "🛡 Join GhostBot Guard", url: enrollment.url }]])
  }
  const subscribeCommand = commandText.match(/^\/(subscribe|unsubscribe)(?:\s+(.+))?$/i)
  const naturalLaunchSubscription = /\b(?:make|set|use)\s+this\s+(?:group|chat)\s+(?:as\s+)?(?:the\s+)?launch(?:es)?\s+(?:chat|channel)|\bsend\s+(?:the\s+)?(?:daily\s+|morning\s+)?launch\s+(?:schedule|updates?)\s+to\s+this\s+(?:group|chat)\b/i.test(commandText)
  if (subscribeCommand || naturalLaunchSubscription) {
    if (context.role !== "admin") return sendMessage(token, chatId, botPermissionDeniedMessage(context, "management"))
    if (!(await telegramUserIsChatAdmin(token, chatId, telegramId))) return sendMessage(token, chatId, "⛔ You must also be a Telegram administrator of this group to change notifications.")
    if (naturalLaunchSubscription) {
      await setChatProfile({ chatId, profile: "launch", title: message?.chat?.title || "", chatType: message?.chat?.type || "group", telegramId })
      const enrollment = await prepareGuardEnrollment(token, chatId, telegramId, "launch", message)
      return sendMessage(token, chatId, [
        "✅ This chat is now the Launch Chat.",
        "",
        "Access: launch schedule, launch calculator, natural-language launch management, and this chat's reminders",
        "Automatic notifications: Launch updates",
        "",
        `Guard enrollment: ${enrollment.synced.memberCount == null ? "member count unavailable" : `${enrollment.synced.memberCount} Telegram members`} · ${enrollment.synced.administrators} administrator candidate(s) synced`,
      ].join("\n"), enrollment.url ? [[{ text: "🛡 Join GhostBot Guard", url: enrollment.url }]] : undefined)
    }
    const active = naturalLaunchSubscription || subscribeCommand?.[1].toLowerCase() === "subscribe"
    const requestedPurpose = String(subscribeCommand?.[2] || "").trim()
    if (active && /finance|financial/i.test(requestedPurpose)) {
      return sendMessage(token, chatId, "Finance Chat automatic reports are disabled. Finance functions remain available on demand.")
    }
    if (!active && requestedPurpose.toLowerCase() === "all") {
      for (const purpose of ["launches", "finance", "payroll", "reminders", "fees"] as const) {
        await setChatSubscription({ chatId, purpose, active: false, title: message?.chat?.title || "", chatType: message?.chat?.type || "group", telegramId })
      }
      return sendMessage(token, chatId, "✅ All automatic notifications are disabled for this chat. Its permission profile is unchanged.")
    }
    const purpose = naturalLaunchSubscription ? "launches" : normalizeChatPurpose(requestedPurpose)
    if (!purpose) return sendMessage(token, chatId, /daily|trade|performance/i.test(requestedPurpose)
      ? "Trade Floor automatic daily updates have been removed. Trade Floor only receives messages and reminders explicitly created there."
      : "Choose an update type: launches or fees.")
    if (active && !context.profile) return sendMessage(token, chatId, "⛔ Configure this group with /setchat before changing its automatic notifications.")
    if (active && context.profile && !notificationAllowedForProfile(context.profile, purpose)) {
      return sendMessage(token, chatId, `⛔ ${chatPurposeLabel(purpose)} cannot be enabled in a ${chatProfileLabel(context.profile)}. Change the chat profile with /setchat if this group has a different purpose.`)
    }
    await setChatSubscription({
      chatId,
      purpose,
      active,
      title: message?.chat?.title || message?.chat?.username || "",
      chatType: message?.chat?.type || (isGroupChatId(chatId) ? "group" : "private"),
      telegramId,
    })
    const confirmation = purpose === "fees"
      ? "This is now the private Fee Inbox. Forward standardized fee/cashout messages here, and I’ll also post new revenue-wallet receipts."
      : purpose === "launches"
        ? `This chat is subscribed to ${chatPurposeLabel(purpose)}.\n\nI’ll post the complete launch schedule here each morning in ET.`
        : purpose === "finance"
          ? `This chat is subscribed to ${chatPurposeLabel(purpose)}.\n\nI’ll post one summarized finance report here.`
          : `This chat is subscribed to ${chatPurposeLabel(purpose)}.`
    return sendMessage(token, chatId, active
      ? `✅ ${confirmation}`
      : `✅ This chat is no longer subscribed to ${chatPurposeLabel(purpose)}.`)
  }
  if (/^\/subscriptions$/i.test(commandText)) {
    const subscriptions = await listChatSubscriptions(chatId)
    const labels = subscriptions.map((row: any) => chatPurposeLabel(row.purpose)).filter(Boolean)
    return sendMessage(token, chatId, `📣 Scheduled updates for this chat\n\n${labels.length ? labels.map((label: string) => `• ${label}`).join("\n") : "No scheduled updates are subscribed here."}`)
  }
  const timeZoneCommand = commandText.match(/^\/timezone(?:\s+(.+))?$/i)
  if (timeZoneCommand) {
    const requested = String(timeZoneCommand[1] || "").trim()
    if (!requested) {
      const current = await getMemberTimeZone(telegramId)
      const intro = current
        ? `🌍 Your timezone is ${current} (${teamZoneLabel(current)}).\nCurrent local time: ${formatTeamDateTime(new Date(), current)}\n\nChoose a different timezone:`
        : timeZonePrompt()
      return sendMessage(token, chatId, intro, timeZoneButtons(telegramId))
    }
    const saved = await saveMemberTimeZone(telegramId, requested, "bot")
    if (!saved.ok) return sendMessage(token, chatId, "⚠️ I could not recognize that timezone. Try /timezone America/Los_Angeles or use /timezone to choose.")
    const state = await takeState(telegramId, chatId)
    if (state?.action === "timezone_for_reminder" && state.pendingText) {
      await clearState(telegramId)
      await sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}. Continuing your reminder…`)
      return sendAiResponse(token, chatId, telegramId, String(state.pendingText), message, context)
    }
    if (state?.action === "timezone_for_manual_reminder") {
      return beginTextWorkflow({
        token,
        chatId,
        telegramId,
        reviewMessageId: Number(state.reviewMessageId || state.promptMessageId || 0) || null,
        state: { action: "add_reminder" },
        text: reminderInputPrompt(saved.timeZone),
      })
    }
    return sendMessage(token, chatId, `✅ Your timezone is now ${saved.timeZone} (${teamZoneLabel(saved.timeZone)}).`)
  }
  const addLaunchCommand = commandText.match(/^\/addlaunch(?:@\w+)?$/i)
  const scheduleLaunchCommand = commandText.match(/^\/schedulelaunch(?:@\w+)?(?:\s+([\s\S]+))?$/i)
  const organicSetupCommand = commandText.match(/^\/organicsetup(?:@\w+)?(?:\s+([\s\S]+))?$/i)
  const aiCommand = aiCommandText(commandText)
  if (addLaunchCommand) {
    if (!(await requireCapability(token, context, "launch"))) return
    await clearState(telegramId)
    await beginTextWorkflow({
      token,
      chatId,
      telegramId,
      state: { action: "add_launch_wizard_name", startedAt: messageDateMs || Date.now() },
      text: "What is the exact project name?\n\nExample: Pathelous\nSend /cancel to stop.",
    })
    return
  }
  if (scheduleLaunchCommand) {
    if (!(await requireCapability(token, context, "launch"))) return
    const request = String(scheduleLaunchCommand[1] || "").trim()
    await clearState(telegramId)
    if (request) return sendAiResponse(token, chatId, telegramId, request, message, context)
    await setState(telegramId, { action: "schedule_launch_request", startedAt: messageDateMs || Date.now() }, chatId)
    return sendMessage(token, chatId, "Send the launch in natural language.\n\nExample: SnapGame on Pump.fun, launching today at 5:10 PM ET\n\nI’ll open a review where you can confirm the name, chain, launchpad, quote token, fees, and referrer before anything is created. Send /cancel to stop.")
  }
  if (organicSetupCommand) {
    if (!(await requireCapability(token, context, "launch"))) return
    await clearState(telegramId)
    return startOrganicChannelSetup(token, chatId, telegramId, String(organicSetupCommand[1] || ""))
  }
  if (text === "🚀 Launch Calc" || isBotCommand(text, "launchcalc")) {
    if (!(await requireCapability(token, context, "launch"))) return
    return sendLaunchCalculatorStart(token, chatId, telegramId)
  }
  if (aiCommand !== null) {
    const policy = aiPermissionPolicy(context)
    if (!(await requireCapability(token, context, policy.capability))) return
    await clearState(telegramId)
    if (aiCommand) return sendAiResponse(token, chatId, telegramId, aiCommand, message, context)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() }, chatId)
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  if (text === "🧠 AI") {
    const policy = aiPermissionPolicy(context)
    if (!(await requireCapability(token, context, policy.capability))) return
    await clearState(telegramId)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() }, chatId)
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  const navigationCommands = new Set(["calendar", "menu", "help", "commands", "projects", "profit", "payroll", "fees", "report", "reminders", "notes", "launchcalc", "addlaunch", "setreminder"])
  const navigationInput = navigationCommands.has(botCommandName(text)) || isGroupMenuButton(text)
  if (navigationInput) await clearState(telegramId)
  else if (await processState(token, chatId, telegramId, text, messageDateMs, message, context)) return

  if (/^(?:all\s+)?(?:launches?\s+)?(?:are\s+)?still\s+tbd(?:\s+today)?[.!]?$/i.test(commandText)) {
    if (!(await requireCapability(token, context, "launch"))) return
    if (context.profile !== "launch") return sendMessage(token, chatId, "⛔ Tentative launch confirmations must be handled in the configured Launch Chat.")
    return acknowledgeTentativeLaunches(token, chatId, telegramId, dateKeyInTimeZone(new Date(), TEAM_TIME_ZONE))
  }

  if (text === "🏠 Home" || isBotCommand(text, "menu", "help", "commands")) return sendMessage(token, chatId, helpMessage())
  if (/^\/log(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (!(await requireCapability(token, context, "finance"))) return
    return logProjectIncome(token, chatId, text)
  }
  if (text === "📁 Projects" || text === "🟡 Projects" || isBotCommand(text, "projects")) {
    if (!(await requireCapability(token, context, "trade"))) return
    return sendProjects(token, chatId)
  }
  if (text === "📈 Profit" || isBotCommand(text, "profit")) {
    if (!(await requireCapability(token, context, "finance"))) return
    return sendAsyncResponse(token, chatId, async () => ({
      text: await answerOpsBot("profit today", telegramId),
    }), "📈 Checking…")
  }
  if (text === "💸 Payroll" || isBotCommand(text, "payroll")) {
    if (!(await requireCapability(token, context, "finance"))) return
    return sendPayroll(token, chatId)
  }
  if (isBotCommand(text, "fees")) {
    if (!(await requireCapability(token, context, "finance"))) return
    const day = await listRevenueDay()
    return sendMessage(token, chatId, `💰 Revenue Inbox today\n\nExpected fees: ${day.summary.fees}\nVerified: ${day.summary.confirmedFees}\nNeeds review: ${day.summary.unresolvedFees}\nUnclassified receipts: ${day.summary.unclassifiedReceipts}\nRecognized: ${Number(day.summary.recognizedUsd).toLocaleString("en-US", { style: "currency", currency: "USD" })}`, [[{ text: "Open Revenue Inbox", url: `${appBaseUrl(req)}/admin/revenue` }]])
  }
  if (isBotCommand(text, "report") || /^\/report(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (!(await requireCapability(token, context, "finance"))) return
    return sendPayrollReport(token, chatId, text, req)
  }
  if (text === "📅 Calendar" || text === "🟠 Calendar" || isBotCommand(text, "calendar")) {
    const capability: BotCapability = context.profile === "trade" ? "trade" : "launch"
    if (!(await requireCapability(token, context, capability))) return
    const requestedDay = commandText.replace(/^\/calendar(?:\s+|$)/i, "").trim()
    const targetDate = requestedDay ? parseNaturalTeamDate(requestedDay, TEAM_TIME_ZONE, new Date()) : dateKeyInTimeZone(new Date(), TEAM_TIME_ZONE)
    if (requestedDay && !targetDate) return sendMessage(token, chatId, "I could not read that day. Try /calendar tomorrow or /calendar 2026-08-26.")
    return sendCalendar(token, chatId, targetDate)
  }
  if (text === "🔔 Reminders" || isBotCommand(text, "reminders")) {
    const capability: BotCapability = context.profile === "launch" ? "launch" : "trade"
    if (!(await requireCapability(token, context, capability))) return
    return sendReminders(token, chatId)
  }
  if (isBotCommand(text, "setreminder")) {
    const capability: BotCapability = context.profile === "launch" ? "launch" : "trade"
    if (!(await requireCapability(token, context, capability))) return
    const reminderRequest = commandText.replace(/^\/setreminder(?:\s+|$)/i, "Remind the team ").trim()
    return sendAiResponse(token, chatId, telegramId, reminderRequest, message, context)
  }
  if (text === "📝 Notes" || isBotCommand(text, "notes")) {
    if (!(await requireCapability(token, context, "trade"))) return
    return sendProjectNotes(token, chatId, "all")
  }

  if (await maybeRequestReminderTimeZone(token, chatId, telegramId, text)) return
  const policy = aiPermissionPolicy(context)
  if (!(await requireCapability(token, context, policy.capability))) return
  const aiOptions = await buildAiOptions(telegramId, chatId, message, context)
  return sendAsyncResponse(token, chatId, async () => {
    const proposed = await maybeProposeAction(text, telegramId, aiOptions)
    if (proposed) {
      return {
        text: proposed.message,
        inline: proposed.buttons || (proposed.actionId ? [
          [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
        ] : undefined),
      }
    }
    if (policy.dataScope === "launch") return { text: /\bnotes?\b/i.test(text) ? await answerProjectNotes(text) : "I can add, update, reschedule, cancel, or add notes to launches here. Use /calendar to view the schedule or /launchcalc for launch math." }
    if (policy.dataScope === "trade") return { text: "I can update project operations, add project notes, and create one-time or recurring reminders for this Trade Floor. Financial and revenue questions are unavailable here." }
    if (context.profile === "fee") return { text: "Use the receipt and fee controls in this chat to review incoming revenue." }
    return { text: await answerOpsBot(text, telegramId, aiOptions) }
  }, "🧠 Working on it…")
}

export async function POST(req: NextRequest) {
  const token = await getTelegramBotToken()
  if (!token) return NextResponse.json({ error: "Telegram bot token missing" }, { status: 500 })

  const update = await req.json().catch(() => ({}))
  if (update.chat_member) {
    await handleGuardChatMemberUpdate(update.chat_member).catch((error) => {
      console.error("[guard-enrollment] chat member sync failed", error)
    })
    return NextResponse.json({ ok: true })
  }
  if (update.my_chat_member) {
    await handleOrganicChannelMembershipUpdate(token, update.my_chat_member).catch((error) => {
      console.error("[organic-channel-setup] channel setup failed", error)
    })
    await handleGuardBotMembershipUpdate(update.my_chat_member).catch((error) => {
      console.error("[guard-enrollment] bot membership sync failed", error)
    })
    return NextResponse.json({ ok: true })
  }
  const callback = update.callback_query
  const message = update.message || update.edited_message || callback?.message
  const text = String(update.message?.text || update.message?.caption || update.edited_message?.text || update.edited_message?.caption || "").trim()
  const messageDateMs = Number(update.message?.date || update.edited_message?.date || 0) * 1000 || Date.now()
  const forwardedDateMs = Number(update.message?.forward_origin?.date || update.message?.forward_date || 0) * 1000 || messageDateMs
  const chatId = message?.chat?.id
  const from = update.message?.from || update.edited_message?.from || callback?.from
  const telegramId = from?.id ? Number(from.id) : null
  if (!chatId) return NextResponse.json({ ok: true })

  if (callback?.id) {
    await answerCallback(token, callback.id)
    const ok = await ensureAccess({ token, chatId, telegramId, text: "", profile: from, req })
    if (ok) await hostGroupIfAllowed(message?.chat, from)
    if (ok && telegramId) {
      try {
        await handleCallback(token, chatId, telegramId, String(callback.data || ""), req, callback.message)
      } catch (error) {
        await sendMessage(token, chatId, `⚠️ ${error instanceof Error ? error.message : "That revenue action could not be completed."}`)
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (!text) return NextResponse.json({ ok: true })

  if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    void setBotCommands(token)
    const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
    if (ok) await hostGroupIfAllowed(message?.chat, from)
    if (ok) await sendMessage(token, chatId, helpMessage())
    return NextResponse.json({ ok: true })
  }

  const chat = message?.chat
  const entities = update.message?.entities || update.edited_message?.entities || []

  if (isGroupChat(chat)) {
    const forwarded = Boolean(message?.forward_origin || message?.forward_date || message?.forward_from_chat || message?.forward_sender_name)
    if (forwarded && await isFeeInboxChat(chatId)) {
      const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
      if (ok) await hostGroupIfAllowed(chat, from)
      if (ok && telegramId) {
        const context = await botPermissions(telegramId, chatId)
        if (!(await requireCapability(token, context, "finance"))) return NextResponse.json({ ok: true })
        const created = await createForwardedFeeEvent({ chatId, messageId: Number(message.message_id), text, telegramId, messageDate: new Date(forwardedDateMs) })
        const fee = created.fee
        if (created.duplicate) await sendMessage(token, chatId, "This forwarded message is already in Revenue Inbox.")
        else if (!fee.feeType) await sendMessage(token, chatId, `I saved the message but could not classify the fee. Choose the type:`, [[{ text: "Liquidation", callback_data: `fee:type:${fee._id}:liquidation` }], [{ text: "Daily trading", callback_data: `fee:type:${fee._id}:daily_trading` }, { text: "Launch / TGE cash", callback_data: `fee:type:${fee._id}:launch` }], [{ text: "Dev allocation", callback_data: `fee:type:${fee._id}:dev_allocation` }]])
        else await sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nChoose the existing project:`, await feeProjectButtons(String(fee._id)))
      }
      return NextResponse.json({ ok: true })
    }
    const pendingState = telegramId ? await takeState(telegramId, chatId) : null
    const groupMessage = pendingState
      ? { shouldRoute: true as const, routedText: text }
      : await resolveGroupMessage(text, entities, message)
    if (!groupMessage.shouldRoute) {
      await hostGroupIfAllowed(chat, from)
      return NextResponse.json({ ok: true })
    }

    const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
    if (ok) await hostGroupIfAllowed(chat, from)
    if (ok && telegramId) await routeText(token, chatId, telegramId, groupMessage.routedText, req, messageDateMs, message)
    return NextResponse.json({ ok: true })
  }

  const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
  if (ok) await hostGroupIfAllowed(message?.chat, from)
  if (ok && telegramId) await routeText(token, chatId, telegramId, text, req, messageDateMs, message)
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "ghost-ops-telegram-webhook" })
}
