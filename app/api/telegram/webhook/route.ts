import { NextRequest, NextResponse } from "next/server"
import { answerOpsAi, answerOpsBot, buildConversationContext, chooseOpsAiActionCandidate, executeOpsAiAction, formatOpsProjectDetails, proposeOpsAiAction, rejectOpsAiAction, type OpsAiOptions } from "@/lib/ops-bot"
import { getMemberTimeZone, getTeamAccess, redeemGuardInviteCode, saveMemberTimeZone } from "@/lib/team-access"
import { getDb } from "@/lib/db"
import { deleteProjectCascade } from "@/lib/platform-data"
import { getSheetSchema, SHEET_KIND_ORDER, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"
import { detectExplicitTimeZone, formatTeamDateTime, parseTeamDateTime, teamZoneLabel, TIME_ZONE_OPTIONS, timeZoneFromOption, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { getTelegramBotToken, getTelegramBotUsername, isTelegramCaptureActive, sendChatAction, sendTelegramDocument, sendTelegramMessage, sendTelegramPhoto, telegramApi, telegramApiJson, withTelegramLoading } from "@/lib/telegram-bot"
import { savePayrollDay } from "@/lib/payroll-day"
import { loadDailyPayrollReport, parseReportDateFromText } from "@/lib/payroll-daily-report"
import { renderPayrollReportPng } from "@/lib/payroll-report-image"
import { miscIncomeCategoryLabel, parseIncomeLogCommand } from "@/lib/payroll-misc"
import { chatPurposeLabel, listChatSubscriptions, normalizeChatPurpose, setChatSubscription } from "@/lib/chat-subscriptions"
import { formatLaunchDaySchedule } from "@/lib/launch-calendar"
import { projectFeeConfig } from "@/lib/revenue-projects"
import { revenueTransactionUrl } from "@/lib/revenue-explorer"
import { acceptReceiptMatch, assignFeeProject, confirmFeeExpectation, createFeeFromReceipt, createForwardedFeeEvent, ensureDailyTradingFeeExpectations, getRevenueReceipt, listRevenueDay, setFeeQuoteAsset, setFeeType, updateReceiptClassification } from "@/lib/revenue-service"
import { feeProjectButtons, formatConsolidationCandidate, formatFeeExpectation, isFeeInboxChat, receiptClassificationButtons } from "@/lib/revenue-telegram"
import { confirmConsolidationCandidate, getConsolidationCandidate, rejectConsolidationCandidate } from "@/lib/revenue-consolidation-candidates"
import type { FeeType } from "@/lib/revenue-types"
import { LAUNCH_CHAINS, launchPad, padsForChain, type LaunchChainId } from "@/lib/launch-math"
import { calculateLaunchQuote, defaultMmLiquidity, formatLaunchQuote, getLaunchAssetPrice, parseLaunchNumber, type LaunchTargetMetric } from "@/lib/launch-calculator"

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
  await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(hasTelegramHtml(text) ? { parse_mode: "HTML" } : {}),
    disable_web_page_preview: true,
    ...(inline
      ? { reply_markup: { inline_keyboard: inline } }
      : inGroup
        ? { reply_markup: removeGroupKeyboard() }
        : { reply_markup: replyKeyboard() }),
  })
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
      { command: "calendar", description: "Show launches and reminders" },
      { command: "launchcalc", description: "Build a client launch-capital quote" },
      { command: "reminders", description: "Manage reminders" },
      { command: "payroll", description: "Manage payroll" },
      { command: "fees", description: "Show today’s revenue inbox" },
      { command: "report", description: "Spreadsheet-style payroll breakdown image" },
      { command: "log", description: "Log project trading or dev income" },
      { command: "notes", description: "Show project notes" },
      { command: "ai", description: "Ask AI about projects and data" },
      { command: "timezone", description: "Set your local timezone" },
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
    "🚀 /launchcalc - build a launch-capital quote",
    "🔔 /reminders",
    "💸 /payroll",
    "📊 /report [today|yesterday|YYYY-MM-DD]",
    "🧾 /log <project id> <trading|dev> <amount>",
    "📝 /notes",
    "🧠 @me your question",
    "🌍 /timezone - set your local timezone",
    "💰 /fees - show today’s revenue inbox",
    "📣 /subscribe launches, /subscribe daily, or /subscribe fees",
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

function isRelativeDurationReminder(text: string) {
  return /\bin\s+\d+\s*(?:minutes?|hours?|days?|weeks?)\b/i.test(text)
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
  await setState(telegramId, { action: stateAction, pendingText: text })
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

function codeFromText(text: string) {
  const clean = String(text || "").trim()
  const startCode = clean.match(/^\/start\s+(.+)$/i)?.[1]
  const value = startCode || clean
  return /^GHOST-[A-F0-9]{8}$/i.test(value) ? value.toUpperCase() : ""
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

  const access = await getTeamAccess(params.telegramId)
  if (access.allowed) return true

  if (access.reason === "deactivated") {
    await sendMessage(params.token, params.chatId, "⛔ Your Guard Team access is deactivated. Ask an admin to restore access.")
    return false
  }

  const code = codeFromText(params.text)
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

async function setState(telegramId: number, state: Record<string, any>) {
  const db = await getDb()
  await db.collection("opsBotStates").updateOne({ telegramId }, { $set: { telegramId, ...state, updatedAt: new Date() } }, { upsert: true })
}

async function clearState(telegramId: number) {
  const db = await getDb()
  await db.collection("opsBotStates").deleteOne({ telegramId })
}

async function takeState(telegramId: number) {
  const db = await getDb()
  return db.collection("opsBotStates").findOne({ telegramId })
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
  })
  return sendMessage(token, chatId, formatLaunchQuote(quote), [
    [{ text: "🎯 Change target", callback_data: "launch:adjust:target" }, { text: "💧 Change MM reserve", callback_data: "launch:adjust:mm" }],
    [{ text: "🆕 New launch quote", callback_data: "launch:start" }],
  ])
}

async function sendProjects(token: string, chatId: number | string) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).sort({ status: 1, updatedAt: -1 }).limit(8).toArray()
  const lines = projects.length
    ? projects.map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.status || "active"}${p.launchDate ? ` - ${dateLabel(p.launchDate)}` : ""}\nID: <code>${p._id}</code>`).join("\n\n")
    : "No projects yet."
  await sendMessage(token, chatId, `📁 Projects\n\n${lines}`, [
    [{ text: "➕ Add Project", callback_data: "project:add" }, { text: "📝 Notes Feed", callback_data: "notes:project:all" }],
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
    [{ text: "✏️ Edit", callback_data: `project:edit:${id}` }, { text: project.status === "active" ? "⏸ Deactivate" : "▶️ Activate", callback_data: `project:toggle:${id}` }],
    [{ text: "📝 Notes", callback_data: `notes:project:${id}` }, { text: "🗑 Remove", callback_data: `project:delete:${id}` }],
    [{ text: "⬅️ Projects", callback_data: "projects:list" }],
  ])
}

async function sendProjectNotes(token: string, chatId: number | string, projectId?: string) {
  const db = await getDb()
  const project = projectId && projectId !== "all" ? await db.collection("opsProjects").findOne({ _id: projectId }) : null
  const notes = await db.collection("opsProjectNotes")
    .find(project ? { projectId: String(project._id) } : {})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray()
  const lines = notes.length
    ? notes.map((note: any) => `• ${note.projectName} - ${note.authorName || "Team member"}\n${note.text}`).join("\n\n")
    : "No project notes yet."
  await sendMessage(token, chatId, `📝 ${project?.name ? `${project.name} Notes` : "Project Notes"}\n\n${lines}`, [
    ...(project ? [[{ text: "➕ Add Note", callback_data: `note:add:${project._id}` }]] : []),
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

async function sendReminders(token: string, chatId: number | string) {
  const db = await getDb()
  const rows = await db.collection("opsReminders").find({ status: { $ne: "done" } }).sort({ dueAt: 1 }).toArray()
  const reminders = rows.filter((reminder: any) => reminder.deliveryScope === "team" || !reminder.telegramChatId || String(reminder.telegramChatId) === String(chatId)).slice(0, 8)
  await sendMessage(token, chatId, `🔔 Reminders\n\n${reminders.length ? reminders.map((r: any, i: number) => `${i + 1}. ${r.title || r.message} - ${dateLabel(r.dueAt, String(r.timeZone || TEAM_TIME_ZONE))}${r.targetChatTitle ? ` → ${r.targetChatTitle}` : ""}`).join("\n") : "No reminders yet."}`, [
    [{ text: "➕ Add Reminder", callback_data: "reminder:add" }],
    ...reminders.map((r: any) => [{ text: `Open ${r.title || r.message}`.slice(0, 60), callback_data: `reminder:view:${r._id}` }]),
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
}

async function sendCalendar(token: string, chatId: number | string) {
  const db = await getDb()
  const [projects, reminders] = await Promise.all([
    db.collection("opsProjects").find({ launchDate: { $exists: true } }).sort({ launchDate: 1 }).limit(6).toArray(),
    db.collection("opsReminders").find({ status: { $ne: "done" } }).sort({ dueAt: 1 }).limit(6).toArray(),
  ])
  const lines = [
    ...projects.map((p: any) => `📁 ${dateLabel(p.launchDate)} - ${p.name}`),
    ...reminders.map((r: any) => `🔔 ${dateLabel(r.dueAt, String(r.timeZone || TEAM_TIME_ZONE))} - ${r.title || r.message}`),
  ].slice(0, 10)
  await sendMessage(token, chatId, `📅 Calendar\n\n${lines.length ? lines.join("\n") : "No calendar items yet."}`, [
    [{ text: "➕ Add Reminder", callback_data: "reminder:add" }, { text: "📁 Projects", callback_data: "projects:list" }],
    [{ text: "⬅️ Back", callback_data: "main:menu" }],
  ])
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

async function buildAiOptions(telegramId: number, chatId: number | string, message?: any): Promise<OpsAiOptions> {
  const messageTimestamp = Number(message?.date || message?.edit_date || 0) * 1000
  const referenceTime = messageTimestamp > 0 ? new Date(messageTimestamp) : new Date()
  return {
    chatId,
    chatTitle: chatTitle(message, chatId),
    conversation: await buildConversationContext(telegramId, chatId, message),
    referenceTime: referenceTime.toISOString(),
    requestTimeZone: await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE,
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

async function sendAiResponse(token: string, chatId: number | string, telegramId: number, text: string, message?: any) {
  if (await maybeRequestReminderTimeZone(token, chatId, telegramId, text)) return
  const aiOptions = await buildAiOptions(telegramId, chatId, message)
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
    return { text: await answerOpsAi(text, telegramId, aiOptions) }
  }, "🧠 Working on it…")
}

function aiCommandText(text: string) {
  const match = String(text || "").trim().match(/^\/ai(?:@\w+)?(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return String(match[1] || "").trim()
}

async function processState(token: string, chatId: number | string, telegramId: number, text: string, messageDateMs: number, message?: any) {
  const state = await takeState(telegramId)
  if (!state) return false
  const db = await getDb()
  const now = new Date()

  if (text === "⬅️ Back" || text === "/cancel") {
    await clearState(telegramId)
    await sendMessage(token, chatId, "Cancelled.")
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
    const [title = "", dueAt = "", reminderMessage = ""] = text.split("|").map((part) => part.trim())
    if (!title) {
      await sendMessage(token, chatId, "Send: Reminder title | YYYY-MM-DD HH:mm | message")
      return true
    }
    const timeZone = await getMemberTimeZone(telegramId) || TEAM_TIME_ZONE
    const parsedDueAt = dueAt ? parseTeamDateTime(dueAt, timeZone) : new Date(Date.now() + 60 * 60 * 1000)
    if (!parsedDueAt) {
      await sendMessage(token, chatId, "I could not read that due time. Send it as YYYY-MM-DD HH:mm in ET.")
      return true
    }
    const targetChatTitle = chatTitle(message, chatId)
    await db.collection("opsReminders").insertOne({ title, message: reminderMessage || title, dueAt: parsedDueAt.toISOString(), timeZone, recurrence: "none", audience: "team", deliveryScope: "chat", telegramChatId: String(chatId), targetChatTitle, status: "scheduled", createdFrom: "bot", telegramId, createdAt: now, updatedAt: now })
    await clearState(telegramId)
    await sendMessage(token, chatId, `✅ Reminder added.\n📅 Due: ${formatTeamDateTime(parsedDueAt, timeZone)}\n💬 Deliver to: ${targetChatTitle}`)
    await sendReminders(token, chatId)
    return true
  }

  if (state.action === "add_project_note") {
    const project = await db.collection("opsProjects").findOne({ _id: state.projectId })
    if (!project || !text.trim()) {
      await sendMessage(token, chatId, "Send the project update as one message.")
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
    await clearState(telegramId)
    await sendMessage(token, chatId, "✅ Project note posted.")
    await sendProjectNotes(token, chatId, String(project._id))
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
    await setState(telegramId, { action: "launch_calc_value", launchInitialLp: initialLp })
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
    await sendAiResponse(token, chatId, telegramId, text, message)
    return true
  }

  return false
}

const DIRECT_RECEIPT_FEE_TYPES = ["daily_trading", "dev_allocation", "fee_collector", "fee_rebate", "other"] as const

function receiptTypeButtons(receiptId: string) {
  return [
    [{ text: "Daily trading", callback_data: `receipt:type:${receiptId}:daily_trading` }, { text: "Dev allocation", callback_data: `receipt:type:${receiptId}:dev_allocation` }],
    [{ text: "Fee collector", callback_data: `receipt:type:${receiptId}:fee_collector` }, { text: "Fee rebate", callback_data: `receipt:type:${receiptId}:fee_rebate` }],
    [{ text: "Other revenue", callback_data: `receipt:type:${receiptId}:other` }],
    [{ text: "Liquidation / launch expectation", callback_data: `receipt:existing:${receiptId}` }],
  ]
}

function feeTypeLabel(value: unknown) {
  return String(value || "Revenue").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function receiptSummary(receipt: any) {
  const value = receipt.amountUsd == null ? "Awaiting USD value" : Number(receipt.amountUsd).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
  return `${Number(receipt.amount || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${receipt.asset} · ${value} · ${feeTypeLabel(receipt.chain)}`
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
  await setState(telegramId, { action: "receipt_classification", receiptId, feeType })
  if (!projects.length) return sendMessage(token, chatId, `No eligible ${feeTypeLabel(feeType)} project accepts ${receipt.asset} on ${feeTypeLabel(receipt.chain)}. Configure or review it in Revenue Inbox.`)
  return sendMessage(token, chatId, `${receiptSummary(receipt)}\n\nChoose the project:`, projects.slice(0, 12).map((project: any) => [{ text: `${project.name} · ${feeTypeLabel(project.chain)}`.slice(0, 60), callback_data: `receipt:project:${project._id}` }]))
}

async function sendReceiptConfirmation(token: string, chatId: number | string, telegramId: number, projectId?: string | null) {
  const state = await takeState(telegramId)
  if (state?.action !== "receipt_classification" || !state.receiptId || !DIRECT_RECEIPT_FEE_TYPES.includes(state.feeType)) return sendMessage(token, chatId, "This classification menu expired. Start again from the receipt message.")
  const db = await getDb()
  const [receipt, project] = await Promise.all([
    getRevenueReceipt(String(state.receiptId)),
    projectId ? db.collection("opsProjects").findOne({ _id: projectId }) : Promise.resolve(null),
  ])
  if (!receipt || receipt.status !== "unclassified") return sendMessage(token, chatId, "This receipt was already classified.")
  if (state.feeType !== "fee_rebate" && !project) return sendMessage(token, chatId, "Choose an existing project first.")
  const expectedUsd = state.feeType === "daily_trading" ? Number(projectFeeConfig(project).dailyTradingFeeUsd || 500) : Number(receipt.amountUsd || 0)
  const variance = receipt.amountUsd == null ? null : Number(receipt.amountUsd) - expectedUsd
  await setState(telegramId, { ...state, projectId: project ? String(project._id) : null })
  const text = [
    `<b>Confirm revenue classification</b>`,
    "",
    `Project: <b>${project?.name || "Fee rebate"}</b>`,
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
  await setState(telegramId, { action: "receipt_expectation", receiptId })
  const eligible = fees.filter((fee: any) => ["liquidation", "launch", "daily_trading"].includes(fee.feeType)).slice(0, 12)
  if (!eligible.length) return sendMessage(token, chatId, "No compatible liquidation, launch, or daily expectation is waiting for this receipt. Forward the standardized cashout message first or use Revenue Inbox.")
  return sendMessage(token, chatId, `${receiptSummary(receipt)}\n\nChoose the existing expectation:`, eligible.map((fee: any) => [{ text: `${fee.projectName || "Project"} · ${feeTypeLabel(fee.feeType)} · ${fee.expectedUsd == null ? `${fee.expectedAssetAmount} ${fee.quoteAsset}` : `$${Number(fee.expectedUsd).toFixed(2)}`}`.slice(0, 60), callback_data: `receipt:expect:${fee._id}` }]))
}

async function handleCallback(token: string, chatId: number | string, telegramId: number, data: string, req: NextRequest) {
  const db = await getDb()
  const [area, action, id, extra] = data.split(":")

  if (area === "tz" && action === "set") {
    if (extra && Number(extra) !== telegramId) return
    const timeZone = timeZoneFromOption(id)
    const saved = await saveMemberTimeZone(telegramId, timeZone, "bot")
    if (!saved.ok) return sendMessage(token, chatId, `⚠️ ${saved.error}`)
    const state = await takeState(telegramId)
    if (state?.action === "timezone_for_reminder" && state.pendingText) {
      await clearState(telegramId)
      await sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}. Continuing your reminder…`)
      return sendAiResponse(token, chatId, telegramId, String(state.pendingText))
    }
    if (state?.action === "timezone_for_manual_reminder") {
      await setState(telegramId, { action: "add_reminder" })
      return sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}.\n\n➕ Send reminder like this:\n\nReminder title | YYYY-MM-DD HH:mm | message\n\nSend /cancel to stop.`)
    }
    await clearState(telegramId)
    return sendMessage(token, chatId, `✅ Your timezone is now ${saved.timeZone} (${teamZoneLabel(saved.timeZone)}).\nCurrent local time: ${formatTeamDateTime(new Date(), saved.timeZone)}`)
  }

  if (data === "main:menu") return sendMessage(token, chatId, helpMessage())

  if (area === "launch" && action === "start") return sendLaunchCalculatorStart(token, chatId, telegramId)
  if (area === "launch" && action === "chain") return sendLaunchVenuePicker(token, chatId, id as LaunchChainId)
  if (area === "launch" && action === "venue") return sendLaunchMetricPicker(token, chatId, id)
  if (area === "launch" && action === "metric") {
    const pad = launchPad(extra)
    const metric = id as LaunchTargetMetric
    if (!pad || !(["supply", "market_cap"] as string[]).includes(metric)) return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (pad.type === "amm") {
      await setState(telegramId, { action: "launch_calc_lp", launchVenueId: pad.id, launchMetric: metric })
      return sendMessage(token, chatId, `💧 What initial LP should ${pad.name} use?\n\nThis sets the opening price. Type another amount or use the suggested default.`, [
        [{ text: `Use ${pad.defaultLp} ${pad.symbol}`, callback_data: `launch:lp:default:${pad.id}` }],
        [{ text: "⬅️ Target type", callback_data: `launch:venue:${pad.id}` }],
      ])
    }
    await setState(telegramId, { action: "launch_calc_value", launchVenueId: pad.id, launchMetric: metric })
    return sendMessage(token, chatId, launchTargetPrompt(metric, pad.name))
  }
  if (area === "launch" && action === "lp") {
    const pad = launchPad(extra)
    const state = await takeState(telegramId)
    if (!pad || state?.launchVenueId !== pad.id || state?.action !== "launch_calc_lp") return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (id === "default") {
      await setState(telegramId, { action: "launch_calc_value", launchInitialLp: pad.defaultLp })
      return sendMessage(token, chatId, launchTargetPrompt(state.launchMetric as LaunchTargetMetric, pad.name))
    }
  }
  if (area === "launch" && action === "adjust") {
    const state = await takeState(telegramId)
    const pad = launchPad(String(state?.launchVenueId || ""))
    if (!pad || state?.action !== "launch_calc_result") return sendLaunchCalculatorStart(token, chatId, telegramId)
    if (id === "target") {
      await setState(telegramId, { action: "launch_calc_value" })
      return sendMessage(token, chatId, launchTargetPrompt(state.launchMetric as LaunchTargetMetric, pad.name))
    }
    if (id === "mm") {
      await setState(telegramId, { action: "launch_calc_mm" })
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
    if (extra === "fee_rebate") {
      await setState(telegramId, { action: "receipt_classification", receiptId: id, feeType: extra })
      return sendReceiptConfirmation(token, chatId, telegramId, null)
    }
    return sendReceiptProjectPicker(token, chatId, telegramId, id, extra as FeeType)
  }
  if (area === "receipt" && action === "project") return sendReceiptConfirmation(token, chatId, telegramId, id)
  if (area === "receipt" && action === "confirm") {
    const state = await takeState(telegramId)
    if (state?.action !== "receipt_classification" || String(state.receiptId) !== id || !DIRECT_RECEIPT_FEE_TYPES.includes(state.feeType)) return sendMessage(token, chatId, "This classification menu expired. Start again from the receipt message.")
    const fee = await createFeeFromReceipt({ receiptId: id, feeType: state.feeType as FeeType, projectId: state.projectId || null })
    const confirmed = await acceptReceiptMatch(String(fee._id), telegramId)
    await clearState(telegramId)
    return sendMessage(token, chatId, `✅ Revenue classified by Telegram. The admin app is already updated.\n\n${formatFeeExpectation(confirmed)}`)
  }
  if (area === "receipt" && action === "existing") return sendExistingExpectationPicker(token, chatId, telegramId, id)
  if (area === "receipt" && action === "expect") {
    const state = await takeState(telegramId)
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
    await setState(telegramId, { action: "fee_project_search", feeId: id })
    return sendMessage(token, chatId, "Type part of the existing project name. Send /cancel to stop.")
  }
  if (area === "fee" && action === "receipt") {
    const receipt = await getRevenueReceipt(id)
    if (!receipt) return sendMessage(token, chatId, "Receipt was not found.")
    const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
    return sendMessage(token, chatId, `Revenue receipt\n\n${receipt.amount} ${receipt.asset}\nChain: ${receipt.chain}\nStatus: ${receipt.status}\nTransaction: ${receipt.transactionHash}`, receiptClassificationButtons(id, transactionUrl))
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
  if (area === "notes" && action === "project") return sendProjectNotes(token, chatId, id)

  if (area === "ai" && action === "confirm") {
    return sendAsyncResponse(token, chatId, async () => {
      const pending = await db.collection("opsAiActions").findOne({ _id: id })
      const text = await executeOpsAiAction(id, telegramId)
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
    await setState(telegramId, { action: "add_project" })
    return sendMessage(token, chatId, "➕ Send the new project like this:\n\nProject Name | Owner | YYYY-MM-DD | active\n\nSend /cancel to stop.")
  }
  if (area === "project" && action === "view") return sendProjectDetail(token, chatId, id)
  if (area === "project" && action === "edit") {
    await setState(telegramId, { action: "edit_project", projectId: id })
    return sendMessage(token, chatId, "✏️ Send updated project:\n\nProject Name | Owner | YYYY-MM-DD | active\n\nSend /cancel to stop.")
  }
  if (area === "project" && action === "toggle") {
    const project = await db.collection("opsProjects").findOne({ _id: id })
    await db.collection("opsProjects").updateOne({ _id: id }, { $set: { status: project?.status === "active" ? "inactive" : "active", updatedAt: new Date() } })
    return sendProjectDetail(token, chatId, id)
  }
  if (area === "project" && action === "delete") {
    const result = await deleteProjectCascade(id)
    await sendMessage(token, chatId, `🗑 Project and ${result.deleted} related records removed.`)
    return sendProjects(token, chatId)
  }

  if (area === "note" && action === "add") {
    const member = await db.collection("guardMembers").findOne({ telegramId })
    await setState(telegramId, {
      action: "add_project_note",
      projectId: id,
      authorName: member?.name || member?.firstName || member?.username || "Team member",
    })
    return sendMessage(token, chatId, "📝 Send the project update as one message.\n\nSend /cancel to stop.")
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
    await setState(telegramId, { action: "add_sheet_row", sheetId: id })
    return sendMessage(token, chatId, `➕ Send row values separated by |:\n\n${headers.join(" | ")}\n\nSend /cancel to stop.`)
  }
  if (area === "sheet" && action === "delete") {
    const sheet = await db.collection("opsSheets").findOne({ _id: id })
    await db.collection("opsSheets").deleteOne({ _id: id })
    await sendMessage(token, chatId, "🗑 Data file removed.")
    return sheet?.projectId ? sendProjectSheets(token, chatId, sheet.projectId) : sendDataProjects(token, chatId)
  }

  if (area === "reminder" && action === "add") {
    if (!(await getMemberTimeZone(telegramId))) {
      await setState(telegramId, { action: "timezone_for_manual_reminder" })
      return sendMessage(token, chatId, timeZonePrompt(), timeZoneButtons(telegramId))
    }
    await setState(telegramId, { action: "add_reminder" })
    return sendMessage(token, chatId, "➕ Send reminder like this:\n\nReminder title | YYYY-MM-DD HH:mm | message\n\nSend /cancel to stop.")
  }
  if (area === "reminder" && action === "view") {
    const reminder = await db.collection("opsReminders").findOne({ _id: id })
    if (!reminder) return sendReminders(token, chatId)
    return sendMessage(token, chatId, `🔔 ${reminder.title}\n\nDue: ${dateLabel(reminder.dueAt, String(reminder.timeZone || TEAM_TIME_ZONE))}\nStatus: ${reminder.status || "scheduled"}\n\n${reminder.message || ""}`, [
      [{ text: "✅ Mark Done", callback_data: `reminder:done:${id}` }, { text: "🗑 Remove", callback_data: `reminder:delete:${id}` }],
      [{ text: "⬅️ Reminders", callback_data: "reminders:list" }],
    ])
  }
  if (area === "reminder" && action === "done") {
    await db.collection("opsReminders").updateOne({ _id: id }, { $set: { status: "done", updatedAt: new Date() } })
    return sendReminders(token, chatId)
  }
  if (area === "reminder" && action === "delete") {
    await db.collection("opsReminders").deleteOne({ _id: id })
    return sendReminders(token, chatId)
  }
  if (data === "reminders:list") return sendReminders(token, chatId)

  if (area === "payroll" && action === "add") {
    await setState(telegramId, { action: "add_payroll" })
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
  const subscribeCommand = commandText.match(/^\/(subscribe|unsubscribe)(?:\s+(.+))?$/i)
  const naturalLaunchSubscription = /\b(?:make|set|use)\s+this\s+(?:group|chat)\s+(?:as\s+)?(?:the\s+)?launch(?:es)?\s+(?:chat|channel)|\bsend\s+(?:the\s+)?(?:daily\s+|morning\s+)?launch\s+(?:schedule|updates?)\s+to\s+this\s+(?:group|chat)\b/i.test(commandText)
  if (subscribeCommand || naturalLaunchSubscription) {
    const active = naturalLaunchSubscription || subscribeCommand?.[1].toLowerCase() === "subscribe"
    const purpose = naturalLaunchSubscription ? "launches" : normalizeChatPurpose(subscribeCommand?.[2])
    if (!purpose) return sendMessage(token, chatId, "Choose an update type: /subscribe launches, /subscribe daily, or /subscribe fees.")
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
        : purpose === "performance"
          ? `This chat is subscribed to ${chatPurposeLabel(purpose)}.\n\nI’ll post the daily project revenue and performance update only in subscribed chats.`
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
    const state = await takeState(telegramId)
    if (state?.action === "timezone_for_reminder" && state.pendingText) {
      await clearState(telegramId)
      await sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}. Continuing your reminder…`)
      return sendAiResponse(token, chatId, telegramId, String(state.pendingText), message)
    }
    if (state?.action === "timezone_for_manual_reminder") {
      await setState(telegramId, { action: "add_reminder" })
      return sendMessage(token, chatId, `✅ Timezone saved as ${teamZoneLabel(saved.timeZone)}.\n\n➕ Send reminder like this:\n\nReminder title | YYYY-MM-DD HH:mm | message\n\nSend /cancel to stop.`)
    }
    return sendMessage(token, chatId, `✅ Your timezone is now ${saved.timeZone} (${teamZoneLabel(saved.timeZone)}).`)
  }
  const aiCommand = aiCommandText(commandText)
  if (text === "🚀 Launch Calc" || isBotCommand(text, "launchcalc")) {
    return sendLaunchCalculatorStart(token, chatId, telegramId)
  }
  if (aiCommand !== null) {
    await clearState(telegramId)
    if (aiCommand) return sendAiResponse(token, chatId, telegramId, aiCommand, message)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() })
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  if (text === "🧠 AI") {
    await clearState(telegramId)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() })
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  if (await processState(token, chatId, telegramId, text, messageDateMs, message)) return

  if (text === "🏠 Home" || isBotCommand(text, "menu", "help", "commands")) return sendMessage(token, chatId, helpMessage())
  if (/^\/log(?:@\w+)?(?:\s|$)/i.test(text)) return logProjectIncome(token, chatId, text)
  if (text === "📁 Projects" || text === "🟡 Projects" || isBotCommand(text, "projects")) return sendProjects(token, chatId)
  if (text === "📈 Profit" || isBotCommand(text, "profit")) {
    return sendAsyncResponse(token, chatId, async () => ({
      text: await answerOpsBot("profit today", telegramId),
    }), "📈 Checking…")
  }
  if (text === "💸 Payroll" || isBotCommand(text, "payroll")) return sendPayroll(token, chatId)
  if (isBotCommand(text, "fees")) {
    const day = await listRevenueDay()
    return sendMessage(token, chatId, `💰 Revenue Inbox today\n\nExpected fees: ${day.summary.fees}\nVerified: ${day.summary.confirmedFees}\nNeeds review: ${day.summary.unresolvedFees}\nUnclassified receipts: ${day.summary.unclassifiedReceipts}\nRecognized: ${Number(day.summary.recognizedUsd).toLocaleString("en-US", { style: "currency", currency: "USD" })}`, [[{ text: "Open Revenue Inbox", url: `${appBaseUrl(req)}/admin/revenue` }]])
  }
  if (isBotCommand(text, "report") || /^\/report(?:@\w+)?(?:\s|$)/i.test(text)) {
    return sendPayrollReport(token, chatId, text, req)
  }
  if (text === "📅 Calendar" || text === "🟠 Calendar" || isBotCommand(text, "calendar")) return sendCalendar(token, chatId)
  if (text === "🔔 Reminders" || isBotCommand(text, "reminders")) return sendReminders(token, chatId)
  if (isBotCommand(text, "setreminder")) {
    const reminderRequest = commandText.replace(/^\/setreminder(?:\s+|$)/i, "Remind the team ").trim()
    return sendAiResponse(token, chatId, telegramId, reminderRequest, message)
  }
  if (text === "📝 Notes" || isBotCommand(text, "notes")) return sendProjectNotes(token, chatId, "all")

  if (await maybeRequestReminderTimeZone(token, chatId, telegramId, text)) return
  const aiOptions = await buildAiOptions(telegramId, chatId, message)
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
    return { text: await answerOpsBot(text, telegramId, aiOptions) }
  }, "🧠 Working on it…")
}

export async function POST(req: NextRequest) {
  const token = await getTelegramBotToken()
  if (!token) return NextResponse.json({ error: "Telegram bot token missing" }, { status: 500 })

  const update = await req.json().catch(() => ({}))
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
        await handleCallback(token, chatId, telegramId, String(callback.data || ""), req)
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
        const created = await createForwardedFeeEvent({ chatId, messageId: Number(message.message_id), text, telegramId, messageDate: new Date(forwardedDateMs) })
        const fee = created.fee
        if (created.duplicate) await sendMessage(token, chatId, "This forwarded message is already in Revenue Inbox.")
        else if (!fee.feeType) await sendMessage(token, chatId, `I saved the message but could not classify the fee. Choose the type:`, [[{ text: "Liquidation", callback_data: `fee:type:${fee._id}:liquidation` }], [{ text: "Daily trading", callback_data: `fee:type:${fee._id}:daily_trading` }, { text: "Launch / TGE cash", callback_data: `fee:type:${fee._id}:launch` }], [{ text: "Dev allocation", callback_data: `fee:type:${fee._id}:dev_allocation` }]])
        else await sendMessage(token, chatId, `${formatFeeExpectation(fee)}\n\nChoose the existing project:`, await feeProjectButtons(String(fee._id)))
      }
      return NextResponse.json({ ok: true })
    }
    const groupMessage = await resolveGroupMessage(text, entities, message)
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
