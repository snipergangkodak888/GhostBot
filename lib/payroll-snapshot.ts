function money(value: unknown) {
  const amount = Number(value || 0)
  const formatted = Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })
  return amount < 0 ? `-$${formatted}` : `$${formatted}`
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function formatPayrollSnapshot(entry: any) {
  const calculation = entry?.calculation || {}
  const distributions = Array.isArray(calculation.distributions) ? calculation.distributions : []
  const tradingIncome = Number(calculation.totalDailyIncome ?? entry?.totalIncome ?? 0)
  const devAllocation = Number(calculation.totalDevAllo ?? entry?.totalDevAllo ?? 0)
  const teamPayroll = Number(calculation.totalTeamPayroll ?? entry?.totalTeamPayroll ?? 0)
  const referrerExpense = Number(calculation.totalReferrals ?? entry?.totalReferrals ?? 0)
  const totalExpense = teamPayroll + referrerExpense
  const netProfit = Number(calculation.netProfit ?? entry?.netProfit ?? 0)
  const lines = [
    `💸 <b>Daily Payroll - ${escapeHtml(entry?.date || "Today")}</b>`,
    "",
    `🟢 Trading Income: <b>${money(tradingIncome)}</b>`,
    `🔵 Dev Allocation: <b>${money(devAllocation)}</b>`,
    "",
    `🔴 Team Payroll: <b>${money(teamPayroll)}</b>`,
    `🟣 Referrer Expense: <b>${money(referrerExpense)}</b>`,
    `🔴 Total Expense: <b>${money(totalExpense)}</b>`,
    "",
    `${netProfit >= 0 ? "🟢" : "🔴"} Net ${netProfit >= 0 ? "Profit" : "Loss"}: <b>${money(netProfit)}</b>`,
  ]
  if (distributions.length) {
    lines.push("", "🟣 <b>Daily Distributions</b>")
    for (const row of distributions) {
      lines.push(`▫️ ${escapeHtml(row.accountName)}: <b>${money(row.total)}</b>`)
    }
  }
  if (entry?.notes) lines.push("", `📝 Note: ${escapeHtml(entry.notes)}`)
  return lines.join("\n")
}
