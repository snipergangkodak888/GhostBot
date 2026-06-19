import { getDb } from "@/lib/db"
import { normalizeSheetValues, type SheetValues } from "@/lib/sheet-files"
import { getSheetSchema, normalizeSheetKind, SHEET_KIND_ORDER, type SheetKind } from "@/lib/sheet-schemas"

export const DEFAULT_PROJECT_SHEETS: Array<{
  kind: SheetKind
  title: string
  tabName: string
  category: string
  values: SheetValues
}> = SHEET_KIND_ORDER.filter((kind) => kind !== "custom").map((kind) => {
  const schema = getSheetSchema(kind)
  return {
    kind,
    title: schema.title,
    tabName: schema.tabName,
    category: schema.category,
    values: [schema.headers],
  }
})

function toKey(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function inferSheetKind(sheet: any): SheetKind {
  const direct = normalizeSheetKind(sheet?.sheetType || sheet?.type || sheet?.tag)
  if (direct !== "custom") return direct
  const haystack = `${sheet?.title || ""} ${sheet?.tabName || ""} ${sheet?.category || ""}`.toLowerCase()
  if (/(income|revenue|sales|earning)/.test(haystack)) return "income"
  if (/(expense|cost|spend)/.test(haystack)) return "expense"
  if (/(payroll|salary|payout)/.test(haystack)) return "payroll"
  if (/(note|knowledge|doc)/.test(haystack)) return "notes"
  return "custom"
}

function headerIndex(headers: string[], names: string[]) {
  const clean = headers.map((header) => toKey(header))
  for (const name of names) {
    const index = clean.findIndex((header) => header === name || header.includes(name))
    if (index >= 0) return index
  }
  return -1
}

function amountFrom(value: unknown) {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "")
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : 0
}

function rowDate(value: unknown) {
  const date = new Date(String(value || ""))
  return Number.isNaN(date.getTime()) ? null : date
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  const day = next.getDay()
  const diff = day === 0 ? 6 : day - 1
  next.setDate(next.getDate() - diff)
  return next
}

function inMonth(date: Date, now: Date) {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

export function calculateSheetFinancials(sheets: any[], now = new Date()) {
  const totals = {
    incomeToday: 0,
    expenseToday: 0,
    payrollToday: 0,
    profitToday: 0,
    incomeThisWeek: 0,
    expenseThisWeek: 0,
    payrollThisWeek: 0,
    profitThisWeek: 0,
    incomeThisMonth: 0,
    expenseThisMonth: 0,
    payrollThisMonth: 0,
    profitThisMonth: 0,
  }
  const weekStart = startOfWeek(now)

  for (const sheet of sheets) {
    const kind = inferSheetKind(sheet)
    if (!["income", "expense", "payroll"].includes(kind)) continue

    const values = normalizeSheetValues(sheet.values)
    if (values.length < 2) continue
    const headers = values[0]
    const amountIndex = headerIndex(headers, ["amount", "total", "value", "revenue", "income", "cost", "expense", "pay"])
    if (amountIndex < 0) continue
    const dateIndex = headerIndex(headers, ["date", "day"])

    for (const row of values.slice(1)) {
      if (!row.some((cell) => String(cell || "").trim())) continue
      const amount = amountFrom(row[amountIndex])
      if (!amount) continue
      const date = dateIndex >= 0 ? rowDate(row[dateIndex]) : now
      if (!date) continue
      const bucket = kind === "income" ? "income" : kind === "payroll" ? "payroll" : "expense"
      const signed = Math.abs(amount)

      if (sameDay(date, now)) totals[`${bucket}Today` as keyof typeof totals] += signed
      if (date >= weekStart && date <= now) totals[`${bucket}ThisWeek` as keyof typeof totals] += signed
      if (inMonth(date, now)) totals[`${bucket}ThisMonth` as keyof typeof totals] += signed
    }
  }

  totals.profitToday = totals.incomeToday - totals.expenseToday - totals.payrollToday
  totals.profitThisWeek = totals.incomeThisWeek - totals.expenseThisWeek - totals.payrollThisWeek
  totals.profitThisMonth = totals.incomeThisMonth - totals.expenseThisMonth - totals.payrollThisMonth
  return totals
}

export async function createDefaultSheetsForProject(projectId: string, projectName: string) {
  const db = await getDb()
  const now = new Date()
  const records = DEFAULT_PROJECT_SHEETS.map((sheet) => ({
    title: sheet.title,
    tabName: sheet.tabName,
    category: sheet.category,
    sheetType: sheet.kind,
    description: `Default ${sheet.title.toLowerCase()} sheet for ${projectName}.`,
    projectId,
    projectName,
    values: sheet.values,
    sourceType: "default",
    createdAt: now,
    updatedAt: now,
  }))
  await db.collection("opsSheets").insertMany(records)
  return records
}

export async function ensureDefaultSheetsForProjects(projects: any[]) {
  if (!projects.length) return
  const db = await getDb()
  const sheets = await db.collection("opsSheets").find({}).toArray()
  const existingProjectIds = new Set(sheets.map((sheet: any) => String(sheet.projectId || "")).filter(Boolean))

  for (const project of projects) {
    const id = String(project._id || "")
    if (!id || existingProjectIds.has(id)) continue
    await createDefaultSheetsForProject(id, String(project.name || "Project"))
  }
}
