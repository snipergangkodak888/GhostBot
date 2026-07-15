import type { PayrollAccount } from "@/lib/payroll-ledger"

const HIDDEN_TEAM_MEMBER_NAMES = new Set(["TEST"])

export function isVisiblePayrollTeamMember(account: Pick<PayrollAccount, "name" | "type">) {
  if (account.type !== "EMPLOYEE") return false
  const name = String(account.name || "").trim().toUpperCase()
  return name.length > 0 && !HIDDEN_TEAM_MEMBER_NAMES.has(name)
}

export function visiblePayrollEmployees(accounts: PayrollAccount[]) {
  return accounts
    .filter((account) => isVisiblePayrollTeamMember(account))
    .sort((a, b) => a.name.localeCompare(b.name))
}
