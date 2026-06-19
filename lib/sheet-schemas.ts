import { defaultSheetValues, normalizeSheetValues, type SheetValues } from "@/lib/sheet-files"

export type SheetKind = "income" | "expense" | "payroll" | "notes" | "custom"

export type SheetSchema = {
  kind: SheetKind
  title: string
  tabName: string
  category: string
  headers: string[]
}

export const SHEET_KIND_ORDER: SheetKind[] = ["income", "expense", "payroll", "notes", "custom"]

export const SHEET_SCHEMAS: Record<SheetKind, SheetSchema> = {
  income: {
    kind: "income",
    title: "Income",
    tabName: "Income",
    category: "Finance",
    headers: ["Date", "Source", "Amount", "Currency", "Status", "Notes"],
  },
  expense: {
    kind: "expense",
    title: "Expense",
    tabName: "Expense",
    category: "Finance",
    headers: ["Date", "Vendor", "Amount", "Currency", "Status", "Notes"],
  },
  payroll: {
    kind: "payroll",
    title: "Payroll",
    tabName: "Payroll",
    category: "Team",
    headers: ["Date", "Member", "Amount", "Currency", "Status", "Notes"],
  },
  notes: {
    kind: "notes",
    title: "Notes",
    tabName: "Notes",
    category: "Knowledge",
    headers: ["Date", "Topic", "Detail", "Owner", "Status", "Notes"],
  },
  custom: {
    kind: "custom",
    title: "Custom",
    tabName: "Custom",
    category: "Custom",
    headers: ["Date", "Name", "Value", "Status", "Owner", "Notes"],
  },
}

function toKey(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function normalizeSheetKind(input: unknown): SheetKind {
  const value = toKey(input)
  if (["income", "revenue", "sales", "earning", "earnings"].includes(value)) return "income"
  if (["expense", "expenses", "cost", "costs", "spend", "spending"].includes(value)) return "expense"
  if (["payroll", "salary", "salaries", "payout", "payouts"].includes(value)) return "payroll"
  if (["note", "notes", "knowledge", "docs"].includes(value)) return "notes"
  return "custom"
}

export function getSheetSchema(kind: unknown): SheetSchema {
  return SHEET_SCHEMAS[normalizeSheetKind(kind)]
}

export function defaultValuesForKind(kind: unknown, rows = 0): SheetValues {
  const schema = getSheetSchema(kind)
  return rows > 0 ? [schema.headers, ...defaultSheetValues(rows, schema.headers.length)] : [schema.headers]
}

export function valuesForKind(kind: unknown, values: unknown): SheetValues {
  const schema = getSheetSchema(kind)
  const normalized = normalizeSheetValues(values).filter((row) => row.some((cell) => String(cell || "").trim()))
  if (!normalized.length) return defaultValuesForKind(schema.kind)

  const firstRow = normalized[0].map((cell) => toKey(cell))
  const expected = schema.headers.map((cell) => toKey(cell))
  const hasExpectedHeaders = expected.every((header) => firstRow.includes(header))
  return hasExpectedHeaders ? normalized : [schema.headers, ...normalized]
}
