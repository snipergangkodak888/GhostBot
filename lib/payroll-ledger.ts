export type PayrollAccountType = "EMPLOYEE" | "CLIENT" | "REFERRER" | "SYSTEM_TREASURY"

export type PayrollAccount = {
  _id?: string
  id?: string
  name: string
  type: PayrollAccountType
  referralId?: string | null
  referral_id?: string | null
  profitSharePercentage?: number
  profit_share_percentage?: number
  wallet?: string
  source?: string
}

export type PayrollProject = {
  _id?: string
  id?: string
  name: string
  referrer?: string
  referrerAccountId?: string | null
  referralPercentage?: number
  referrerPercentage?: number
}

export type TeamPayrollInput = {
  accountId: string
  status: "active" | "inactive"
  projectIds?: string[]
  charts?: number
  /** When set, overrides base + chart calculation (e.g. non-trader flat pay). */
  manualAmount?: number
}

export type ClientIncomeInput = {
  accountId?: string
  projectId?: string
  incomeType?: string
  income: number
  /** When true, this line does not generate referral commission even if the project has a referrer. */
  skipReferral?: boolean
}

import type { MiscIncomeCategory } from "./payroll-misc"

export type DevAllocationInput = {
  accountId?: string
  projectId?: string
  income: number
  category?: MiscIncomeCategory | string
}

export type PayrollLedgerInput = {
  accounts: PayrollAccount[]
  projects?: PayrollProject[]
  teamPayroll: TeamPayrollInput[]
  clientIncome: ClientIncomeInput[]
  devAllocations: DevAllocationInput[]
  basePay?: number
  chartPay?: number
}

export type PayrollLedgerDistribution = {
  accountId: string
  accountName: string
  accountType: PayrollAccountType
  basePayroll: number
  referralCommission: number
  netProfitShare: number
  devShare: number
  total: number
  wallet?: string
}

export type PayrollLedgerReferral = {
  referrerAccountId: string
  referrerName: string
  clientAccountId: string
  clientName: string
  percentage: number
  amount: number
}

export type PayrollLedgerCalculation = {
  totalDailyIncome: number
  totalDevAllo: number
  totalTeamPayroll: number
  totalReferrals: number
  netProfit: number
  totalDistributed: number
  referrals: PayrollLedgerReferral[]
  distributions: PayrollLedgerDistribution[]
}

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

export function accountId(account: PayrollAccount) {
  return String(account.id || account._id || "")
}

export function accountShare(account: PayrollAccount) {
  return Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0)
}

export function accountReferralId(account: PayrollAccount) {
  return account.referralId ?? account.referral_id ?? null
}

function projectId(project: PayrollProject) {
  return String(project.id || project._id || "")
}

function normalizedName(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function accountWallet(account: PayrollAccount) {
  return String(account.wallet || account.source || "").trim()
}

export function calculatePayrollLedger(input: PayrollLedgerInput): PayrollLedgerCalculation {
  const basePay = Number(input.basePay ?? 150)
  const chartPay = Number(input.chartPay ?? 50)
  const accountsById = new Map(input.accounts.map((account) => [accountId(account), account]))
  const accountsByName = new Map(input.accounts.map((account) => [normalizedName(account.name), account]))
  const projectsById = new Map((input.projects || []).map((project) => [projectId(project), project]))
  const distributions = new Map<string, PayrollLedgerDistribution>()

  const ensureDistribution = (account: PayrollAccount) => {
    const id = accountId(account)
    if (!distributions.has(id)) {
      distributions.set(id, {
        accountId: id,
        accountName: account.name,
        accountType: account.type,
        basePayroll: 0,
        referralCommission: 0,
        netProfitShare: 0,
        devShare: 0,
        total: 0,
        wallet: accountWallet(account),
      })
    }
    return distributions.get(id)!
  }

  const totalDailyIncome = roundMoney(input.clientIncome.reduce((sum, row) => sum + Number(row.income || 0), 0))
  const totalDevAllo = roundMoney(input.devAllocations.reduce((sum, row) => sum + Number(row.income || 0), 0))

  let totalTeamPayroll = 0
  for (const row of input.teamPayroll) {
    if (row.status !== "active") continue
    const account = accountsById.get(row.accountId)
    if (!account || account.type !== "EMPLOYEE") continue
    const manualAmount = Number(row.manualAmount)
    let amount = 0
    if (Number.isFinite(manualAmount) && manualAmount > 0) {
      amount = roundMoney(manualAmount)
    } else {
      const projectCount = Array.isArray(row.projectIds) ? new Set(row.projectIds.filter(Boolean)).size : 0
      if (projectCount === 0 && Array.isArray(row.projectIds)) continue
      const extraProjects = projectCount > 0 ? projectCount - 1 : Math.max(0, Number(row.charts || 0))
      amount = roundMoney(basePay + chartPay * extraProjects)
    }
    const distribution = ensureDistribution(account)
    distribution.basePayroll = roundMoney(distribution.basePayroll + amount)
    totalTeamPayroll = roundMoney(totalTeamPayroll + amount)
  }

  const referrals: PayrollLedgerReferral[] = []
  let totalReferrals = 0
  for (const row of input.clientIncome) {
    if (row.skipReferral) continue
    const project = row.projectId ? projectsById.get(String(row.projectId)) : null
    const client = row.accountId ? accountsById.get(row.accountId) : null
    const referrerId = project?.referrerAccountId || (client ? accountReferralId(client) : null)
    const referrer = referrerId
      ? accountsById.get(String(referrerId))
      : project?.referrer
        ? accountsByName.get(normalizedName(project.referrer))
        : null
    const percentage = Number(
      project?.referralPercentage ??
      project?.referrerPercentage ??
      (client ? accountShare(client) : 0),
    )
    if (!referrer || percentage <= 0) continue
    const amount = roundMoney(Math.floor(Number(row.income || 0) * (percentage / 100)))
    if (amount <= 0) continue
    const distribution = ensureDistribution(referrer)
    distribution.referralCommission = roundMoney(distribution.referralCommission + amount)
    referrals.push({
      referrerAccountId: accountId(referrer),
      referrerName: referrer.name,
      clientAccountId: project ? projectId(project) : client ? accountId(client) : "",
      clientName: project?.name || client?.name || "Project",
      percentage,
      amount,
    })
    totalReferrals = roundMoney(totalReferrals + amount)
  }

  const netProfit = roundMoney(totalDailyIncome - (totalTeamPayroll + totalReferrals))

  for (const account of input.accounts) {
    if (account.type !== "EMPLOYEE" && account.type !== "SYSTEM_TREASURY") continue
    const percentage = accountShare(account)
    if (percentage <= 0) continue
    const distribution = ensureDistribution(account)
    distribution.netProfitShare = roundMoney(distribution.netProfitShare + netProfit * (percentage / 100))
    distribution.devShare = roundMoney(distribution.devShare + totalDevAllo * (percentage / 100))
  }

  const rows = Array.from(distributions.values())
    .map((row) => ({
      ...row,
      total: roundMoney(row.basePayroll + row.referralCommission + row.netProfitShare + row.devShare),
    }))
    .filter((row) => row.total !== 0)
    .sort((a, b) => b.total - a.total || a.accountName.localeCompare(b.accountName))

  return {
    totalDailyIncome,
    totalDevAllo,
    totalTeamPayroll,
    totalReferrals,
    netProfit,
    totalDistributed: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
    referrals,
    distributions: rows,
  }
}
