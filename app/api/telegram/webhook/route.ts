import { NextRequest, NextResponse } from "next/server"
import { answerOpsAi, answerOpsBot, chooseOpsAiActionCandidate, executeOpsAiAction, formatOpsProjectDetails, proposeOpsAiAction, rejectOpsAiAction } from "@/lib/ops-bot"
import { getTeamAccess, redeemGuardInviteCode } from "@/lib/team-access"
import { getDb } from "@/lib/db"
import { deleteProjectCascade } from "@/lib/platform-data"
import { getSheetSchema, SHEET_KIND_ORDER, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"
import { getTelegramBotToken, telegramApi } from "@/lib/telegram-bot"
import { savePayrollDay } from "@/lib/payroll-day"

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

async function sendMessage(token: string, chatId: number | string, text: string, inline?: InlineButton[][]) {
  await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(hasTelegramHtml(text) ? { parse_mode: "HTML" } : {}),
    disable_web_page_preview: true,
    reply_markup: inline ? { inline_keyboard: inline } : replyKeyboard(),
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
      { command: "log", description: "Log project trading or dev income" },
      { command: "notes", description: "Show project notes" },
      { command: "ai", description: "Ask AI about projects and data" },
    ],
  })
}

function appUrl(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || ""
  const proto = req.headers.get("x-forwarded-proto") || "https"
  return host ? `${proto}://${host}/telegram` : "https://ghost-sys.vercel.app/telegram"
}

function helpMessage() {
  return [
    "🛡️ Ghost Team bot is ready.",
    "",
    "Use the stable buttons below, or type:",
    "📈 /profit",
    "📁 /projects",
    "📅 /calendar",
    "🔔 /reminders",
    "💸 /payroll",
    "🧾 /log <project id> <trading|dev> <amount>",
    "📝 /notes",
    "🧠 /ai your question",
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

function dateLabel(value?: string) {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString()
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
  const reminders = await db.collection("opsReminders").find({ status: { $ne: "done" } }).sort({ dueAt: 1 }).limit(8).toArray()
  await sendMessage(token, chatId, `🔔 Reminders\n\n${reminders.length ? reminders.map((r: any, i: number) => `${i + 1}. ${r.title || r.message} - ${dateLabel(r.dueAt)}`).join("\n") : "No reminders yet."}`, [
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

async function logProjectIncome(token: string, chatId: number | string, text: string) {
  const match = text.match(/^\/log(?:@\w+)?\s+(\S+)\s+(\S+)\s+(-?\d+)$/i)
  if (!match) {
    return sendMessage(token, chatId, "Use: /log <project id> <trading|dev> <amount>")
  }
  const [, projectId, rawType, rawAmount] = match
  const incomeType = rawType.toLowerCase().replace(/[-\s]/g, "_")
  const isTrading = ["trading", "trading_income", "trade"].includes(incomeType)
  const isDev = ["dev", "dev_allocation", "allocation"].includes(incomeType)
  const amount = Number(rawAmount)
  if ((!isTrading && !isDev) || !Number.isInteger(amount) || amount <= 0) {
    return sendMessage(token, chatId, "Income type must be trading or dev, and amount must be a whole number above 0.")
  }

  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  if (!project) return sendMessage(token, chatId, "Project ID was not found.")
  const date = estDateKey()
  const existing = await db.collection("dailyPayrollEntries").findOne({ date })
  const inputs = existing?.inputs || {}
  const clientIncome = Array.isArray(inputs.clientIncome) ? [...inputs.clientIncome] : []
  const devAllocations = Array.isArray(inputs.devAllocations) ? [...inputs.devAllocations] : []
  if (isTrading) clientIncome.push({ projectId, incomeType: "trading", income: amount })
  else devAllocations.push({ projectId, income: amount })

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
  await sendMessage(token, chatId, [
    "✅ Income logged",
    "",
    `Project: ${project.name}`,
    `Type: ${isTrading ? "Trading Income" : "Dev Allocation"}`,
    `Amount: ${money(amount)}`,
    referral ? `Referrer: ${referral.referrerName} - ${money(referral.amount)}` : "",
  ].filter(Boolean).join("\n"))
}

async function sendAiResponse(token: string, chatId: number | string, telegramId: number, text: string) {
  const proposed = await proposeOpsAiAction(text, telegramId).catch(() => null)
  if (proposed) {
    return sendMessage(token, chatId, proposed.message, proposed.buttons || [
      [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
    ])
  }
  return sendMessage(token, chatId, await answerOpsAi(text, telegramId))
}

function aiCommandText(text: string) {
  const match = String(text || "").trim().match(/^\/ai(?:@\w+)?(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return String(match[1] || "").trim()
}

async function processState(token: string, chatId: number | string, telegramId: number, text: string, messageDateMs: number) {
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
    const [title = "", dueAt = "", message = ""] = text.split("|").map((part) => part.trim())
    if (!title) {
      await sendMessage(token, chatId, "Send: Reminder title | YYYY-MM-DD HH:mm | message")
      return true
    }
    await db.collection("opsReminders").insertOne({ title, message: message || title, dueAt: dueAt ? new Date(dueAt).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString(), recurrence: "none", audience: "team", status: "scheduled", createdFrom: "bot", telegramId, createdAt: now, updatedAt: now })
    await clearState(telegramId)
    await sendMessage(token, chatId, "✅ Reminder added.")
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
    await sendAiResponse(token, chatId, telegramId, text)
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
    return sendMessage(token, chatId, await executeOpsAiAction(id, telegramId))
  }
  if (area === "ai" && action === "reject") {
    return sendMessage(token, chatId, await rejectOpsAiAction(id, telegramId))
  }
  if (area === "ai" && (action === "newest" || action === "oldest")) {
    const picked = await chooseOpsAiActionCandidate(id, action, telegramId)
    return sendMessage(token, chatId, picked.message, picked.ok ? [
      [{ text: "✅ Confirm", callback_data: `ai:confirm:${id}` }, { text: "❌ Refuse", callback_data: `ai:reject:${id}` }],
    ] : undefined)
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

async function routeText(token: string, chatId: number | string, telegramId: number, text: string, req: NextRequest, messageDateMs: number) {
  const aiCommand = aiCommandText(text)
  if (aiCommand !== null) {
    await clearState(telegramId)
    if (aiCommand) return sendAiResponse(token, chatId, telegramId, aiCommand)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() })
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  if (text === "🧠 AI") {
    await clearState(telegramId)
    await setState(telegramId, { action: "ai", startedAt: messageDateMs || Date.now() })
    return sendMessage(token, chatId, "🧠 Send your AI question now.\n\nI will answer only the next message sent after this command.\n\nSend /cancel to stop.")
  }

  if (await processState(token, chatId, telegramId, text, messageDateMs)) return

  if (text === "🏠 Home" || text === "/menu" || text === "/help" || text === "/commands") return sendMessage(token, chatId, helpMessage())
  if (/^\/log(?:@\w+)?(?:\s|$)/i.test(text)) return logProjectIncome(token, chatId, text)
  if (text === "📁 Projects" || text === "🟡 Projects" || text === "/projects") return sendProjects(token, chatId)
  if (text === "📈 Profit" || text === "/profit") return sendMessage(token, chatId, await answerOpsBot("profit today", telegramId))
  if (text === "💸 Payroll" || text === "/payroll") return sendPayroll(token, chatId)
  if (text === "📅 Calendar" || text === "🟠 Calendar" || text === "/calendar") return sendCalendar(token, chatId)
  if (text === "🔔 Reminders" || text === "/reminders") return sendReminders(token, chatId)
  if (text === "📝 Notes" || text === "/notes") return sendProjectNotes(token, chatId, "all")
  const proposed = await proposeOpsAiAction(text, telegramId).catch(() => null)
  if (proposed) {
    return sendMessage(token, chatId, proposed.message, proposed.buttons || [
      [{ text: "✅ Confirm", callback_data: `ai:confirm:${proposed.actionId}` }, { text: "❌ Refuse", callback_data: `ai:reject:${proposed.actionId}` }],
    ])
  }
  return sendMessage(token, chatId, await answerOpsBot(text, telegramId))
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

  if (text === "/start" || text.startsWith("/start ")) {
    void setBotCommands(token)
    const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
    if (ok) await hostGroupIfAllowed(message?.chat, from)
    if (ok) await sendMessage(token, chatId, helpMessage())
    return NextResponse.json({ ok: true })
  }

  const ok = await ensureAccess({ token, chatId, telegramId, text, profile: from, req })
  if (ok) await hostGroupIfAllowed(message?.chat, from)
  if (ok && telegramId) await routeText(token, chatId, telegramId, text, req, messageDateMs)
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "ghost-ops-telegram-webhook" })
}
