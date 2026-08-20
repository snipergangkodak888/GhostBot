import type { RevenueReceipt } from "@/lib/revenue-types"

export type MatchTarget = {
  chain: string
  asset?: string | null
  expectedAmount?: number | null
  expectedUsd?: number | null
  occurredAt?: string | null
}

function availableAmount(receipt: RevenueReceipt) {
  const used = (receipt.allocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0)
  return Math.max(0, Number(receipt.amount || 0) - used)
}

function targetValue(receipt: RevenueReceipt, target: MatchTarget) {
  if (target.expectedAmount != null) return availableAmount(receipt)
  if (target.expectedUsd != null && receipt.amountUsd != null) {
    const ratio = availableAmount(receipt) / Math.max(Number(receipt.amount || 0), Number.EPSILON)
    return Number(receipt.amountUsd) * ratio
  }
  if (target.expectedUsd != null && receipt.asset === "USDC") return availableAmount(receipt)
  return null
}

function expectedValue(target: MatchTarget) {
  return target.expectedAmount ?? target.expectedUsd ?? null
}

function tolerance(expected: number, usesUsd: boolean) {
  return Math.max(usesUsd ? 2 : 0.000001, Math.abs(expected) * 0.005)
}

export function findReceiptCombination(receipts: RevenueReceipt[], target: MatchTarget) {
  const expected = expectedValue(target)
  if (typeof expected !== "number" || expected <= 0 || !target.chain) return null
  const desired = expected
  const eventTime = target.occurredAt ? new Date(target.occurredAt).getTime() : 0
  const candidates = receipts
    .filter((receipt) => receipt.direction === "incoming")
    .filter((receipt) => receipt.chain === target.chain)
    .filter((receipt) => !target.asset || target.asset === "USD" || receipt.asset === target.asset)
    .filter((receipt) => receipt.status === "unclassified")
    .filter((receipt) => availableAmount(receipt) > 0)
    .filter((receipt) => {
      if (!eventTime || !receipt.blockTime) return true
      return Math.abs(new Date(receipt.blockTime).getTime() - eventTime) <= 18 * 60 * 60 * 1000
    })
    .slice(0, 18)

  const values = candidates.map((receipt) => targetValue(receipt, target))
  const usesUsd = target.expectedAmount == null
  const allowed = tolerance(desired, usesUsd)
  const best: { value: { indices: number[]; total: number; delta: number } | null } = { value: null }

  function visit(index: number, indices: number[], total: number) {
    const delta = Math.abs(total - desired)
    if (indices.length && delta <= allowed && (!best.value || delta < best.value.delta || (delta === best.value.delta && indices.length < best.value.indices.length))) {
      best.value = { indices: [...indices], total, delta }
    }
    if (index >= candidates.length || indices.length >= 10 || total > desired + allowed) return
    visit(index + 1, indices, total)
    const value = values[index]
    if (value == null) return
    indices.push(index)
    visit(index + 1, indices, total + value)
    indices.pop()
  }

  visit(0, [], 0)
  const result = best.value
  if (!result) return null
  return {
    receiptIds: result.indices.map((index: number) => String(candidates[index]._id || "")).filter(Boolean),
    total: result.total,
    delta: result.delta,
    confidence: result.delta <= allowed / 5 ? "high" as const : "medium" as const,
  }
}
