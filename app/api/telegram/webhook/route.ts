import { NextRequest, NextResponse } from "next/server"
import { answerOpsAi, answerOpsBot, buildConversationContext, chooseOpsAiActionCandidate, executeOpsAiAction, formatOpsProjectDetails, isFollowUpMessage, proposeOpsAiAction, rejectOpsAiAction, type OpsAiOptions } from "@/lib/ops-bot"
import { getTeamAccess, redeemGuardInviteCode } from "@/lib/team-access"
import { getDb } from "@/lib/db"
import { deleteProjectCascade } from "@/lib/platform-data"
import { getSheetSchema, SHEET_KIND_ORDER, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"
import { formatTeamDateTime, parseTeamDateTime, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { getTelegramBotToken, getTelegramBotUsername, sendChatAction, sendTelegramDocument, sendTelegramMessage, sendTelegramPhoto, telegramApi, telegramApiJson, withTelegramLoading } from "@/lib/telegram-bot"
import { savePayrollDay } from "@/lib/payroll-day"
import { loadDailyPayrollReport, parseReportDateFromText } from "@/lib/payroll-daily-report"
import { renderPayrollReportPng } from "@/lib/payroll-report-image"
import { miscIncomeCategoryLabel, parseIncomeLogCommand } from "@/lib/payroll-misc"

type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }

function hasTelegramHtml(text: string) {
  return /<\/?(b|strong|i|em|u|s|code|pre|a)\b/i.test(text)
}

function replyKeyboard() {
  return {
    keyboard: [
      [{ text: "🏠 Home" }, { text: "📁 Projects" }],
      [{ text: "📈 Profit" }, { text: "💸 Payroll" }],
      [{ text: "📅 Calendar" }, { text: "🔔 Reminders" }],
      [{ text: "📝 Notes" }, { text: "🧠 AI" }],
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
      { command: "reminders", description: "Manage reminders" },
      { command: "payroll", description: "Manage payroll" },
      { command: "report", description: "Spreadsheet-style payroll breakdown image" },
      { command: "log", description: "Log project trading or dev income" },
      { command: "notes", description: "Show project notes" },
      { command: "ai", description: "Ask AI about projects and data" },
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
    "🔔 /reminders",
    "💸 /payroll",
    "📊 /report [today|yesterday|YYYY-MM-DD]",
    "🧾 /log <project id> <trading|dev> <amount>",
    "📝 /notes",
    "🧠 @me your question",
  ].join("\n")
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
  await sendMessage(token, chatId, `🔔 Reminders\n\n${reminders.length ? reminders.map((r: any, i: number) => `${i + 1}. ${r.title || r.message} - ${dateLabel(r.dueAt)}${r.targetChatTitle ? ` → ${r.targetChatTitle}` : ""}`).join("\n") : "No reminders yet."}`, [
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
    ...reminders.map((r: any) => `🔔 ${dateLabel(r.dueAt)} - ${r.title || r.message}`),
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
  return {
    chatId,
    chatTitle: chatTitle(message, chatId),
    conversation: await buildConversationContext(telegramId, chatId, message),
  }
}

async function maybeProposeAction(text: string, telegramId: number, aiOptions: OpsAiOptions) {
  if (aiOptions.conversation?.replyToBotText) return null
  if (isFollowUpMessage(text) && (aiOptions.conversation?.recentTurns.length || 0) > 0) return null
  return proposeOpsAiAction(text, telegramId, aiOptions).catch(() => null)
}

async function sendAiResponse(token: string, chatId: number | string, telegramId: number, text: string, message?: any) {
  const aiOptions = await buildAiOptions(telegramId, chatId, message)
  await sendAsyncResponse(token, chatId, async () => {
    const proposed = await maybeProposeAction(text, telegramId, aiOptions)
    if (proposed) {
      return {
        text: proposed.message,
        inline: proposed.buttons || [
          [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
        ],
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
    const parsedDueAt = dueAt ? parseTeamDateTime(dueAt) : new Date(Date.now() + 60 * 60 * 1000)
    if (!parsedDueAt) {
      await sendMessage(token, chatId, "I could not read that due time. Send it as YYYY-MM-DD HH:mm in ET.")
      return true
    }
    const targetChatTitle = chatTitle(message, chatId)
    await db.collection("opsReminders").insertOne({ title, message: reminderMessage || title, dueAt: parsedDueAt.toISOString(), timeZone: TEAM_TIME_ZONE, recurrence: "none", audience: "team", deliveryScope: "chat", telegramChatId: String(chatId), targetChatTitle, status: "scheduled", createdFrom: "bot", telegramId, createdAt: now, updatedAt: now })
    await clearState(telegramId)
    await sendMessage(token, chatId, `✅ Reminder added.\n📅 Due: ${formatTeamDateTime(parsedDueAt)}\n💬 Deliver to: ${targetChatTitle}`)
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

  if (state.action === "ai") {
    const startedAt = Number(state.startedAt || 0)
    if (startedAt && messageDateMs && messageDateMs <= startedAt) return true
    await clearState(telegramId)
    await sendAiResponse(token, chatId, telegramId, text, message)
    return true
  }

  return false
}

async function handleCallback(token: string, chatId: number | string, telegramId: number, data: string, req: NextRequest) {
  const db = await getDb()
  const [area, action, id, extra] = data.split(":")

  if (data === "main:menu") return sendMessage(token, chatId, helpMessage())
  if (data === "projects:list") return sendProjects(token, chatId)
  if (data === "data:list") return sendDataProjects(token, chatId)
  if (area === "notes" && action === "project") return sendProjectNotes(token, chatId, id)

  if (area === "ai" && action === "confirm") {
    return sendAsyncResponse(token, chatId, async () => ({
      text: await executeOpsAiAction(id, telegramId),
    }), "✅ Applying…")
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
    await setState(telegramId, { action: "add_reminder" })
    return sendMessage(token, chatId, "➕ Send reminder like this:\n\nReminder title | YYYY-MM-DD HH:mm | message\n\nSend /cancel to stop.")
  }
  if (area === "reminder" && action === "view") {
    const reminder = await db.collection("opsReminders").findOne({ _id: id })
    if (!reminder) return sendReminders(token, chatId)
    return sendMessage(token, chatId, `🔔 ${reminder.title}\n\nDue: ${dateLabel(reminder.dueAt)}\nStatus: ${reminder.status || "scheduled"}\n\n${reminder.message || ""}`, [
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
  const aiCommand = aiCommandText(commandText)
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
  if (isBotCommand(text, "report") || /^\/report(?:@\w+)?(?:\s|$)/i.test(text)) {
    return sendPayrollReport(token, chatId, text, req)
  }
  if (text === "📅 Calendar" || text === "🟠 Calendar" || isBotCommand(text, "calendar")) return sendCalendar(token, chatId)
  if (text === "🔔 Reminders" || isBotCommand(text, "reminders")) return sendReminders(token, chatId)
  if (isBotCommand(text, "setreminder")) {
    const aiOptions = await buildAiOptions(telegramId, chatId, message)
    return sendAsyncResponse(token, chatId, async () => ({ text: await answerOpsBot(commandText, telegramId, aiOptions) }), "🔔 Scheduling…")
  }
  if (text === "📝 Notes" || isBotCommand(text, "notes")) return sendProjectNotes(token, chatId, "all")

  const aiOptions = await buildAiOptions(telegramId, chatId, message)
  return sendAsyncResponse(token, chatId, async () => {
    const proposed = await maybeProposeAction(text, telegramId, aiOptions)
    if (proposed) {
      return {
        text: proposed.message,
        inline: proposed.buttons || [
          [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
        ],
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
  const text = String(update.message?.text || update.edited_message?.text || "").trim()
  const messageDateMs = Number(update.message?.date || update.edited_message?.date || 0) * 1000 || Date.now()
  const chatId = message?.chat?.id
  const from = update.message?.from || update.edited_message?.from || callback?.from
  const telegramId = from?.id ? Number(from.id) : null
  if (!chatId) return NextResponse.json({ ok: true })

  if (callback?.id) {
    await answerCallback(token, callback.id)
    const ok = await ensureAccess({ token, chatId, telegramId, text: "", profile: from, req })
    if (ok) await hostGroupIfAllowed(message?.chat, from)
    if (ok && telegramId) await handleCallback(token, chatId, telegramId, String(callback.data || ""), req)
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
