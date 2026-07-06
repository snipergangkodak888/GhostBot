import { getDb } from "@/lib/db"
import type { PayrollAccount } from "@/lib/payroll-ledger"
import { teamDateKey } from "@/lib/team-timezone"

export type PayrollReportShareRow = {
  name: string
  percentage: number
  amount: number
}

export type PayrollDailyReport = {
  date: string
  displayDate: string
  teamPayroll: Array<{ name: string; status: "ON" | "OFF"; expense: number }>
  totalPayroll: number
  dailyIncome: Array<{ client: string; type: string; income: number }>
  totalDailyIncome: number
  dailyProfit: number
  dailyProfitShares: PayrollReportShareRow[]
  miscIncome: Array<{ client: string; income: number }>
  totalMiscIncome: number
  miscProfit: number
  miscProfitShares: PayrollReportShareRow[]
  referrals: Array<{ referrer: string; percentage: number; client: string; wallet: string; amount: number }>
  totalReferrals: number
  distributions: Array<{ receiver: string; amount: number; wallet: string }>
  totalDistributed: number
  rules: { dayType: string; recipient: string; amount: string }
  notes: string
}

function money(value: number) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function accountId(account: PayrollAccount) {
  return String(account.id || account._id || "")
}

function displaySheetDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!year || !month || !day) return dateKey
  return `${month}/${day}/${String(year).slice(-2)}`
}

function reportMiscClientLabel(category: string, projectName: string | null) {
  if (projectName) return projectName
  switch (category) {
    case "fee_rebate":
      return "Rebate"
    case "private_liqs":
      return "Priv liqs"
    case "other":
      return "Other"
    default:
      return "Misc"
  }
}

function truncateWallet(value: string, max = 12) {
  const wallet = String(value || "").trim()
  if (!wallet) return ""
  if (wallet.length <= max) return wallet
  return `${wallet.slice(0, max)}…`
}

export async function loadDailyPayrollReport(date: string): Promise<PayrollDailyReport | null> {
  const dateKey = String(date || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null

  const db = await getDb()
  const [entry, accountRows, projectRows] = await Promise.all([
    db.collection("dailyPayrollEntries").findOne({ date: dateKey }),
    db.collection("payrollAccounts").find({}).toArray(),
    db.collection("opsProjects").find({}).toArray(),
  ])
  if (!entry) return null

  const accounts = accountRows as PayrollAccount[]
  const projectsById = new Map(projectRows.map((project: any) => [String(project._id || project.id), project]))
  const accountsById = new Map(accounts.map((account) => [accountId(account), account]))
  const employees = accounts
    .filter((account) => account.type === "EMPLOYEE")
    .sort((a, b) => a.name.localeCompare(b.name))

  const inputs = entry.inputs || {}
  const calculation = entry.calculation || {}
  const teamPayrollInputs = Array.isArray(inputs.teamPayroll) ? inputs.teamPayroll : []
  const clientIncome = Array.isArray(inputs.clientIncome) ? inputs.clientIncome : []
  const devAllocations = Array.isArray(inputs.devAllocations) ? inputs.devAllocations : []
  const rules = inputs.rules || {}

  const distributionByAccountId = new Map(
    (Array.isArray(calculation.distributions) ? calculation.distributions : []).map((row: any) => [
      String(row.accountId),
      row,
    ]),
  )

  const teamPayroll = employees.map((employee) => {
    const id = accountId(employee)
    const row = teamPayrollInputs.find((item: any) => String(item.accountId) === id)
    const active = row?.status === "active"
    const expense = active ? Number(distributionByAccountId.get(id)?.basePayroll || 0) : 0
    return {
      name: employee.name,
      status: active ? "ON" as const : "OFF" as const,
      expense,
    }
  })

  const shareAccounts = accounts
    .filter((account) => account.type === "EMPLOYEE" || account.type === "SYSTEM_TREASURY")
    .filter((account) => Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0) > 0)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "EMPLOYEE" ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  const dailyProfitShares = shareAccounts.map((account) => {
    const id = accountId(account)
    const dist = distributionByAccountId.get(id)
    return {
      name: account.name,
      percentage: Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
      amount: Number(dist?.netProfitShare || 0),
    }
  })

  const miscProfitShares = shareAccounts.map((account) => {
    const id = accountId(account)
    const dist = distributionByAccountId.get(id)
    return {
      name: account.name,
      percentage: Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
      amount: Number(dist?.devShare || 0),
    }
  })

  const dailyIncome = clientIncome.map((row: any) => {
    const project = row.projectId ? projectsById.get(String(row.projectId)) : null
    return {
      client: project?.name || "Project",
      type: String(row.incomeType || "24/7 Traders"),
      income: Number(row.income || 0),
    }
  })

  const miscIncome = devAllocations.map((row: any) => {
    const project = row.projectId ? projectsById.get(String(row.projectId)) : null
    const category = row.category ? String(row.category) : ""
    const client = reportMiscClientLabel(category, project?.name || null)
    return {
      client,
      income: Number(row.income || 0),
    }
  })

  const referrals = (Array.isArray(calculation.referrals) ? calculation.referrals : []).map((row: any) => {
    const referrer = accountsById.get(String(row.referrerAccountId))
    const project = projectsById.get(String(row.clientAccountId))
    return {
      referrer: row.referrerName || referrer?.name || "Referrer",
      percentage: Number(row.percentage || 0),
      client: row.clientName || project?.name || "Client",
      wallet: truncateWallet(referrer?.wallet || referrer?.source || ""),
      amount: Number(row.amount || 0),
    }
  })

  const distributions = (Array.isArray(calculation.distributions) ? calculation.distributions : [])
    .map((row: any) => {
      const account = accountsById.get(String(row.accountId))
      const accountType = row.accountType || account?.type
      const teamPayout = Number(row.basePayroll || 0) + Number(row.netProfitShare || 0) + Number(row.devShare || 0)
      return {
        accountType,
        receiver: row.accountName,
        amount: teamPayout,
        wallet: truncateWallet(row.wallet || account?.wallet || account?.source || ""),
      }
    })
    .filter((row) => row.accountType !== "REFERRER" && row.accountType !== "CLIENT" && row.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
    .map(({ receiver, amount, wallet }) => ({ receiver, amount, wallet }))

  const totalDailyIncome = Number(calculation.totalDailyIncome ?? entry.totalIncome ?? 0)
  const totalMiscIncome = Number(calculation.totalDevAllo ?? entry.totalDevAllo ?? 0)
  const totalPayroll = Number(calculation.totalTeamPayroll ?? entry.totalTeamPayroll ?? 0)
  const totalReferrals = Number(calculation.totalReferrals ?? entry.totalReferrals ?? 0)
  const dailyProfit = Number(calculation.netProfit ?? entry.netProfit ?? 0)
  const totalDistributed = distributions.reduce((sum, row) => sum + row.amount, 0)

  return {
    date: dateKey,
    displayDate: displaySheetDate(dateKey),
    teamPayroll,
    totalPayroll,
    dailyIncome,
    totalDailyIncome,
    dailyProfit,
    dailyProfitShares,
    miscIncome,
    totalMiscIncome,
    miscProfit: totalMiscIncome,
    miscProfitShares,
    referrals,
    totalReferrals,
    distributions,
    totalDistributed,
    rules: {
      dayType: String(rules.dayType || "Trading Days"),
      recipient: String(rules.recipient || "Traders Only"),
      amount: `$${Number(rules.basePay ?? 150)} Base + $${Number(rules.extraPay ?? 50)}/Chart`,
    },
    notes: String(entry.notes || "").trim(),
  }
}

export { money as reportMoney }

export function parseReportDateFromText(text: string) {
  const stripped = String(text || "")
    .replace(/^\/\w+(?:@\w+)?(?:\s+|$)/i, "")
    .trim()
    .toLowerCase()
  const arg = stripped || "today"

  if (arg === "today") return teamDateKey(0)
  if (arg === "yesterday") return teamDateKey(-1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg

  const slash = arg.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${year}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`
  }

  return teamDateKey(0)
}
