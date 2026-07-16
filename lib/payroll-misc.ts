export const MISC_INCOME_CATEGORIES = [
  { id: "dev_allocation", label: "Dev allocation", projectRequired: true },
  { id: "private_liqs", label: "Private liquidations", projectRequired: false },
  { id: "fee_rebate", label: "Rebate", projectRequired: false },
  { id: "other", label: "Other", projectRequired: false },
] as const

export type MiscIncomeCategory = (typeof MISC_INCOME_CATEGORIES)[number]["id"]

export function miscIncomeCategoryLabel(category: MiscIncomeCategory | string | undefined) {
  return MISC_INCOME_CATEGORIES.find((item) => item.id === category)?.label || "Misc income"
}

export function normalizeMiscIncomeCategory(value: unknown): MiscIncomeCategory {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (raw === "dev" || raw === "dev_alloc" || raw === "allocation") return "dev_allocation"
  if (raw === "priv_liqs" || raw === "privateliqs" || raw === "private_liquidation") return "private_liqs"
  if (raw === "rebate" || raw === "fee_rebates") return "fee_rebate"
  const match = MISC_INCOME_CATEGORIES.find((item) => item.id === raw)
  return match?.id || "dev_allocation"
}

export function miscIncomeProjectRequired(category: MiscIncomeCategory | string) {
  return category === "dev_allocation"
}

export function miscIncomeProjectDisabled(category: MiscIncomeCategory | string) {
  return category === "fee_rebate" || category === "private_liqs"
}

export function miscIncomeCategoryIsSingleton(category: MiscIncomeCategory | string) {
  return category === "fee_rebate" || category === "private_liqs"
}

export function normalizeDevAllocationRow(row: {
  accountId?: string
  projectId?: string
  income?: number
  category?: string
}) {
  const category = normalizeMiscIncomeCategory(row.category)
  let projectId = String(row.projectId || "").trim() || undefined
  if (miscIncomeProjectDisabled(category)) projectId = undefined
  return {
    accountId: row.accountId ? String(row.accountId) : undefined,
    projectId,
    category,
    income: Number(row.income || 0),
  }
}

export function normalizeDevAllocations(rows: unknown) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => normalizeDevAllocationRow(row as any))
}

export function validateDevAllocations(rows: unknown) {
  const errors: string[] = []
  const categoryCounts = new Map<MiscIncomeCategory, number>()
  const normalizedRows = normalizeDevAllocations(rows)
  normalizedRows.forEach((row, index) => {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1)
    if (!Number.isFinite(row.income) || row.income < 0) {
      errors.push(`Misc income row ${index + 1}: amount must be zero or greater`)
    }
    if (miscIncomeProjectRequired(row.category) && !row.projectId) {
      errors.push(`Misc income row ${index + 1}: ${miscIncomeCategoryLabel(row.category)} requires a project`)
    }
  })
  for (const category of ["fee_rebate", "private_liqs"] as const) {
    if ((categoryCounts.get(category) || 0) > 1) {
      errors.push(`Only one ${miscIncomeCategoryLabel(category).toLowerCase()} row is allowed per day`)
    }
  }
  return errors
}

export function parseMiscLogCategory(rawType: string): MiscIncomeCategory | null {
  const type = rawType.toLowerCase().replace(/[\s-]+/g, "_")
  if (["trading", "trading_income", "trade"].includes(type)) return null
  if (["dev", "dev_allocation", "allocation", "misc", "misc_income"].includes(type)) return "dev_allocation"
  const normalized = normalizeMiscIncomeCategory(type)
  if (MISC_INCOME_CATEGORIES.some((item) => item.id === normalized)) return normalized
  return null
}

export function parseIncomeLogCommand(text: string) {
  const match = text.match(/^\/log(?:@\w+)?\s+(\S+)\s+(\S+)\s+(-?\d+)$/i)
  if (!match) {
    return { error: "Use: /log <project-id|- > <trading|dev|fee_rebate|private_liqs|other> <amount>" }
  }
  const [, projectToken, rawType, rawAmount] = match
  const amount = Number(rawAmount)
  if (!Number.isInteger(amount) || amount <= 0) {
    return { error: "Amount must be a whole number above 0." }
  }
  const isTrading = ["trading", "trading_income", "trade"].includes(rawType.toLowerCase())
  const miscCategory = parseMiscLogCategory(rawType)
  if (!isTrading && !miscCategory) {
    return { error: "Income type must be trading, dev, fee_rebate, private_liqs, or other." }
  }
  const projectId = projectToken === "-" || projectToken.toLowerCase() === "none" ? null : projectToken
  if (isTrading && !projectId) {
    return { error: "Trading income requires a project id." }
  }
  if (miscCategory === "dev_allocation" && !projectId) {
    return { error: "Dev allocation requires a project id." }
  }
  return { projectId, isTrading, miscCategory: miscCategory || undefined, amount }
}
