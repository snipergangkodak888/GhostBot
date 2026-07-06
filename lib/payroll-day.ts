import { getDb } from "@/lib/db"
import {
  calculatePayrollLedger,
  type ClientIncomeInput,
  type DevAllocationInput,
  type PayrollAccount,
  type PayrollProject,
  type TeamPayrollInput,
} from "@/lib/payroll-ledger"
import { normalizeDevAllocations, validateDevAllocations } from "@/lib/payroll-misc"

export type PayrollDayRules = {
  dayType: string
  recipient: string
  basePay: number
  extraPay: number
}

export type SavePayrollDayInput = {
  date?: string
  notes?: string
  teamPayroll?: TeamPayrollInput[]
  clientIncome?: ClientIncomeInput[]
  devAllocations?: DevAllocationInput[]
  rules?: Partial<PayrollDayRules>
}

function dateKey(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function normalizeAccount(account: any): PayrollAccount {
  return {
    ...account,
    id: String(account.id || account._id || ""),
    _id: String(account._id || account.id || ""),
    referralId: account.referralId || account.referral_id || null,
    profitSharePercentage: Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
  }
}

function normalizeProject(project: any): PayrollProject {
  return {
    ...project,
    id: String(project.id || project._id || ""),
    _id: String(project._id || project.id || ""),
    referrerAccountId: project.referrerAccountId ? String(project.referrerAccountId) : null,
    referralPercentage: Number(project.referralPercentage ?? project.referrerPercentage ?? 0),
  }
}

export async function savePayrollDay(input: SavePayrollDayInput) {
  const date = dateKey(input.date)
  const notes = String(input.notes || "").trim()
  const db = await getDb()
  const [accountRows, projectRows] = await Promise.all([
    db.collection("payrollAccounts").find({}).toArray(),
    db.collection("opsProjects").find({}).toArray(),
  ])
  const accounts = accountRows.map(normalizeAccount)
  const projects = projectRows.map(normalizeProject)
  const rules: PayrollDayRules = {
    dayType: String(input.rules?.dayType || "Launch Days").trim(),
    recipient: String(input.rules?.recipient || "Launch Team Base").trim(),
    basePay: Number(input.rules?.basePay ?? 150),
    extraPay: Number(input.rules?.extraPay ?? 50),
  }
  const teamPayroll = Array.isArray(input.teamPayroll) ? input.teamPayroll : []
  const clientIncome = Array.isArray(input.clientIncome) ? input.clientIncome : []
  const devAllocations = normalizeDevAllocations(input.devAllocations) as DevAllocationInput[]
  const validationErrors = validateDevAllocations(devAllocations)
  if (validationErrors.length) {
    throw new Error(validationErrors[0])
  }
  const calculation = calculatePayrollLedger({
    accounts,
    projects,
    teamPayroll,
    clientIncome,
    devAllocations,
    basePay: rules.basePay,
    chartPay: rules.extraPay,
  })
  const now = new Date()
  const inputs = { teamPayroll, clientIncome, devAllocations, rules }

  await Promise.all([
    db.collection("dailyPayrollEntries").deleteMany({ date }),
    db.collection("ledgerTransactions").deleteMany({ date }),
    db.collection("opsPayroll").deleteMany({ date, source: "mini-ledger" }),
  ])

  const summary = {
    date,
    totalIncome: calculation.totalDailyIncome,
    totalDevAllo: calculation.totalDevAllo,
    totalTeamPayroll: calculation.totalTeamPayroll,
    totalReferrals: calculation.totalReferrals,
    netProfit: calculation.netProfit,
    totalDistributed: calculation.totalDistributed,
    inputs,
    calculation,
    notes,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("dailyPayrollEntries").insertOne(summary)
  const entryId = String(result.insertedId)
  const transactionRows = calculation.distributions.flatMap((row) => {
    const parts = [
      ["base_payroll", row.basePayroll],
      ["referral_commission", row.referralCommission],
      ["net_profit_share", row.netProfitShare],
      ["dev_share", row.devShare],
    ] as const
    return parts
      .filter(([, amount]) => Number(amount || 0) !== 0)
      .map(([source, amount]) => ({
        dailyPayrollEntryId: entryId,
        accountId: row.accountId,
        accountName: row.accountName,
        accountType: row.accountType,
        source,
        amount: Number(amount || 0),
        date,
        createdAt: now,
      }))
  })

  if (transactionRows.length) await db.collection("ledgerTransactions").insertMany(transactionRows)
  if (calculation.distributions.length) {
    await db.collection("opsPayroll").insertMany(calculation.distributions.map((row) => ({
      member: row.accountName,
      accountId: row.accountId,
      role: row.accountType,
      amount: row.total,
      currency: "USD",
      status: "paid",
      date,
      notes,
      source: "mini-ledger",
      dailyPayrollEntryId: entryId,
      createdAt: now,
      updatedAt: now,
    })))
  }

  return { entry: { ...summary, _id: entryId }, transactions: transactionRows, projects, accounts }
}
