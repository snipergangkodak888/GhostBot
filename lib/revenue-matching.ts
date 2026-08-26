import type { RevenueReceipt } from "@/lib/revenue-types"

export type MatchTarget = {
  chain: string
  asset?: string | null
  tokenAddress?: string | null
  expectedAmount?: number | null
  expectedUsd?: number | null
  occurredAt?: string | null
  date?: string | null
}

function sameTokenAddress(chain: string, left: unknown, right: unknown) {
  const normalize = (value: unknown) => chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase()
  return normalize(left) === normalize(right)
}

export type ReceiptMatchCandidate = {
  receiptIds: string[]
  total: number
  delta: number
  confidence: "high" | "medium"
  receiptCount: number
  firstReceiptAt?: string | null
  lastReceiptAt?: string | null
}

const MATCH_WINDOW_MS = 30 * 60 * 60 * 1_000
const CLUSTER_GAP_MS = 20 * 60 * 1_000
const MAX_CANDIDATE_RECEIPTS = 250
const MAX_RECEIPTS_PER_MATCH = 50
const MAX_DP_STATES = 20_000

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

function receiptTime(receipt: RevenueReceipt) {
  const value = new Date(receipt.blockTime || receipt.createdAt || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

function clusterReceipts(receipts: RevenueReceipt[]) {
  const clusters: RevenueReceipt[][] = []
  for (const receipt of [...receipts].sort((a, b) => receiptTime(a) - receiptTime(b))) {
    const current = clusters[clusters.length - 1]
    if (!current || receiptTime(receipt) - receiptTime(current[current.length - 1]) > CLUSTER_GAP_MS) clusters.push([receipt])
    else current.push(receipt)
  }
  return clusters
}

function subsetCandidate(receipts: RevenueReceipt[], values: number[], desired: number, allowed: number) {
  type State = { total: number; indices: number[] }
  const quantum = Math.max(allowed / 4, Math.abs(desired) / 100_000, 0.00000001)
  let states = new Map<number, State>([[0, { total: 0, indices: [] }]])

  for (let index = 0; index < receipts.length; index += 1) {
    const value = values[index]
    if (!(value > 0)) continue
    const next = new Map(states)
    for (const state of Array.from(states.values())) {
      if (state.indices.length >= MAX_RECEIPTS_PER_MATCH) continue
      const total = state.total + value
      if (total > desired + allowed) continue
      const candidate = { total, indices: [...state.indices, index] }
      const bucket = Math.round(total / quantum)
      const existing = next.get(bucket)
      if (!existing || Math.abs(total - desired) < Math.abs(existing.total - desired) || (Math.abs(total - desired) === Math.abs(existing.total - desired) && candidate.indices.length < existing.indices.length)) {
        next.set(bucket, candidate)
      }
    }
    if (next.size > MAX_DP_STATES) {
      const trimmed = Array.from(next.entries())
        .sort(([, a], [, b]) => Math.abs(a.total - desired) - Math.abs(b.total - desired) || a.indices.length - b.indices.length)
        .slice(0, MAX_DP_STATES - 1)
      states = new Map([[0, { total: 0, indices: [] }], ...trimmed])
    } else states = next
  }

  const best = Array.from(states.values())
    .filter((state) => state.indices.length > 0 && Math.abs(state.total - desired) <= allowed)
    .sort((a, b) => Math.abs(a.total - desired) - Math.abs(b.total - desired) || a.indices.length - b.indices.length)[0]
  if (!best) return null
  return { receipts: best.indices.map((index: number) => receipts[index]), total: best.total }
}

function candidateKey(receipts: RevenueReceipt[]) {
  return receipts.map((receipt) => String(receipt._id || "")).filter(Boolean).sort().join(":")
}

export function findReceiptMatchCandidates(receipts: RevenueReceipt[], target: MatchTarget, limit = 3): ReceiptMatchCandidate[] {
  const expected = expectedValue(target)
  if (typeof expected !== "number" || expected <= 0 || !target.chain) return []
  const eventTime = target.occurredAt ? new Date(target.occurredAt).getTime() : 0
  const usesUsd = target.expectedAmount == null
  const allowed = tolerance(expected, usesUsd)
  const eligible = receipts
    .filter((receipt) => receipt.direction === "incoming")
    .filter((receipt) => receipt.chain === target.chain)
    .filter((receipt) => !target.asset || target.asset === "USD" || receipt.asset === target.asset)
    .filter((receipt) => !target.tokenAddress || sameTokenAddress(target.chain, receipt.tokenAddress, target.tokenAddress))
    .filter((receipt) => receipt.status === "unclassified")
    .filter((receipt) => availableAmount(receipt) > 0)
    .filter((receipt) => !target.date || !receipt.date || receipt.date === target.date)
    .filter((receipt) => !eventTime || !receiptTime(receipt) || Math.abs(receiptTime(receipt) - eventTime) <= MATCH_WINDOW_MS)
    .sort((a, b) => {
      if (!eventTime) return receiptTime(b) - receiptTime(a)
      return Math.abs(receiptTime(a) - eventTime) - Math.abs(receiptTime(b) - eventTime)
    })
    .slice(0, MAX_CANDIDATE_RECEIPTS)

  const groups = [...clusterReceipts(eligible), eligible]
  const found = new Map<string, { receipts: RevenueReceipt[]; total: number }>()
  for (const group of groups) {
    if (!group.length) continue
    const values = group.map((receipt) => targetValue(receipt, target) ?? 0)
    const result = subsetCandidate(group, values, expected, allowed)
    if (!result) continue
    const key = candidateKey(result.receipts)
    if (key && !found.has(key)) found.set(key, result)
  }

  const ranked = Array.from(found.values()).sort((a: { receipts: RevenueReceipt[]; total: number }, b: { receipts: RevenueReceipt[]; total: number }) => {
    const delta = Math.abs(a.total - expected) - Math.abs(b.total - expected)
    if (delta) return delta
    const aDistance = eventTime ? Math.min(...a.receipts.map((receipt: RevenueReceipt) => Math.abs(receiptTime(receipt) - eventTime))) : 0
    const bDistance = eventTime ? Math.min(...b.receipts.map((receipt: RevenueReceipt) => Math.abs(receiptTime(receipt) - eventTime))) : 0
    return aDistance - bDistance || a.receipts.length - b.receipts.length
  })
  const bestDelta = ranked[0] ? Math.abs(ranked[0].total - expected) : Infinity
  const ambiguous = ranked.slice(1).some((candidate: { receipts: RevenueReceipt[]; total: number }) => Math.abs(Math.abs(candidate.total - expected) - bestDelta) <= allowed / 5)

  return ranked.slice(0, Math.max(1, limit)).map((candidate, index) => {
    const times = candidate.receipts.map((receipt: RevenueReceipt) => receiptTime(receipt)).filter(Boolean).sort((a: number, b: number) => a - b)
    const delta = Math.abs(candidate.total - expected)
    return {
      receiptIds: candidate.receipts.map((receipt) => String(receipt._id || "")).filter(Boolean),
      total: candidate.total,
      delta,
      confidence: index === 0 && delta <= allowed / 5 && !ambiguous ? "high" : "medium",
      receiptCount: candidate.receipts.length,
      firstReceiptAt: times[0] ? new Date(times[0]).toISOString() : null,
      lastReceiptAt: times[times.length - 1] ? new Date(times[times.length - 1]).toISOString() : null,
    }
  })
}

export function findReceiptCombination(receipts: RevenueReceipt[], target: MatchTarget) {
  const [best, ...alternatives] = findReceiptMatchCandidates(receipts, target, 3)
  return best ? { ...best, alternatives } : null
}
