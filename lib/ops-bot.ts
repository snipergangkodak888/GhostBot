import { getDb } from "@/lib/db"
import { deleteProjectCascade } from "@/lib/platform-data"
import { calculateSheetFinancials, createDefaultSheetsForProject, inferSheetKind } from "@/lib/ops-sheets"
import { getOpsSourceDocs } from "@/lib/ops-source-docs"
import { savePayrollDay } from "@/lib/payroll-day"
import { formatTeamDateTime, normalizeReminderDueAt, parseTeamDateTime, teamNowParts, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { getSheetSchema, normalizeSheetKind, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"

function includes(text: string, words: string[]) {
  const lower = text.toLowerCase()
  return words.some((word) => lower.includes(word))
}

function money(value: number) {
  return `$${Number(value || 0).toLocaleString()}`
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

function wantsAi(text: string) {
  return text.startsWith("/ai ") || text.startsWith("ai ")
}

function cleanAiQuestion(text: string) {
  return text.replace(/^\/?ai(?:@\w+)?(?:\s+|$)/i, "").trim()
}

function aiUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : "AI request failed"
  return `🧠 AI is not answering yet.\n\n${message}\n\nCheck the OpenAI key and model in Admin Settings.`
}

function normalizeAiBaseUrl(value: unknown) {
  const url = String(value || "").trim().replace(/\/+$/, "")
  if (url === "https://openrouter.ai/api/v1") return url
  return "https://api.openai.com/v1"
}

function normalizeAiModel(value: unknown) {
  const model = String(value || "").trim()
  if (!model || model === "gpt-4o-mini") return "gpt-5.4-mini"
  return model
}

function outputFromChatCompletion(data: any) {
  const message = data?.choices?.[0]?.message?.content
  if (Array.isArray(message)) {
    return message.map((part: any) => part?.text || part?.content || "").join("\n").trim()
  }
  return String(message || "").trim()
}

const MAX_MESSAGE_LINE = 72

function stripLeadingEmoji(line: string) {
  return line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, "")
}

function iconForLine(line: string) {
  const lower = stripLeadingEmoji(line).toLowerCase()
  if (/^(active projects|project performance|yesterday performance|today performance)/.test(lower)) return "📊"
  if (lower.includes("profit") || lower.includes("p/l")) return "💰"
  if (lower.includes("income") || lower.includes("revenue")) return "💵"
  if (lower.includes("warning") || lower.includes("not found") || lower.includes("could not")) return "⚠️"
  if (lower.includes("created") || lower.includes("added") || lower.includes("updated") || lower.includes("removed")) return "✅"
  return ""
}

function wrapLine(line: string, max = MAX_MESSAGE_LINE) {
  if (line.length <= max) return [line]
  const parts: string[] = []
  let current = ""
  for (const word of line.split(/\s+/)) {
    if (!current) current = word
    else if (`${current} ${word}`.length <= max) current += ` ${word}`
    else {
      parts.push(current)
      current = word
    }
  }
  if (current) parts.push(current)
  return parts
}

function formatBotText(value: string, options: { allowEmoji?: boolean; autoEmoji?: boolean; maxEmoji?: number } = {}) {
  const lines = String(value || "")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/__(.*?)__/g, "<b>$1</b>")
    .replace(/`{1,3}/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
  const output: string[] = []
  let emojiCount = 0
  let previousWasBlank = false
  const maxEmoji = options.maxEmoji ?? 2

  for (const rawLine of lines) {
    if (!rawLine) {
      if (!previousWasBlank && output.length) output.push("")
      previousWasBlank = true
      continue
    }

    const hadEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(rawLine)
    const isBullet = rawLine.startsWith("• ")
    const withoutEmoji = stripLeadingEmoji(rawLine)
    let line = withoutEmoji
    if (options.allowEmoji && !isBullet && emojiCount < maxEmoji) {
      const icon = hadEmoji
        ? rawLine.slice(0, rawLine.length - withoutEmoji.length).trim()
        : options.autoEmoji === false ? "" : iconForLine(withoutEmoji)
      if (icon) {
        line = `${icon} ${withoutEmoji}`
        emojiCount += 1
      }
    }

    if (isBullet && output.length && !previousWasBlank && output[output.length - 1]?.startsWith("• ")) {
      output.push("")
    }

    const wrapped = wrapLine(line)
    output.push(...wrapped)
    previousWasBlank = false
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function formatAiText(value: string) {
  return formatBotText(value, { allowEmoji: true, autoEmoji: false, maxEmoji: 3 })
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>()
  return lines.filter((line) => {
    const key = line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, "").trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isActionRequest(text: string) {
  const lower = text.toLowerCase()
  if (/^(show|list|what|how much|tell me|summarize|summary|calculate|check|view)\b/.test(lower)) return false
  if (/^(yes|yeah|yep|yup|sure|ok|okay|please|thanks|thank you)\b/.test(lower)) return false
  if (/^(yes|yeah|yep|sure|ok|okay)[,.!?\s-]*(go ahead|please|do it|sounds good|that works)\b/.test(lower)) return false
  if (/^go ahead\b/.test(lower)) return false
  return /\b(add|create|insert|update|edit|change|set|schedule|remind|mark|pay|delete|remove)\b/.test(lower)
}

export function isFollowUpMessage(text: string) {
  const lower = String(text || "").trim().toLowerCase()
  if (!lower || lower.length > 120) return false
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|thanks|thank you|go ahead|do it|sounds good|that works|continue|keep going|more detail|expand that|rewrite that|make it client-friendly|client-friendly version)\b/.test(lower)
    || /^(yes|yeah|yep|sure|ok|okay)[,.!?\s-]*(go ahead|please|do it|sounds good|that works)\b/.test(lower)
}

function stripTelegramHtml(text: string) {
  return String(text || "")
    .replace(/<\/?(b|strong|i|em|u|s|code|pre|a)\b[^>]*>/gi, "")
    .replace(/\s+\n/g, "\n")
    .trim()
}

export type OpsConversationContext = {
  replyToBotText?: string
  recentTurns: Array<{ user: string; assistant: string }>
}

export type OpsAiOptions = {
  chatId?: number | string | null
  conversation?: OpsConversationContext
}

export async function buildConversationContext(
  telegramId?: number | null,
  chatId?: number | string | null,
  message?: any,
): Promise<OpsConversationContext | undefined> {
  if (!telegramId) return undefined

  const reply = message?.reply_to_message
  const replyToBotText = reply?.from?.is_bot ? stripTelegramHtml(String(reply.text || "")) : ""
  const db = await getDb()
  const since = new Date(Date.now() - 45 * 60 * 1000)
  const filter: Record<string, unknown> = { telegramId, createdAt: { $gte: since } }
  if (chatId) filter.chatId = String(chatId)

  const logs = await db.collection("opsBotLogs").find(filter).sort({ createdAt: -1 }).limit(4).toArray()
  const recentTurns = logs
    .reverse()
    .map((log: any) => ({
      user: String(log.text || "").replace(/^\/ai\s+/, "").trim(),
      assistant: stripTelegramHtml(String(log.answer || "")),
    }))
    .filter((turn) => turn.user && turn.assistant)
    .slice(-3)

  if (!replyToBotText && recentTurns.length === 0) return undefined
  return {
    replyToBotText: replyToBotText || undefined,
    recentTurns,
  }
}

async function logBotExchange(params: {
  text: string
  answer: string
  telegramId?: number | null
  chatId?: number | string | null
}) {
  const db = await getDb()
  await db.collection("opsBotLogs").insertOne({
    text: params.text,
    answer: params.answer,
    telegramId: params.telegramId || null,
    chatId: params.chatId ? String(params.chatId) : null,
    createdAt: new Date(),
  })
}

function extractJson(text: string) {
  const raw = String(text || "").trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw
  return JSON.parse(candidate)
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    create_project: "Create project",
    update_project: "Update project",
    create_reminder: "Create reminder",
    create_payroll: "Add payroll row",
    add_sheet_row: "Add data row",
    delete_project: "Remove project",
    delete_reminder: "Remove reminder",
    delete_payroll: "Remove payroll row",
    delete_sheet: "Remove data file",
    delete_sheet_row: "Remove data row",
  }
  return labels[actionType] || actionType
}

function actionDetails(payload: any) {
  if (!payload || typeof payload !== "object") return []
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .slice(0, 8)
    .map(([key, value]) => `• ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
}

function cleanSheetTitle(sheet: any) {
  const kind = normalizeSheetKind(sheet?.sheetType || sheet?.title)
  const fallback = getSheetSchema(kind).title
  const rawTitle = String(sheet?.title || "").trim()
  if (!rawTitle) return fallback
  const projectName = String(sheet?.projectName || "").trim()
  const legacyTitles = kind === "notes" ? ["Project Notes"] : kind === "custom" ? ["Custom Data"] : []
  const accepted = [fallback, ...legacyTitles].map((item) => item.toLowerCase())
  if (accepted.includes(rawTitle.toLowerCase())) return fallback
  if (projectName && rawTitle.toLowerCase().startsWith(`${projectName} `.toLowerCase())) {
    const withoutProject = rawTitle.slice(projectName.length).trim()
    if (accepted.includes(withoutProject.toLowerCase())) return fallback
  }
  return rawTitle
}

function sameName(a: unknown, b: unknown) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase()
}

function includesText(value: unknown, needle: unknown) {
  const target = String(value || "").trim().toLowerCase()
  const query = String(needle || "").trim().toLowerCase()
  return Boolean(target && query && target.includes(query))
}

function searchable(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const QUERY_STOP_WORDS = new Set([
  "about", "available", "called", "data", "details", "file", "files", "for", "from", "give", "income",
  "latest", "list", "me", "newest", "oldest", "of", "project", "projects", "revenue", "sheet", "sheets",
  "show", "summary", "tell", "the", "this", "to", "total", "what", "which", "with",
])

function queryTokens(text: string) {
  return searchable(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token))
}

function projectMatchesRequest(projects: any[], text: string) {
  const request = searchable(text)
  const tokens = queryTokens(text)
  const direct = projects.filter((project: any) => {
    const name = searchable(project.name)
    return name && request.includes(name)
  })
  if (direct.length) return direct

  return projects.filter((project: any) => {
    const name = searchable(project.name)
    if (!name) return false
    const nameTokens = name.split(" ").filter(Boolean)
    return tokens.some((token) => name === token || nameTokens.includes(token))
  })
}

function sheetKindMentioned(text: string): SheetKind | null {
  const lower = text.toLowerCase()
  if (/\b(income|revenue|sales|earning|earnings)\b/.test(lower)) return "income"
  if (/\b(expense|expenses|cost|costs|spend|spending)\b/.test(lower)) return "expense"
  if (/\b(payroll|salary|salaries|payout|payouts)\b/.test(lower)) return "payroll"
  if (/\b(note|notes|knowledge|docs)\b/.test(lower)) return "notes"
  if (/\b(custom)\b/.test(lower)) return "custom"
  return null
}

function sheetMatchesRequest(sheets: any[], text: string) {
  const request = searchable(text)
  const kind = sheetKindMentioned(text)
  const direct = sheets.filter((sheet: any) => {
    const title = searchable(sheet.title)
    const cleanTitle = searchable(cleanSheetTitle(sheet))
    return (title && request.includes(title)) || (cleanTitle && request.includes(cleanTitle))
  })
  if (kind) return sheets.filter((sheet: any) => normalizeSheetKind(sheet.sheetType || sheet.title) === kind)
  return direct
}

function scopeOpsQuestion(text: string, projects: any[], sheets: any[]) {
  const matchedProjects = projectMatchesRequest(projects, text)
  const matchedProjectIds = new Set(matchedProjects.map((project: any) => String(project._id || "")).filter(Boolean))
  const matchedProjectNames = new Set(matchedProjects.map((project: any) => searchable(project.name)).filter(Boolean))
  let scopedProjects = projects
  let scopedSheets = sheets
  let hasScope = false
  let label = "tracked projects"

  if (matchedProjects.length) {
    hasScope = true
    scopedProjects = matchedProjects
    scopedSheets = sheets.filter((sheet: any) => {
      const projectId = String(sheet.projectId || "")
      const projectName = searchable(sheet.projectName)
      return matchedProjectIds.has(projectId) || matchedProjectNames.has(projectName)
    })

    const uniqueNames = Array.from(new Set(matchedProjects.map((project: any) => String(project.name || "").trim()).filter(Boolean)))
    label = uniqueNames.length === 1 ? uniqueNames[0] : uniqueNames.join(", ")
  }

  const kind = sheetKindMentioned(text)
  if (kind) {
    hasScope = true
    scopedSheets = scopedSheets.filter((sheet: any) => normalizeSheetKind(sheet.sheetType || sheet.title) === kind)
    if (!matchedProjects.length) {
      scopedProjects = projects.filter((project: any) =>
        scopedSheets.some((sheet: any) => String(sheet.projectId || "") === String(project._id || "") || sameName(sheet.projectName, project.name)),
      )
      label = getSheetSchema(kind).title.toLowerCase()
    }
  } else if (!matchedProjects.length) {
    const matchedSheets = sheetMatchesRequest(sheets, text)
    if (matchedSheets.length) {
      hasScope = true
      scopedSheets = matchedSheets
      const sheetProjectIds = new Set(matchedSheets.map((sheet: any) => String(sheet.projectId || "")).filter(Boolean))
      const sheetProjectNames = new Set(matchedSheets.map((sheet: any) => searchable(sheet.projectName)).filter(Boolean))
      scopedProjects = projects.filter((project: any) => sheetProjectIds.has(String(project._id || "")) || sheetProjectNames.has(searchable(project.name)))
      label = Array.from(new Set(matchedSheets.map((sheet: any) => cleanSheetTitle(sheet)))).join(", ")
    }
  }

  return { projects: scopedProjects, sheets: scopedSheets, hasScope, label }
}

function duplicateNamedScope(projects: any[]) {
  const names = new Set(projects.map((project: any) => searchable(project.name)).filter(Boolean))
  return projects.length > 1 && names.size === 1
}

function sheetsForProject(project: any, sheets: any[]) {
  return sheets.filter((sheet: any) => String(sheet.projectId || "") === String(project._id || "") || sameName(sheet.projectName, project.name))
}

function projectFinancialLines(projects: any[], sheets: any[], pick: (financials: ReturnType<typeof calculateSheetFinancials>, project: any) => number) {
  return projects.map((project: any) => {
    const financials = calculateSheetFinancials(sheetsForProject(project, sheets))
    const date = candidateDate(project)
    return `• ${project.name} (${date}): ${money(pick(financials, project))}`
  })
}

function firstValue(row: any, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ""
}

function noteValue(project: any, labels: string[]) {
  const notes = String(project?.notes || "")
  for (const label of labels) {
    const match = notes.match(new RegExp(`${label}\\s*[:=-]\\s*([^\\n,;]+)`, "i"))
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return ""
}

function projectField(project: any, keys: string[], noteLabels: string[], fallback = "Not set") {
  return firstValue(project, keys) || noteValue(project, noteLabels) || fallback
}

function projectStatus(project: any) {
  const raw = firstValue(project, ["status", "projectStatus"])
  if (!raw) return "Active"
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function projectService(project: any) {
  const direct = projectField(project, ["service", "serviceType", "projectService"], ["service"], "")
  if (direct) return direct
  const tags = Array.isArray(project?.tags) ? project.tags.map((tag: unknown) => String(tag).toLowerCase()) : []
  const hasTge = tags.some((tag: string) => tag.includes("tge"))
  const hasMm = tags.some((tag: string) => tag === "mm" || tag.includes("market"))
  if (hasTge && hasMm) return "TGE + MM"
  if (hasMm) return "MM"
  if (hasTge) return "TGE"
  return "Not set"
}

function projectDate(project: any, keys: string[], noteLabels: string[]) {
  const value = firstValue(project, keys) || noteValue(project, noteLabels)
  if (!value) return "Not set"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function formatOpsProjectDetails(project: any, sheets: any[] = []) {
  const financials = calculateSheetFinancials(sheetsForProject(project, sheets))
  const ledgerProfit = Number(project.currentProfitLoss ?? project.profitThisWeek ?? 0)
  const profit = financials.profitThisMonth || financials.profitThisWeek || financials.profitToday || ledgerProfit
  const referrer = projectField(project, ["referrer", "referrerName", "referral", "referredBy"], ["referrer", "referred by"], "None")
  const wallet = projectField(project, ["referrerWallet", "referralWallet", "wallet", "walletAddress"], ["referrer wallet", "wallet"], "None")
  return [
    `Name: ${String(project.name || "Unnamed project")}`,
    `Referrer: ${referrer}`,
    `Referrer Wallet: ${wallet}`,
    `Status: ${projectStatus(project)}`,
    `Service: ${projectService(project)}`,
    `Start date: ${projectDate(project, ["startDate", "launchDate"], ["start", "start date"])}`,
    `End date: ${projectDate(project, ["endDate"], ["end", "end date"])}`,
    `Profit / Loss: ${money(profit)}`,
  ].join("\n")
}

export function formatOpsActiveProjects(projects: any[], sheets: any[]) {
  const active = projects.filter((project: any) => String(project.status || "active").toLowerCase() !== "inactive")
  if (!active.length) return "No active projects."

  const rows = active.slice(0, 6).map((project: any) => formatOpsProjectDetails(project, sheets))

  const suffix = active.length > rows.length ? `\n\n${active.length - rows.length} more active projects.` : ""
  return `Active projects:\n\n${rows.join("\n\n")}${suffix}`
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function dateFromQuestion(text: string) {
  const date = new Date()
  const lower = text.toLowerCase()
  if (lower.includes("yesterday")) date.setDate(date.getDate() - 1)
  return date
}

function headerMatch(headers: string[], names: string[]) {
  const normalized = headers.map((header) => searchable(header))
  for (const name of names) {
    const index = normalized.findIndex((header) => header === name || header.includes(name))
    if (index >= 0) return index
  }
  return -1
}

function amountValue(value: unknown) {
  const amount = Number(String(value || "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(amount) ? Math.abs(amount) : 0
}

function sheetAmountForDay(sheet: any, targetKey: string) {
  const kind = normalizeSheetKind(sheet.sheetType || sheet.title)
  const values = valuesForKind(kind, sheet.values || [])
  const headers = values[0] || getSheetSchema(kind).headers
  const amountIndex = headerMatch(headers, ["amount", "total", "value", "revenue", "income", "cost", "expense", "pay"])
  const dateIndex = headerMatch(headers, ["date", "day"])
  if (amountIndex < 0) return 0
  return values.slice(1).reduce((sum, row) => {
    const date = dateIndex >= 0 ? new Date(String(row[dateIndex] || "")) : new Date()
    if (Number.isNaN(date.getTime()) || localDateKey(date) !== targetKey) return sum
    return sum + amountValue(row[amountIndex])
  }, 0)
}

function wantsProjectPerformance(text: string) {
  const lower = text.toLowerCase()
  return /\b(performance|performed|report|summary)\b/.test(lower) && /\b(projects?|our|my|team|ops|operations)\b/.test(lower)
}

function formatProjectPerformance(projects: any[], sheets: any[], text: string) {
  const target = dateFromQuestion(text)
  const targetKey = localDateKey(target)
  const label = text.toLowerCase().includes("yesterday") ? "Yesterday" : "Today"
  const rows = projects
    .filter((project: any) => String(project.status || "active").toLowerCase() !== "inactive")
    .map((project: any) => {
      const projectSheets = sheetsForProject(project, sheets)
      const income = projectSheets.filter((sheet: any) => normalizeSheetKind(sheet.sheetType || sheet.title) === "income").reduce((sum, sheet) => sum + sheetAmountForDay(sheet, targetKey), 0)
      const expense = projectSheets.filter((sheet: any) => normalizeSheetKind(sheet.sheetType || sheet.title) === "expense").reduce((sum, sheet) => sum + sheetAmountForDay(sheet, targetKey), 0)
      const payroll = projectSheets.filter((sheet: any) => normalizeSheetKind(sheet.sheetType || sheet.title) === "payroll").reduce((sum, sheet) => sum + sheetAmountForDay(sheet, targetKey), 0)
      return { name: String(project.name || "Project"), income, expense, payroll, profit: income - expense - payroll }
    })
    .filter((row) => row.income || row.expense || row.payroll || row.profit)

  if (!rows.length) return `${label} performance:\n\nNo project rows found for ${targetKey}.`

  const totals = rows.reduce((acc, row) => ({
    income: acc.income + row.income,
    expense: acc.expense + row.expense,
    payroll: acc.payroll + row.payroll,
    profit: acc.profit + row.profit,
  }), { income: 0, expense: 0, payroll: 0, profit: 0 })

  return [
    `${label} performance: ${money(totals.profit)} P/L`,
    `Income: ${money(totals.income)}`,
    `Cost: ${money(totals.expense + totals.payroll)}`,
    "",
    ...rows.slice(0, 5).map((row) => `• ${row.name}: ${money(row.profit)} P/L`),
    rows.length > 5 ? `${rows.length - 5} more projects.` : "",
  ].filter(Boolean).join("\n")
}

function sameDateDay(a: unknown, b: unknown) {
  if (!a || !b) return false
  const da = new Date(String(a))
  const db = new Date(String(b))
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10)
}

function amountMatches(a: unknown, b: unknown) {
  if (b === undefined || b === null || String(b).trim() === "") return true
  return Number(a || 0) === Number(b || 0)
}

function latestProject(projects: any[]) {
  return [...projects].sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0] || null
}

function resolveProject(projects: any[], value: unknown, request: string) {
  const raw = String(value || "").trim()
  if (!raw || /^(this|latest|current)\s+project$/i.test(raw) || /\b(this|latest|current) project\b/i.test(request)) return latestProject(projects)
  return projects.find((item: any) => sameName(item.name, raw)) || projects.find((item: any) => includesText(item.name, raw)) || null
}

function sortNewestFirst(rows: any[]) {
  return [...rows].sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || b.launchDate || 0).getTime() - new Date(a.updatedAt || a.createdAt || a.launchDate || 0).getTime())
}

function candidateDate(value: any) {
  const date = new Date(value?.updatedAt || value?.createdAt || value?.launchDate || "")
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString()
}

async function resolveActionPreview(actionType: string, payload: any, context: { request: string; projects: any[]; sheets: any[] }) {
  const db = await getDb()
  const preview: string[] = []
  const warnings: string[] = []
  const nextPayload = { ...(payload || {}) }
  let needsChoice = false
  const isDelete = actionType.startsWith("delete_")
  const project = resolveProject(context.projects, nextPayload.projectName || nextPayload.name, context.request)

  if (project && !nextPayload.projectName) nextPayload.projectName = project.name
  if (project) preview.push(`📁 Project: ${project.name}`)

  if (actionType === "delete_project") {
    const requested = String(nextPayload.projectName || nextPayload.name || "").trim()
    const matches = requested
      ? context.projects.filter((item: any) => sameName(item.name, requested) || includesText(item.name, requested))
      : project ? [project] : []
    if (matches.length > 1) {
      needsChoice = true
      const sorted = sortNewestFirst(matches)
      nextPayload._candidates = sorted.map((item: any) => ({ _id: item._id, name: item.name, owner: item.owner, updatedAt: item.updatedAt, createdAt: item.createdAt }))
      preview.push(`⚠️ I found ${matches.length} projects with this name.`)
      preview.push(...sorted.slice(0, 5).map((item: any, index: number) => `${index === 0 ? "🆕" : index === sorted.length - 1 ? "🕰️" : "📁"} ${item.name} • owner: ${item.owner || "No owner"} • updated: ${candidateDate(item)}`))
      warnings.push("Choose newest or oldest first, then I will ask for final confirmation.")
    } else if (!project && matches.length !== 1) warnings.push("I could not identify one exact project yet.")
    else {
      const target = matches[0] || project
      nextPayload._projectId = target._id
      nextPayload.projectName = target.name
      const projectSheets = context.sheets.filter((sheet: any) => String(sheet.projectId || "") === String(target._id) || sameName(sheet.projectName, target.name))
      preview.push(`🗑️ Will remove project: ${target.name}`)
      preview.push(`📄 Files also removed: ${projectSheets.length}`)
      if (projectSheets.length) preview.push(...projectSheets.slice(0, 5).map((sheet: any) => `• ${cleanSheetTitle(sheet)} file`))
    }
  }

  if (actionType === "delete_sheet") {
    const kind = normalizeSheetKind(nextPayload.sheetType || nextPayload.title || context.request)
    nextPayload.sheetType = kind
    const matches = context.sheets.filter((sheet: any) => {
      const projectOk = project ? String(sheet.projectId || "") === String(project._id) || sameName(sheet.projectName, project.name) : true
      const kindOk = normalizeSheetKind(sheet.sheetType || sheet.title) === kind
      const titleOk = nextPayload.title ? includesText(sheet.title, nextPayload.title) || sameName(cleanSheetTitle(sheet), nextPayload.title) : true
      return projectOk && kindOk && titleOk
    })
    if (matches.length === 1) {
      const sheet = matches[0]
      nextPayload._sheetId = sheet._id
      nextPayload.projectName = sheet.projectName || project?.name || nextPayload.projectName
      nextPayload.title = cleanSheetTitle(sheet)
      nextPayload.sheetType = normalizeSheetKind(sheet.sheetType || sheet.title)
      preview.push(`🗑️ Will remove data file: ${cleanSheetTitle(sheet)}`)
      preview.push(`📁 Project: ${sheet.projectName || project?.name || "No project"}`)
      preview.push(`📄 File type: ${getSheetSchema(nextPayload.sheetType).title}`)
      preview.push(`📄 Rows inside: ${Math.max(0, valuesForKind(nextPayload.sheetType, sheet.values || []).length - 1)}`)
    } else if (matches.length > 1) {
      needsChoice = true
      const sorted = sortNewestFirst(matches)
      nextPayload._candidates = sorted.map((sheet: any) => ({
        _id: sheet._id,
        title: cleanSheetTitle(sheet),
        projectName: sheet.projectName || "",
        sheetType: normalizeSheetKind(sheet.sheetType || sheet.title),
        rows: Math.max(0, valuesForKind(sheet.sheetType || "custom", sheet.values || []).length - 1),
        updatedAt: sheet.updatedAt,
        createdAt: sheet.createdAt,
      }))
      preview.push(`⚠️ I found ${matches.length} matching data files.`)
      preview.push(...nextPayload._candidates.slice(0, 5).map((sheet: any, index: number) => `${index === 0 ? "🆕" : index === nextPayload._candidates.length - 1 ? "🕰️" : "📄"} ${sheet.title} • project: ${sheet.projectName || "No project"} • rows: ${sheet.rows} • updated: ${candidateDate(sheet)}`))
      warnings.push("Choose newest or oldest first, then I will ask for final confirmation.")
    } else {
      warnings.push(`I found ${matches.length} matching data files. I need one exact match before removing.`)
    }
  }

  if (actionType === "delete_reminder") {
    const reminders = await db.collection("opsReminders").find({}).toArray()
    const matches = reminders.filter((item: any) => {
      const titleMatch = includesText(item.title, nextPayload.title) || includesText(item.message, nextPayload.title || nextPayload.message)
      const dateOk = nextPayload.dueAt ? sameDateDay(item.dueAt, nextPayload.dueAt) : true
      return titleMatch && dateOk && item.status !== "done"
    })
    if (matches.length === 1) {
      const reminder = matches[0]
      nextPayload.title = reminder.title || reminder.message
      nextPayload.dueAt = reminder.dueAt || nextPayload.dueAt
      preview.push(`🗑️ Will remove reminder: ${reminder.title || reminder.message}`)
      if (reminder.dueAt) preview.push(`📅 Due: ${formatTeamDateTime(reminder.dueAt)}`)
    } else warnings.push(`I found ${matches.length} matching reminders. I need one exact match before removing.`)
  }

  if (actionType === "delete_payroll") {
    const payroll = await db.collection("opsPayroll").find({}).toArray()
    const matches = payroll.filter((item: any) => {
      const memberOk = includesText(item.member, nextPayload.member)
      const projectOk = nextPayload.projectName ? includesText(item.project, nextPayload.projectName) : true
      const dateOk = nextPayload.date ? sameDateDay(item.date, nextPayload.date) : true
      return memberOk && projectOk && dateOk && amountMatches(item.amount, nextPayload.amount)
    })
    if (matches.length === 1) {
      const row = matches[0]
      nextPayload.member = row.member
      nextPayload.projectName = row.project || nextPayload.projectName
      nextPayload.amount = row.amount
      nextPayload.date = row.date || nextPayload.date
      preview.push(`🗑️ Will remove payroll row: ${row.member}`)
      preview.push(`💸 Amount: ${money(row.amount)}`)
      if (row.project) preview.push(`📁 Project: ${row.project}`)
      if (row.date) preview.push(`📅 Date: ${row.date}`)
    } else warnings.push(`I found ${matches.length} matching payroll rows. I need one exact match before removing.`)
  }

  if (actionType === "delete_sheet_row") {
    const kind = normalizeSheetKind(nextPayload.sheetType || context.request)
    nextPayload.sheetType = kind
    const sheet = context.sheets.find((item: any) => {
      const projectOk = project ? String(item.projectId || "") === String(project._id) || sameName(item.projectName, project.name) : true
      return projectOk && normalizeSheetKind(item.sheetType || item.title) === kind
    })
    if (!sheet) warnings.push("I could not identify the exact data file yet.")
    else {
      preview.push(`🗑️ Will remove row from: ${cleanSheetTitle(sheet)}`)
      preview.push(`📁 Project: ${sheet.projectName || project?.name || "No project"}`)
      const match = nextPayload.match && typeof nextPayload.match === "object" ? nextPayload.match : {}
      const matchText = Object.entries(match).filter(([, value]) => String(value || "").trim()).map(([key, value]) => `${key}: ${value}`).join(", ")
      if (matchText) preview.push(`🔎 Matching row: ${matchText}`)
      else warnings.push("No row match details were detected, so I will not remove a row until it is specific.")
    }
  }

  if (!isDelete) {
    if (actionType === "create_reminder" && nextPayload.title) preview.push(`🔔 Reminder: ${nextPayload.title}`)
    if (actionType === "create_reminder" && nextPayload.dueAt) {
      const parsed = parseTeamDateTime(nextPayload.dueAt, String(nextPayload.timeZone || nextPayload.timezone || TEAM_TIME_ZONE))
      preview.push(`📅 Due: ${parsed ? formatTeamDateTime(parsed) : String(nextPayload.dueAt)}`)
    }
    if (actionType === "create_payroll" && nextPayload.member) preview.push(`💸 Payroll member: ${nextPayload.member}`)
  }

  return { payload: nextPayload, preview, warnings, needsChoice }
}

async function aiChat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, temperature = 0.2) {
  const db = await getDb()
  const row = await db.collection("settings").findOne({ key: "openAi" })
  const openAi = row?.value && typeof row.value === "object" ? row.value : {}
  const apiKey = String((openAi as any).apiKey || "").trim()
  if ((openAi as any).enabled === false || !apiKey) {
    throw new Error("OpenAI is not configured. Add the API key in Admin Settings.")
  }

  const model = normalizeAiModel((openAi as any).model)
  const baseUrl = normalizeAiBaseUrl((openAi as any).baseUrl)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(baseUrl.includes("openrouter.ai") ? { "HTTP-Referer": "https://ghost-sys.vercel.app", "X-Title": "Ghost Team System" } : {}),
    },
    body: JSON.stringify({ model, messages, temperature }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data?.error?.message || data?.message || `OpenAI request failed with status ${res.status}`
    throw new Error(detail)
  }
  return outputFromChatCompletion(data) || "No answer returned."
}

export async function proposeOpsAiAction(textInput: string, telegramId?: number | null) {
  const text = String(textInput || "").trim()
  if (!text || !isActionRequest(text)) return null

  const db = await getDb()
  const [projects, sheets] = await Promise.all([
    db.collection("opsProjects").find({}).toArray(),
    db.collection("opsSheets").find({}).toArray(),
  ])
  const projectNames = projects.slice(0, 40).map((project: any) => project.name).filter(Boolean)
  const sheetRefs = sheets.slice(0, 60).map((sheet: any) => ({
    title: cleanSheetTitle(sheet),
    projectName: sheet.projectName,
    sheetType: sheet.sheetType || inferSheetKind(sheet),
    headers: valuesForKind(sheet.sheetType || "custom", sheet.values || [])[0] || getSheetSchema(sheet.sheetType || "custom").headers,
  }))

  const raw = await aiChat([
    {
      role: "system",
      content: [
        "You turn Ghost Team user requests into one safe pending action.",
        "Return JSON only. No markdown.",
        "If the user is only asking a question or asking to show/list/summarize data, return {\"actionType\":\"none\"}.",
        "Supported actionType values: create_project, update_project, create_reminder, create_payroll, add_sheet_row, delete_project, delete_reminder, delete_payroll, delete_sheet, delete_sheet_row, none.",
        "Payload shapes:",
        "create_project: {name, referrer, referrerWallet, status, service, startDate, endDate, currentProfitLoss, notes, tags}",
        "update_project: {projectName, name, referrer, referrerWallet, status, service, startDate, endDate, currentProfitLoss, notes, tags}",
        "create_reminder: {title, message, dueAt, timeZone?}",
        "create_payroll: {member, amount, projectName, date, status, currency, notes}",
        "add_sheet_row: {projectName, sheetType, row}",
        "delete_project: {projectName}",
        "delete_reminder: {title, dueAt}",
        "delete_payroll: {member, projectName, date, amount}",
        "delete_sheet: {projectName, sheetType, title}",
        "delete_sheet_row: {projectName, sheetType, match}",
        `Team default timezone is ${TEAM_TIME_ZONE} (ET). Interpret reminder times without an explicit timezone as ET.`,
        "For create_reminder dueAt, return a local datetime string WITHOUT a Z suffix, e.g. 2026-07-07T23:00:00 for 11:00 PM ET on July 7.",
        "If the user names another timezone (PT, UTC, London, etc.), include timeZone in the payload using an IANA name like America/Los_Angeles.",
        "Use exact existing project names when possible. Do not invent missing required values.",
        "For delete actions, identify the most specific target possible and add warnings if more than one item may match.",
        "Return: {actionType, summary, payload, warnings}.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        request: text,
        nowUtc: new Date().toISOString(),
        nowEt: formatTeamDateTime(new Date()),
        teamTimeZone: TEAM_TIME_ZONE,
        teamNow: teamNowParts(),
        projects: projectNames,
        sheets: sheetRefs,
      }),
    },
  ], 0)

  let plan: any
  try {
    plan = extractJson(raw)
  } catch {
    return null
  }

  const actionType = String(plan?.actionType || "none")
  if (actionType === "none") return null
  if (!["create_project", "update_project", "create_reminder", "create_payroll", "add_sheet_row", "delete_project", "delete_reminder", "delete_payroll", "delete_sheet", "delete_sheet_row"].includes(actionType)) return null

  const payload = plan?.payload && typeof plan.payload === "object" ? plan.payload : {}
  if (actionType === "create_reminder") {
    const normalized = normalizeReminderDueAt(payload)
    if (normalized) {
      payload.dueAt = normalized.dueAt
      payload.timeZone = normalized.timeZone
    }
  }
  const resolved = await resolveActionPreview(actionType, payload, { request: text, projects, sheets })
  const summary = String(plan?.summary || actionLabel(actionType)).trim()
  const warnings = [
    ...(Array.isArray(plan?.warnings) ? plan.warnings.map(String).filter(Boolean) : []),
    ...resolved.warnings,
  ]
  const now = new Date()
  const record = {
    telegramId: telegramId || null,
    request: text,
    actionType,
    summary,
    payload: resolved.payload,
    preview: resolved.preview,
    warnings,
    needsChoice: resolved.needsChoice,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("opsAiActions").insertOne(record)
  const actionId = String(result.insertedId)
  const details = uniqueLines(resolved.preview.length ? resolved.preview : actionDetails(resolved.payload))
  const isDelete = actionType.startsWith("delete_")
  const message = [
    isDelete ? "🧠 I can remove this for you." : "🧠 I can do this for you.",
    "",
    `⚙️ Action: ${actionLabel(actionType)}`,
    `${isDelete ? "🗑️ Remove" : "📌 Plan"}: ${summary}`,
    details.length ? ["", ...details].join("\n") : "",
    warnings.length ? ["", "⚠️ Notes:", ...warnings.map((warning) => `• ${warning}`)].join("\n") : "",
    "",
    isDelete ? "Confirm before I remove this?" : "Confirm before I change anything?",
  ].filter(Boolean).join("\n")

  return {
    actionId,
    message: formatBotText(message, { allowEmoji: true }),
    needsChoice: resolved.needsChoice,
    buttons: resolved.needsChoice
      ? [[
          { text: "🆕 Newest", callback_data: `ai:newest:${actionId}` },
          { text: "🕰️ Oldest", callback_data: `ai:oldest:${actionId}` },
        ], [
          { text: "❌ Refuse", callback_data: `ai:reject:${actionId}` },
        ]]
      : undefined,
  }
}

export async function chooseOpsAiActionCandidate(actionId: string, choice: "newest" | "oldest", telegramId?: number | null) {
  const db = await getDb()
  const action = await db.collection("opsAiActions").findOne({ _id: actionId })
  if (!action || (telegramId && action.telegramId && Number(action.telegramId) !== Number(telegramId))) {
    return { message: "⚠️ I could not find that pending action.", ok: false }
  }
  if (action.status !== "pending") return { message: `⚠️ This action is already ${action.status}.`, ok: false }

  const candidates = Array.isArray(action.payload?._candidates) ? action.payload._candidates : []
  if (!candidates.length) return { message: "⚠️ I do not have choices for that action anymore.", ok: false }
  const sorted = sortNewestFirst(candidates)
  const selected = choice === "oldest" ? sorted[sorted.length - 1] : sorted[0]
  const payload = { ...(action.payload || {}) }
  delete payload._candidates

  const preview: string[] = []
  if (action.actionType === "delete_project") {
    payload._projectId = selected._id
    payload.projectName = selected.name
    preview.push(`🗑️ Will remove project: ${selected.name}`)
    if (selected.owner) preview.push(`👤 Owner: ${selected.owner}`)
    preview.push(`${choice === "oldest" ? "🕰️" : "🆕"} Choice: ${choice}`)
  }

  if (action.actionType === "delete_sheet") {
    payload._sheetId = selected._id
    payload.projectName = selected.projectName
    payload.title = selected.title
    payload.sheetType = selected.sheetType
    preview.push(`🗑️ Will remove data file: ${selected.title}`)
    preview.push(`📁 Project: ${selected.projectName || "No project"}`)
    preview.push(`📄 File type: ${getSheetSchema(selected.sheetType).title}`)
    preview.push(`📄 Rows inside: ${selected.rows}`)
    preview.push(`${choice === "oldest" ? "🕰️" : "🆕"} Choice: ${choice}`)
  }

  await db.collection("opsAiActions").updateOne(
    { _id: actionId },
    { $set: { payload, preview, needsChoice: false, warnings: [], updatedAt: new Date() } },
  )

  return {
    ok: true,
    message: formatBotText([
      "🧠 Target selected.",
      "",
      `⚙️ Action: ${actionLabel(action.actionType)}`,
      ...preview,
      "",
      "Confirm before I remove this?",
    ].join("\n"), { allowEmoji: true }),
  }
}

export async function rejectOpsAiAction(actionId: string, telegramId?: number | null) {
  const db = await getDb()
  const action = await db.collection("opsAiActions").findOne({ _id: actionId })
  if (!action || (telegramId && action.telegramId && Number(action.telegramId) !== Number(telegramId))) {
    return "⚠️ I could not find that pending action."
  }
  await db.collection("opsAiActions").updateOne({ _id: actionId }, { $set: { status: "rejected", updatedAt: new Date() } })
  return formatBotText("❌ Refused. I did not change anything.", { allowEmoji: true })
}

export async function executeOpsAiAction(actionId: string, telegramId?: number | null) {
  const db = await getDb()
  const action = await db.collection("opsAiActions").findOne({ _id: actionId })
  if (!action || (telegramId && action.telegramId && Number(action.telegramId) !== Number(telegramId))) {
    return "⚠️ I could not find that pending action."
  }
  if (action.status !== "pending") return `⚠️ This action is already ${action.status}.`

  const now = new Date()
  const payload = action.payload || {}
  let done = ""

  if (action.actionType === "create_project") {
    const name = String(payload.name || "").trim()
    if (!name) return "⚠️ Missing project name. I did not change anything."
    const startDate = payload.startDate || payload.launchDate
    const currentProfitLoss = Number(payload.currentProfitLoss || 0)
    const project = {
      name,
      referrer: String(payload.referrer || payload.owner || "").trim(),
      referrerWallet: String(payload.referrerWallet || "").trim(),
      status: payload.status === "inactive" ? "inactive" : payload.status === "in_progress" ? "in_progress" : "active",
      service: String(payload.service || "").trim(),
      startDate: startDate ? new Date(startDate).toISOString() : null,
      endDate: payload.endDate ? new Date(payload.endDate).toISOString() : null,
      launchDate: startDate ? new Date(startDate).toISOString() : null,
      revenueToday: 0,
      currentProfitLoss,
      profitThisWeek: currentProfitLoss,
      notes: String(payload.notes || "").trim(),
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      createdAt: now,
      updatedAt: now,
    }
    const result = await db.collection("opsProjects").insertOne(project)
    await createDefaultSheetsForProject(String(result.insertedId), name)
    done = `✅ Project created: ${name}`
  }

  if (action.actionType === "update_project") {
    const projects = await db.collection("opsProjects").find({}).toArray()
    const project = projects.find((item: any) => sameName(item.name, payload.projectName || payload.name))
    if (!project) return "⚠️ I could not find that project. I did not change anything."
    const update: Record<string, any> = { updatedAt: now }
    if (payload.name) update.name = String(payload.name).trim()
    if (payload.referrer !== undefined || payload.owner !== undefined) update.referrer = String(payload.referrer || payload.owner || "").trim()
    if (payload.referrerWallet !== undefined) update.referrerWallet = String(payload.referrerWallet || "").trim()
    if (payload.service !== undefined) update.service = String(payload.service || "").trim()
    if (payload.startDate !== undefined || payload.launchDate !== undefined) {
      const startDate = payload.startDate || payload.launchDate
      update.startDate = startDate ? new Date(startDate).toISOString() : null
      update.launchDate = update.startDate
    }
    if (payload.endDate !== undefined) update.endDate = payload.endDate ? new Date(payload.endDate).toISOString() : null
    if (payload.currentProfitLoss !== undefined) {
      update.currentProfitLoss = Number(payload.currentProfitLoss || 0)
      update.profitThisWeek = update.currentProfitLoss
    }
    if (payload.status) update.status = payload.status === "inactive" ? "inactive" : payload.status === "in_progress" ? "in_progress" : "active"
    if (payload.notes !== undefined) update.notes = String(payload.notes || "").trim()
    if (Array.isArray(payload.tags)) update.tags = payload.tags.map(String)
    await db.collection("opsProjects").updateOne({ _id: project._id }, { $set: update })
    done = `✅ Project updated: ${project.name}`
  }

  if (action.actionType === "create_reminder") {
    const title = String(payload.title || payload.message || "").trim()
    if (!title) return "⚠️ Missing reminder title. I did not change anything."
    const normalized = normalizeReminderDueAt(payload)
    const dueAt = normalized?.dueAt || new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await db.collection("opsReminders").insertOne({
      title,
      message: String(payload.message || title).trim(),
      dueAt,
      timeZone: normalized?.timeZone || TEAM_TIME_ZONE,
      recurrence: "none",
      audience: "team",
      status: "scheduled",
      createdFrom: "ai",
      telegramId: telegramId || null,
      createdAt: now,
      updatedAt: now,
    })
    done = `✅ Reminder created: ${title}\n📅 Due: ${formatTeamDateTime(dueAt)}`
  }

  if (action.actionType === "create_payroll") {
    const member = String(payload.member || "").trim()
    if (!member) return "⚠️ Missing payroll member. I did not change anything."
    const projects = await db.collection("opsProjects").find({}).toArray()
    const project = projects.find((item: any) => sameName(item.name, payload.projectName))
    await db.collection("opsPayroll").insertOne({
      member,
      amount: Number(payload.amount || 0),
      projectId: project?._id || "",
      project: project?.name || String(payload.projectName || "").trim(),
      date: payload.date ? new Date(payload.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      status: payload.status === "paid" ? "paid" : "pending",
      currency: String(payload.currency || "USD").trim(),
      notes: String(payload.notes || "").trim(),
      createdFrom: "ai",
      telegramId: telegramId || null,
      createdAt: now,
      updatedAt: now,
    })
    done = `✅ Payroll row added: ${member}`
  }

  if (action.actionType === "add_sheet_row") {
    const projects = await db.collection("opsProjects").find({}).toArray()
    const project = projects.find((item: any) => sameName(item.name, payload.projectName))
    if (!project) return "⚠️ I could not find that project. I did not change anything."
    const kind = normalizeSheetKind(payload.sheetType)
    const schema = getSheetSchema(kind)
    const sheets = await db.collection("opsSheets").find({ projectId: String(project._id) }).toArray()
    let sheet = sheets.find((item: any) => normalizeSheetKind(item.sheetType) === kind)
    if (!sheet) {
      const result = await db.collection("opsSheets").insertOne({
        title: schema.title,
        tabName: schema.tabName,
        category: schema.category,
        sheetType: kind,
        projectId: String(project._id),
        projectName: project.name,
        values: [schema.headers],
        sourceType: "ai",
        createdAt: now,
        updatedAt: now,
      })
      sheet = { _id: result.insertedId, values: [schema.headers], sheetType: kind }
    }
    const values = valuesForKind(kind, sheet.values || [])
    const headers = values[0] || schema.headers
    const rowPayload = payload.row && typeof payload.row === "object" ? payload.row : {}
    const row = headers.map((header) => String(rowPayload[header] ?? rowPayload[header.toLowerCase()] ?? "").trim())
    if (!row.some(Boolean)) return "⚠️ Missing row values. I did not change anything."
    await db.collection("opsSheets").updateOne({ _id: sheet._id }, { $set: { values: [headers, ...values.slice(1), row], updatedAt: now } })
    done = `✅ ${schema.title} row added for ${project.name}`
  }

  if (action.actionType === "delete_project") {
    const projects = await db.collection("opsProjects").find({}).toArray()
    const matches = payload._projectId
      ? projects.filter((item: any) => String(item._id) === String(payload._projectId))
      : projects.filter((item: any) => sameName(item.name, payload.projectName) || includesText(item.name, payload.projectName))
    if (matches.length !== 1) return `⚠️ I found ${matches.length} matching projects. I did not remove anything.`
    const project = matches[0]
    const deleted = await deleteProjectCascade(String(project._id), project.name)
    done = `🗑️ Project removed: ${project.name} (${deleted.deleted} related records)`
  }

  if (action.actionType === "delete_reminder") {
    const reminders = await db.collection("opsReminders").find({}).toArray()
    const matches = reminders.filter((item: any) => {
      const titleMatch = includesText(item.title, payload.title) || includesText(item.message, payload.title || payload.message)
      const dateOk = payload.dueAt ? sameDateDay(item.dueAt, payload.dueAt) : true
      return titleMatch && dateOk && item.status !== "done"
    })
    if (matches.length !== 1) return `⚠️ I found ${matches.length} matching reminders. I did not remove anything.`
    const reminder = matches[0]
    await db.collection("opsReminders").deleteOne({ _id: reminder._id })
    done = `🗑️ Reminder removed: ${reminder.title || reminder.message}`
  }

  if (action.actionType === "delete_payroll") {
    const payroll = await db.collection("opsPayroll").find({}).toArray()
    const matches = payroll.filter((item: any) => {
      const memberOk = includesText(item.member, payload.member)
      const projectOk = payload.projectName ? includesText(item.project, payload.projectName) : true
      const dateOk = payload.date ? sameDateDay(item.date, payload.date) : true
      return memberOk && projectOk && dateOk && amountMatches(item.amount, payload.amount)
    })
    if (matches.length !== 1) return `⚠️ I found ${matches.length} matching payroll rows. I did not remove anything.`
    const row = matches[0]
    await db.collection("opsPayroll").deleteOne({ _id: row._id })
    done = `🗑️ Payroll row removed: ${row.member} ${money(row.amount)}`
  }

  if (action.actionType === "delete_sheet") {
    const projects = await db.collection("opsProjects").find({}).toArray()
    const project = payload.projectName ? projects.find((item: any) => sameName(item.name, payload.projectName) || includesText(item.name, payload.projectName)) : null
    const kind = normalizeSheetKind(payload.sheetType || payload.title)
    const sheets = await db.collection("opsSheets").find({}).toArray()
    const matches = payload._sheetId
      ? sheets.filter((item: any) => String(item._id) === String(payload._sheetId))
      : sheets.filter((item: any) => {
          const projectOk = project ? String(item.projectId || "") === String(project._id) || sameName(item.projectName, project.name) : true
          const kindOk = payload.sheetType ? normalizeSheetKind(item.sheetType || item.title) === kind : true
          const titleOk = payload.title ? includesText(item.title, payload.title) : true
          return projectOk && kindOk && titleOk
        })
    if (matches.length !== 1) return `⚠️ I found ${matches.length} matching data files. I did not remove anything.`
    const sheet = matches[0]
    await db.collection("opsSheets").deleteOne({ _id: sheet._id })
    done = `🗑️ Data file removed: ${sheet.title || sheet.sheetType}`
  }

  if (action.actionType === "delete_sheet_row") {
    const projects = await db.collection("opsProjects").find({}).toArray()
    const project = projects.find((item: any) => sameName(item.name, payload.projectName) || includesText(item.name, payload.projectName))
    if (!project) return "⚠️ I could not find that project. I did not remove anything."
    const kind = normalizeSheetKind(payload.sheetType)
    const sheets = await db.collection("opsSheets").find({ projectId: String(project._id) }).toArray()
    const sheet = sheets.find((item: any) => normalizeSheetKind(item.sheetType || item.title) === kind)
    if (!sheet) return "⚠️ I could not find that data file. I did not remove anything."
    const values = valuesForKind(kind, sheet.values || [])
    const headers = values[0] || getSheetSchema(kind).headers
    const match = payload.match && typeof payload.match === "object" ? payload.match : {}
    const rows = values.slice(1)
    const matches = rows
      .map((row: string[], index: number) => ({ row, index }))
      .filter(({ row }: { row: string[] }) => {
        const rowObject = Object.fromEntries(headers.map((header, index) => [header.toLowerCase(), String(row[index] || "").toLowerCase()]))
        return Object.entries(match).every(([key, value]) => {
          const wanted = String(value || "").trim().toLowerCase()
          if (!wanted) return true
          return String(rowObject[key.toLowerCase()] || "").includes(wanted)
        })
      })
    if (matches.length !== 1) return `⚠️ I found ${matches.length} matching data rows. I did not remove anything.`
    const removeIndex = matches[0].index
    await db.collection("opsSheets").updateOne({ _id: sheet._id }, { $set: { values: [headers, ...rows.filter((_: string[], index: number) => index !== removeIndex)], updatedAt: now } })
    done = `🗑️ ${getSheetSchema(kind).title} row removed from ${project.name}`
  }

  if (!done) return "⚠️ I could not execute that action."
  await db.collection("opsAiActions").updateOne({ _id: actionId }, { $set: { status: "confirmed", executedAt: now, updatedAt: now } })
  return formatBotText(done, { allowEmoji: true })
}

export async function answerOpsBot(textInput: string, telegramId?: number | null, options: OpsAiOptions = {}) {
  const text = String(textInput || "").trim()
  const db = await getDb()

  let answer = "🤖 I can answer revenue, profit, launches, active projects, payroll, reminders, notes, docs, and data questions."
  const [projects, sheets] = await Promise.all([
    db.collection("opsProjects").find({}).toArray(),
    db.collection("opsSheets").find({}).toArray(),
  ])
  const scoped = scopeOpsQuestion(text, projects, sheets)
  const scopedFinancials = calculateSheetFinancials(scoped.sheets)
  const allFinancials = calculateSheetFinancials(sheets)
  const scopeSuffix = scoped.hasScope ? ` for ${scoped.label}` : " across tracked projects"

  if (wantsAi(text)) {
    const aiText = cleanAiQuestion(text)
    const aiScoped = scopeOpsQuestion(aiText, projects, sheets)
    answer = await answerWithAi(aiText, {
      projects: aiScoped.projects,
      sheets: aiScoped.sheets,
      financials: calculateSheetFinancials(aiScoped.sheets),
      scopeLabel: aiScoped.hasScope ? aiScoped.label : "tracked projects",
      hasScope: aiScoped.hasScope,
      conversation: options.conversation,
    }).catch(aiUnavailable)
  } else if (wantsProjectPerformance(text)) {
    answer = formatProjectPerformance(scoped.projects, scoped.sheets, text)
  } else if (includes(text, ["made today", "revenue today"])) {
    const revenue = scopedFinancials.incomeToday || scoped.projects.reduce((sum: number, p: any) => sum + Number(p.revenueToday || 0), 0)
    answer = duplicateNamedScope(scoped.projects)
      ? `💵 I found ${scoped.projects.length} matching projects named ${scoped.label}.\n\n${projectFinancialLines(scoped.projects, scoped.sheets, (financials, project) => financials.incomeToday || Number(project.revenueToday || 0)).join("\n")}\n\n🆕 Ask for newest or 🕰️ oldest if you want one exact project.`
      : `💵 Today revenue${scopeSuffix} is ${money(revenue)}.`
  } else if (includes(text, ["profit today", "today profit"])) {
    answer = duplicateNamedScope(scoped.projects)
      ? `📈 I found ${scoped.projects.length} matching projects named ${scoped.label}.\n\n${projectFinancialLines(scoped.projects, scoped.sheets, (financials) => financials.profitToday).join("\n")}\n\n🆕 Ask for newest or 🕰️ oldest if you want one exact project.`
      : `📈 Today profit${scopeSuffix} is ${money(scopedFinancials.profitToday)}.\n\n💚 Income: ${money(scopedFinancials.incomeToday)}\n🔴 Expense: ${money(scopedFinancials.expenseToday)}\n💸 Payroll: ${money(scopedFinancials.payrollToday)}`
  } else if (includes(text, ["profit this week", "profit week"])) {
    const legacyProfit = scoped.projects.reduce((sum: number, p: any) => sum + Number(p.profitThisWeek || 0), 0)
    const profit = scopedFinancials.profitThisWeek || legacyProfit
    answer = duplicateNamedScope(scoped.projects)
      ? `📊 I found ${scoped.projects.length} matching projects named ${scoped.label}.\n\n${projectFinancialLines(scoped.projects, scoped.sheets, (financials, project) => financials.profitThisWeek || Number(project.profitThisWeek || 0)).join("\n")}\n\n🆕 Ask for newest or 🕰️ oldest if you want one exact project.`
      : `📊 This week profit${scopeSuffix} is ${money(profit)}.`
  } else if (includes(text, ["profit this month", "monthly profit", "profit month"])) {
    answer = duplicateNamedScope(scoped.projects)
      ? `🗓️ I found ${scoped.projects.length} matching projects named ${scoped.label}.\n\n${projectFinancialLines(scoped.projects, scoped.sheets, (financials) => financials.profitThisMonth).join("\n")}\n\n🆕 Ask for newest or 🕰️ oldest if you want one exact project.`
      : `🗓️ This month profit${scopeSuffix} is ${money(scopedFinancials.profitThisMonth)}.\n\n💚 Income: ${money(scopedFinancials.incomeThisMonth)}\n🔴 Expense: ${money(scopedFinancials.expenseThisMonth)}\n💸 Payroll: ${money(scopedFinancials.payrollThisMonth)}`
  } else if (includes(text, ["active projects", "active project", "what is active", "which projects active"])) {
    answer = formatOpsActiveProjects(scoped.projects, scoped.sheets)
  } else if (scoped.hasScope && includes(text, ["project", "details", "status", "service", "referrer", "wallet", "start date", "end date", "profit loss", "p/l"])) {
    answer = scoped.projects.length
      ? scoped.projects.slice(0, 4).map((project: any) => formatOpsProjectDetails(project, scoped.sheets)).join("\n\n")
      : "No matching project found."
  } else if (includes(text, ["launching tomorrow", "launches tomorrow", "launches this week", "next launches"])) {
    const now = new Date()
    const inSeven = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const launches = scoped.projects.filter((p: any) => p.launchDate && new Date(p.launchDate) <= inSeven && new Date(p.launchDate) >= now)
    answer = launches.length ? `📅 Next launches:\n\n${launches.map((p: any) => `• ${p.name}: ${new Date(p.launchDate).toLocaleString()}`).join("\n")}` : "📅 No launches are scheduled in the next 7 days."
  } else if (includes(text, ["payroll", "who should be paid"])) {
    const payroll = await db.collection("opsPayroll").find({ status: { $ne: "paid" } }).sort({ createdAt: -1 }).limit(8).toArray()
    const scopedPayroll = scoped.hasScope ? payroll.filter((row: any) => scoped.projects.some((project: any) => sameName(project.name, row.project) || includesText(row.project, project.name))) : payroll
    answer = scopedPayroll.length ? `💸 Pending payroll${scopeSuffix}:\n\n${scopedPayroll.map((row: any) => `• ${row.member}: ${money(row.amount)} ${row.project ? `- ${row.project}` : ""} (${row.status || "pending"})`).join("\n")}` : "💸 No pending payroll rows."
  } else if (includes(text, ["reminders", "next reminders", "scheduled reminders"])) {
    const reminders = await db.collection("opsReminders").find({ status: { $ne: "done" } }).sort({ dueAt: 1 }).limit(8).toArray()
    answer = reminders.length ? `🔔 Upcoming reminders:\n\n${reminders.map((row: any) => `• ${row.title || row.message}${row.dueAt ? ` - ${formatTeamDateTime(row.dueAt, String(row.timeZone || TEAM_TIME_ZONE))}` : ""}`).join("\n")}` : "🔔 No upcoming reminders."
  } else if (text.startsWith("/activate ") || text.startsWith("/deactivate ")) {
    const active = text.startsWith("/activate ")
    const name = text.replace(active ? "/activate " : "/deactivate ", "").trim()
    await db.collection("opsProjects").updateOne(
      { name },
      { $set: { name, status: active ? "active" : "inactive", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    )
    answer = `✅ ${name} is now ${active ? "active" : "inactive"}.`
  } else if (text.startsWith("/log ")) {
    const match = text.match(/^\/log\s+(\S+)\s+(\S+)\s+(\d+)$/i)
    if (!match) {
      answer = "Use: /log <project id> <trading|dev> <integer amount>"
    } else {
      const [, projectId, rawType, rawAmount] = match
      const type = rawType.toLowerCase()
      const isTrading = ["trading", "trade", "trading_income"].includes(type)
      const isDev = ["dev", "allocation", "dev_allocation"].includes(type)
      const amount = Number(rawAmount)
      const project = await db.collection("opsProjects").findOne({ _id: projectId })
      if (!project) {
        answer = "Project ID was not found."
      } else if ((!isTrading && !isDev) || !Number.isInteger(amount) || amount <= 0) {
        answer = "Income type must be trading or dev, and amount must be a whole number above 0."
      } else {
        const date = estDateKey()
        const existing = await db.collection("dailyPayrollEntries").findOne({ date })
        const inputs = existing?.inputs || {}
        const clientIncome = Array.isArray(inputs.clientIncome) ? [...inputs.clientIncome] : []
        const devAllocations = Array.isArray(inputs.devAllocations) ? [...inputs.devAllocations] : []
        if (isTrading) clientIncome.push({ projectId, incomeType: "trading", income: amount })
        else devAllocations.push({ projectId, income: amount })
        await savePayrollDay({
          date,
          notes: existing?.notes || "",
          teamPayroll: Array.isArray(inputs.teamPayroll) ? inputs.teamPayroll : [],
          clientIncome,
          devAllocations,
          rules: inputs.rules || {},
        })
        answer = `✅ Logged ${money(amount)} ${isTrading ? "trading income" : "dev allocation"} for ${project.name}.`
      }
    }
  } else if (text.startsWith("/setreminder ")) {
    const message = text.replace("/setreminder ", "").trim()
    await db.collection("opsReminders").insertOne({
      title: message.slice(0, 80),
      message,
      dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      recurrence: "once",
      audience: "team",
      status: "scheduled",
      createdFrom: "bot",
      telegramId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    answer = "🔔 Reminder created for one hour from now."
  } else if (text) {
    const docs = await db.collection("opsDocs").find({}).toArray()
    const lower = text.toLowerCase()
    const match = docs.find((doc: any) => `${doc.title} ${doc.category} ${doc.body}`.toLowerCase().includes(lower))
    if (match) answer = `${match.title}\n\n${String(match.body || "").slice(0, 600)}`
    else answer = await answerWithAi(text, {
      projects: scoped.projects,
      sheets: scoped.sheets,
      financials: scoped.hasScope ? scopedFinancials : allFinancials,
      scopeLabel: scoped.hasScope ? scoped.label : "tracked projects",
      hasScope: scoped.hasScope,
      conversation: options.conversation,
    }).catch(aiUnavailable)
  }

  await logBotExchange({ text, answer, telegramId, chatId: options.chatId })
  return formatBotText(answer, { allowEmoji: true })
}

export async function answerOpsAi(textInput: string, telegramId?: number | null, options: OpsAiOptions = {}) {
  const text = String(textInput || "").trim()
  const db = await getDb()
  const [projects, sheets] = await Promise.all([
    db.collection("opsProjects").find({}).toArray(),
    db.collection("opsSheets").find({}).toArray(),
  ])
  const scoped = scopeOpsQuestion(text, projects, sheets)
  const financials = calculateSheetFinancials(scoped.sheets)
  if (wantsProjectPerformance(text)) {
    const answer = formatProjectPerformance(scoped.projects, scoped.sheets, text)
    await logBotExchange({ text: `/ai ${text}`, answer, telegramId, chatId: options.chatId })
    return formatBotText(answer, { allowEmoji: true })
  }
  const answer = await answerWithAi(text, {
    projects: scoped.projects,
    sheets: scoped.sheets,
    financials,
    scopeLabel: scoped.hasScope ? scoped.label : "tracked projects",
    hasScope: scoped.hasScope,
    conversation: options.conversation,
  }).catch(aiUnavailable)
  await logBotExchange({ text: `/ai ${text}`, answer, telegramId, chatId: options.chatId })
  return formatAiText(answer)
}

async function answerWithAi(
  text: string,
  context: {
    projects: any[]
    sheets: any[]
    financials: ReturnType<typeof calculateSheetFinancials>
    scopeLabel?: string
    hasScope?: boolean
    conversation?: OpsConversationContext
  },
) {
  const sourceDocs = await getOpsSourceDocs()
  const compactSheets = context.sheets.slice(0, 12).map((sheet: any) => ({
    title: cleanSheetTitle(sheet),
    projectName: sheet.projectName,
    category: sheet.category,
    sheetType: sheet.sheetType || inferSheetKind(sheet),
    description: sheet.description,
    preview: Array.isArray(sheet.values) ? sheet.values.slice(0, 4) : [],
  }))

  const systemPrompt = [
    "You are Ghost Team System's operations assistant inside Telegram.",
    "Answer questions using the provided project data, financial summaries, sheet previews, and source documents.",
    "The Sumo source documents are authoritative for conduct, communication, market-making procedure, client language, and internal process. Answer those from sourceDocuments.",
    "Do not contradict sourceDocuments. If they do not contain a detail, say the source docs do not specify it.",
    "If the question is unrelated to team ops or data (e.g. general trivia), say briefly that you only help with Ghost Team data and operations.",
    "If the user wants to create, update, or delete app data, say they can ask you to do it and the bot will offer Confirm/Refuse.",
    "Confirm/Refuse is only for database mutations with an action preview — never for follow-up questions, drafting client copy, clarifying your prior answer, or continuing a conversation.",
    "When conversation history or a reply to your prior message is provided, treat short follow-ups like 'yeah go ahead', 'yes please', or 'rewrite that' as acceptance of your prior offer. Complete that follow-up directly.",
    "The provided context is already scoped to the user's mentioned project or file when they mention one.",
    "Never include projects, files, or totals outside the provided context.",
    "If multiple provided projects share the requested name, show each matching project separately with its project name and ask the user to choose newest or oldest if they need an exact target.",
    "Keep answers short and direct. Usually 4-8 lines. Use blank lines between groups.",
    "Use 1 to 3 relevant emojis naturally when they help the message pop. Do not use an emoji on every line.",
    "Bold only important numbers, values, percentages, dates, and statuses using Telegram HTML: <b>value</b>.",
    "Do not use Markdown bold, asterisks, tables, or headings.",
    "Only use these HTML tags when needed: <b>, </b>, <u>, </u>.",
    "Use <u> only for a very short title word, never for long sentences.",
    "Use plain text bullet lines with • only for lists.",
    "Do not end with generic phrases like let me know.",
    "Style examples. Follow the layout, spacing, and restraint. Do not copy fake values:",
    "<u>SOLANA</u> Project Update\n\n📌 Status: <b>Active</b>\nService: <b>TGE + MM</b>\n\n💰 P/L: <b>$12.4K</b>\nStart: <b>Jun 1</b>\nEnd: <b>Jun 18</b>",
    "<u>PROJECTS</u> Performance\n\n📈 Profit: <b>$8.7K</b>\nIncome: <b>$14.8K</b>\nCost: <b>$6.1K</b>\n\nTop: Solana <b>$3.2K</b>",
    "<u>INCOME</u> Rows\n\n• Casper: <b>$500</b> paid\n\n• Virl: <b>$2.1K</b> pending",
    "<u>PAYROLL</u> Snapshot\n\n💸 Pending: <b>$950</b>\nPaid rows: <b>12</b>\n\nNext: LOTUS <b>$150</b>",
    "<u>ACTION</u> Preview\n\nAdd income row to <b>Solana</b>\nAmount: <b>$500</b>\nStatus: <b>paid</b>\n\nConfirm before changing data.",
  ].join("\n")
  const userContent = JSON.stringify({
    question: text,
    scope: {
      label: context.scopeLabel || "tracked projects",
      scoped: Boolean(context.hasScope),
    },
    financials: context.financials,
    projects: context.projects.slice(0, 12).map((project: any) => ({
      name: project.name,
      status: project.status,
      owner: project.owner,
      referrer: project.referrer || project.referrerName || project.referral || project.referredBy,
      referrerWallet: project.referrerWallet || project.referralWallet || project.wallet || project.walletAddress,
      service: project.service || project.serviceType || project.projectService,
      startDate: project.startDate || project.launchDate,
      endDate: project.endDate,
      currentProfitLoss: project.currentProfitLoss ?? project.profitThisWeek,
      launchDate: project.launchDate,
      notes: project.notes,
      tags: project.tags,
    })),
    sheets: compactSheets,
    sourceDocuments: sourceDocs.map((doc) => ({
      title: doc.title,
      filename: doc.filename,
      body: doc.body,
    })),
  })

  const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const turn of context.conversation?.recentTurns || []) {
    historyMessages.push({ role: "user", content: turn.user.slice(0, 1200) })
    historyMessages.push({ role: "assistant", content: turn.assistant.slice(0, 1800) })
  }

  if (context.conversation?.replyToBotText) {
    const replyText = context.conversation.replyToBotText.slice(0, 1800)
    const alreadyIncluded = historyMessages.some((entry) => entry.role === "assistant" && entry.content === replyText)
    if (!alreadyIncluded) {
      historyMessages.push({ role: "assistant", content: replyText })
    }
  }

  return formatAiText(await aiChat([
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userContent },
  ], isFollowUpMessage(text) ? 0.35 : 0.2))
}
