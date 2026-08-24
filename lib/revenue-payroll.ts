import { isGlobalRevenueFeeType } from "@/lib/revenue-types"

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor
}

export function aggregateRevenueFeesForPayroll(fees: any[], date: string) {
  const valued = fees.filter((fee: any) => Number(fee.recognizedUsd || 0) > 0 && (fee.projectId || isGlobalRevenueFeeType(fee.feeType)))
  const clientGroups = new Map<string, any>()
  const miscGroups = new Map<string, any>()
  for (const fee of valued) {
    const isMisc = fee.feeType === "dev_allocation" || isGlobalRevenueFeeType(fee.feeType)
    const target = isMisc ? miscGroups : clientGroups
    const key = `${fee.projectId || "global"}:${fee.feeType}`
    const existing = target.get(key) || {
      ...(fee.projectId ? { projectId: String(fee.projectId) } : {}),
      ...(isMisc ? { category: fee.feeType } : { incomeType: String(fee.feeType || "trading") }),
      income: 0,
      sourceFeeEventIds: [],
    }
    existing.income = round(existing.income + Number(fee.recognizedUsd || 0))
    existing.sourceFeeEventIds.push(String(fee._id))
    target.set(key, existing)
  }
  return { date, clientIncome: Array.from(clientGroups.values()), devAllocations: Array.from(miscGroups.values()) }
}
