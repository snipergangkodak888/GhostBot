import { TEAM_TIME_ZONE } from "@/lib/team-timezone"

export type LedgerPeriodTotals = {
  hasEntries: boolean
  dayCount: number
  from: string
  to: string
  tradingIncome: number
  miscIncome: number
  teamPayroll: number
  referrals: number
  netTradingProfit: number
  totalProfitPool: number
  totalExpense: number
}

export type ParsedFinancialPeriod = {
  label: string
  from: string
  to: string
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function entryDate(entry: any) {
  return String(entry?.date || "").slice(0, 10)
}

function entryCalc(entry: any) {
  return entry?.calculation || {}
}

/** ET calendar date key (YYYY-MM-DD). */
export function teamEstDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

export function shiftEstDateKey(days: number, base = teamEstDateKey()) {
  const [year, month, day] = base.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

export function monthStartKey(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`
}

export function monthEndKey(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
}

export function weekStartKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const mondayOffset = (date.getUTCDay() + 6) % 7
  return shiftEstDateKey(-mondayOffset, dateKey)
}

function monthIndexFromText(text: string) {
  const lower = text.toLowerCase()
  for (let index = 0; index < MONTH_NAMES.length; index += 1) {
    const name = MONTH_NAMES[index]
    if (new RegExp(`\\b${name}\\b`).test(lower) || new RegExp(`\\b${name.slice(0, 3)}\\b`).test(lower)) {
      return index + 1
    }
  }
  return 0
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
}

function resolveMonthPeriod(month: number, todayKey: string): ParsedFinancialPeriod {
  const [year, currentMonth] = todayKey.split("-").map(Number)
  let targetYear = year
  if (month > currentMonth) targetYear -= 1
  const from = `${targetYear}-${String(month).padStart(2, "0")}-01`
  const endOfMonth = monthEndKey(targetYear, month)
  const to = endOfMonth < todayKey ? endOfMonth : todayKey
  return {
    label: monthLabel(targetYear, month),
    from,
    to,
  }
}

/** Parse common natural-language financial periods (ET). Returns null if no period detected. */
export function parseFinancialPeriod(text: string, todayKey = teamEstDateKey()): ParsedFinancialPeriod | null {
  const lower = text.toLowerCase()

  if (/\byesterday\b/.test(lower)) {
    const date = shiftEstDateKey(-1, todayKey)
    return { label: "Yesterday", from: date, to: date }
  }
  if (/\btoday\b/.test(lower)) {
    return { label: "Today", from: todayKey, to: todayKey }
  }
  if (/\b(this week|week to date|wtd)\b/.test(lower)) {
    return { label: "This week", from: weekStartKey(todayKey), to: todayKey }
  }
  if (/\b(last week|previous week)\b/.test(lower)) {
    const lastWeekEnd = shiftEstDateKey(-1, weekStartKey(todayKey))
    const lastWeekStart = shiftEstDateKey(-6, lastWeekEnd)
    return { label: "Last week", from: lastWeekStart, to: lastWeekEnd }
  }
  if (/\b(this month|month to date|mtd)\b/.test(lower) || /\bmonth of\b/.test(lower)) {
    const namedMonth = monthIndexFromText(lower)
    if (namedMonth) return resolveMonthPeriod(namedMonth, todayKey)
    return { label: "This month", from: monthStartKey(todayKey), to: todayKey }
  }
  if (/\blast month\b/.test(lower)) {
    const [year, month] = todayKey.split("-").map(Number)
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const from = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`
    const to = monthEndKey(prevYear, prevMonth)
    return { label: monthLabel(prevYear, prevMonth), from, to }
  }

  const namedMonth = monthIndexFromText(lower)
  if (namedMonth && /\b(month|profit|income|revenue|made|make|earn)\b/.test(lower)) {
    return resolveMonthPeriod(namedMonth, todayKey)
  }

  return null
}

export function wantsLedgerFinancialQuestion(text: string) {
  const lower = text.toLowerCase()
  const hasMoney = /\b(profit|revenue|income|made|make|earn|earned|money|p\/l|p&l)\b/.test(lower)
  const hasPeriod = Boolean(parseFinancialPeriod(text)) ||
    /\b(today|yesterday|this week|this month|last week|last month|month of)\b/.test(lower) ||
    MONTH_NAMES.some((name) => new RegExp(`\\b${name.slice(0, 3)}`).test(lower))
  return hasMoney && hasPeriod
}

export function aggregateLedgerPeriod(entries: any[], from: string, to: string): LedgerPeriodTotals {
  const rows = entries.filter((entry) => {
    const date = entryDate(entry)
    return date >= from && date <= to
  })

  let tradingIncome = 0
  let miscIncome = 0
  let teamPayroll = 0
  let referrals = 0
  let netTradingProfit = 0

  for (const entry of rows) {
    const calc = entryCalc(entry)
    tradingIncome += Number(calc.totalDailyIncome ?? entry.totalIncome ?? 0)
    miscIncome += Number(calc.totalDevAllo ?? entry.totalDevAllo ?? 0)
    teamPayroll += Number(calc.totalTeamPayroll ?? entry.totalTeamPayroll ?? 0)
    referrals += Number(calc.totalReferrals ?? entry.totalReferrals ?? 0)
    netTradingProfit += Number(calc.netProfit ?? entry.netProfit ?? 0)
  }

  tradingIncome = roundMoney(tradingIncome)
  miscIncome = roundMoney(miscIncome)
  teamPayroll = roundMoney(teamPayroll)
  referrals = roundMoney(referrals)
  netTradingProfit = roundMoney(netTradingProfit)

  return {
    hasEntries: rows.length > 0,
    dayCount: rows.length,
    from,
    to,
    tradingIncome,
    miscIncome,
    teamPayroll,
    referrals,
    netTradingProfit,
    totalProfitPool: roundMoney(netTradingProfit + miscIncome),
    totalExpense: roundMoney(teamPayroll + referrals),
  }
}

/** @deprecated alias — use aggregateLedgerPeriod */
export function payrollFinancials(entries: any[], from: string, to: string) {
  const totals = aggregateLedgerPeriod(entries, from, to)
  return {
    hasEntries: totals.hasEntries,
    income: totals.tradingIncome,
    expense: totals.totalExpense,
    payroll: totals.teamPayroll,
    profit: totals.netTradingProfit,
    miscIncome: totals.miscIncome,
    referrals: totals.referrals,
    totalProfitPool: totals.totalProfitPool,
    dayCount: totals.dayCount,
  }
}

export function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString()}`
}

export function formatLedgerPeriodSummary(totals: LedgerPeriodTotals, label: string) {
  if (!totals.hasEntries) {
    return [
      `📈 ${label} (${totals.from}${totals.from !== totals.to ? ` → ${totals.to}` : ""})`,
      "",
      "No payroll days saved for this period yet.",
      "",
      "Log daily income in Payroll to build totals.",
    ].join("\n")
  }

  const range = totals.from === totals.to ? totals.from : `${totals.from} → ${totals.to}`
  const dayLabel = totals.dayCount === 1 ? "1 payroll day" : `${totals.dayCount} payroll days`

  return [
    `📈 ${label} profit (${range})`,
    `${dayLabel} saved`,
    "",
    `💚 Trading income: ${formatMoney(totals.tradingIncome)}`,
    `🔵 Misc income: ${formatMoney(totals.miscIncome)}`,
    `🔴 Team payroll: ${formatMoney(totals.teamPayroll)}`,
    `🟣 Referrals: ${formatMoney(totals.referrals)}`,
    `💰 Net trading profit: ${formatMoney(totals.netTradingProfit)}`,
    `📦 Total profit pool: ${formatMoney(totals.totalProfitPool)}`,
  ].join("\n")
}

export type LedgerAiSnapshot = {
  source: "dailyPayrollEntries"
  savedDayCount: number
  today: LedgerPeriodTotals
  thisWeek: LedgerPeriodTotals
  thisMonth: LedgerPeriodTotals
  recentDays: Array<{
    date: string
    tradingIncome: number
    miscIncome: number
    netTradingProfit: number
    totalProfitPool: number
  }>
  byMonth: Array<{
    month: string
    label: string
    dayCount: number
    tradingIncome: number
    miscIncome: number
    netTradingProfit: number
    totalProfitPool: number
  }>
}

export function buildLedgerAiSnapshot(entries: any[], todayKey = teamEstDateKey()): LedgerAiSnapshot {
  const sorted = [...entries].sort((a, b) => entryDate(b).localeCompare(entryDate(a)))
  const recentDays = sorted.slice(0, 8).map((entry) => {
    const calc = entryCalc(entry)
    const net = Number(calc.netProfit ?? entry.netProfit ?? 0)
    const misc = Number(calc.totalDevAllo ?? entry.totalDevAllo ?? 0)
    return {
      date: entryDate(entry),
      tradingIncome: Number(calc.totalDailyIncome ?? entry.totalIncome ?? 0),
      miscIncome: misc,
      netTradingProfit: net,
      totalProfitPool: roundMoney(net + misc),
    }
  })

  const monthMap = new Map<string, any[]>()
  for (const entry of entries) {
    const month = entryDate(entry).slice(0, 7)
    if (!monthMap.has(month)) monthMap.set(month, [])
    monthMap.get(month)!.push(entry)
  }

  const byMonth = Array.from(monthMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, rows]) => {
      const totals = aggregateLedgerPeriod(rows, `${month}-01`, monthEndKey(Number(month.slice(0, 4)), Number(month.slice(5, 7))))
      const [year, monthNum] = month.split("-").map(Number)
      return {
        month,
        label: monthLabel(year, monthNum),
        dayCount: totals.dayCount,
        tradingIncome: totals.tradingIncome,
        miscIncome: totals.miscIncome,
        netTradingProfit: totals.netTradingProfit,
        totalProfitPool: totals.totalProfitPool,
      }
    })

  return {
    source: "dailyPayrollEntries",
    savedDayCount: entries.length,
    today: aggregateLedgerPeriod(entries, todayKey, todayKey),
    thisWeek: aggregateLedgerPeriod(entries, weekStartKey(todayKey), todayKey),
    thisMonth: aggregateLedgerPeriod(entries, monthStartKey(todayKey), todayKey),
    recentDays,
    byMonth,
  }
}

/** Merge ledger totals with legacy sheet totals — ledger wins when it has rows. */
export function resolveFinancialTotals(
  ledger: LedgerPeriodTotals,
  sheet: { income: number; expense: number; payroll: number; profit: number },
) {
  if (ledger.hasEntries) {
    return {
      source: "payrollLedger" as const,
      income: ledger.tradingIncome,
      expense: ledger.totalExpense,
      payroll: ledger.teamPayroll,
      profit: ledger.netTradingProfit,
      miscIncome: ledger.miscIncome,
      totalProfitPool: ledger.totalProfitPool,
    }
  }
  return {
    source: "sheets" as const,
    income: sheet.income,
    expense: sheet.expense,
    payroll: sheet.payroll,
    profit: sheet.profit,
    miscIncome: 0,
    totalProfitPool: sheet.profit,
  }
}
