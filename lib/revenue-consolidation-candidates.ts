import { getDb } from "@/lib/db"
import { teamDateKey } from "@/lib/team-timezone"
import type { RevenueConsolidationCandidate, RevenueReceipt } from "@/lib/revenue-types"

const RECEIPTS = "revenueReceipts"
const CANDIDATES = "revenueConsolidationCandidates"
const CANDIDATE_WINDOW_MS = 30 * 60 * 1_000
const MIN_SOURCE_USD = 1

const round = (value: number, places = 2) => {
  const factor = 10 ** places
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor
}

function receiptTime(receipt: Partial<RevenueReceipt>) {
  const value = new Date(receipt.blockTime || receipt.createdAt || 0).getTime()
  return Number.isFinite(value) ? value : Date.now()
}

function appendUnique(values: unknown, id: string) {
  return Array.from(new Set([...(Array.isArray(values) ? values.map(String) : []), id]))
}

function isOpen(batch: any, at: number) {
  if (!["collecting", "suggested"].includes(String(batch?.status || ""))) return false
  const last = new Date(batch.lastActivityAt || batch.updatedAt || batch.createdAt || 0).getTime()
  return Number.isFinite(last) && Math.abs(at - last) <= CANDIDATE_WINDOW_MS
}

export function consolidationCandidateMetrics(receipts: RevenueReceipt[], batch: Pick<RevenueConsolidationCandidate, "sourceReceiptIds" | "destinationReceiptIds" | "swapReceiptIds">) {
  const byId = new Map(receipts.map((receipt) => [String(receipt._id || ""), receipt]))
  const sourceIds = new Set((batch.sourceReceiptIds || []).map(String))
  const destinationIds = new Set((batch.destinationReceiptIds || []).map(String))
  const swapIds = new Set((batch.swapReceiptIds || []).map(String))
  const sourceUsd = round(Array.from(new Set([...Array.from(sourceIds), ...Array.from(swapIds)])).reduce((sum, id) => {
    const receipt = byId.get(id)
    return sum + (receipt?.direction === "outgoing" ? Number(receipt.amountUsd || 0) : 0)
  }, 0))
  const destinationUsd = round(Array.from(new Set([...Array.from(destinationIds), ...Array.from(swapIds)])).reduce((sum, id) => {
    const receipt = byId.get(id)
    return sum + (receipt?.direction === "incoming" && receipt.chain === "solana" && receipt.asset === "USDC" ? Number(receipt.amountUsd ?? receipt.amount ?? 0) : 0)
  }, 0))
  const estimatedCostUsd = sourceUsd > 0 && destinationUsd > 0 ? round(sourceUsd - destinationUsd) : null
  const ratio = sourceUsd > 0 ? destinationUsd / sourceUsd : 0
  const confidence = sourceUsd > 0 && destinationUsd > 0
    ? ratio >= 0.97 && ratio <= 1.01 ? "high" : ratio >= 0.9 && ratio <= 1.05 ? "medium" : "low"
    : "low"
  return { sourceUsd, destinationUsd, estimatedCostUsd, confidence: confidence as "high" | "medium" | "low" }
}

async function candidateReceipts(batch: any) {
  const db = await getDb()
  const ids = Array.from(new Set([...(batch.sourceReceiptIds || []), ...(batch.destinationReceiptIds || []), ...(batch.swapReceiptIds || [])].map(String)))
  const receipts = await Promise.all(ids.map((id) => db.collection(RECEIPTS).findOne({ _id: id })))
  return receipts.filter(Boolean) as RevenueReceipt[]
}

async function refreshMetrics(batchId: string): Promise<any> {
  const db = await getDb()
  const batch = await db.collection(CANDIDATES).findOne({ _id: batchId }) as RevenueConsolidationCandidate | null
  if (!batch) return null
  const receipts = await candidateReceipts(batch)
  const metrics = consolidationCandidateMetrics(receipts, batch)
  await db.collection(CANDIDATES).updateOne({ _id: batchId }, { $set: { ...metrics, updatedAt: new Date().toISOString() } })
  return { ...(await db.collection(CANDIDATES).findOne({ _id: batchId })), receipts }
}

async function latestOpenCandidate(date: string, at: number) {
  const db = await getDb()
  const batches = await db.collection(CANDIDATES).find({ date, status: { $in: ["collecting", "suggested"] } }).sort({ lastActivityAt: -1 }).toArray()
  return batches.find((batch: any) => isOpen(batch, at)) || null
}

export async function recordPotentialConsolidation(receipt: RevenueReceipt) {
  if ((receipt.walletRole || "revenue") !== "revenue") return { candidate: null, suppressRevenueNotification: false, shouldNotify: false }
  const id = String(receipt._id || "")
  if (!id) return { candidate: null, suppressRevenueNotification: false, shouldNotify: false }
  const date = receipt.date || teamDateKey(0)
  const at = receiptTime(receipt)
  const atIso = new Date(at).toISOString()
  const sameTransactionSwap = receipt.autoClassification === "same_transaction_swap" || receipt.internalReason === "same_transaction_swap"
  const externalSource = receipt.direction === "outgoing"
    && receipt.status === "unclassified"
    && Number(receipt.amountUsd || 0) >= MIN_SOURCE_USD
    && !(receipt.chain === "solana" && receipt.asset === "USDC")
  const solanaUsdcDestination = receipt.direction === "incoming"
    && receipt.chain === "solana"
    && receipt.asset === "USDC"
    && receipt.status === "unclassified"

  if (!sameTransactionSwap && !externalSource && !solanaUsdcDestination) return { candidate: null, suppressRevenueNotification: false, shouldNotify: false }
  const db = await getDb()
  let batch = await latestOpenCandidate(date, at)

  if (externalSource && !batch) {
    const now = new Date().toISOString()
    const result = await db.collection(CANDIDATES).insertOne({
      date,
      status: "collecting",
      sourceReceiptIds: [id],
      destinationReceiptIds: [],
      swapReceiptIds: [],
      sourceUsd: Number(receipt.amountUsd || 0),
      destinationUsd: 0,
      estimatedCostUsd: null,
      confidence: "low",
      firstActivityAt: atIso,
      lastActivityAt: atIso,
      notificationClaimedAt: null,
      notificationSentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    batch = await db.collection(CANDIDATES).findOne({ _id: String(result.insertedId) })
  } else if (externalSource && batch) {
    await db.collection(CANDIDATES).updateOne({ _id: batch._id }, { $set: { sourceReceiptIds: appendUnique(batch.sourceReceiptIds, id), lastActivityAt: atIso, updatedAt: new Date().toISOString() } })
  }

  if (sameTransactionSwap && batch) {
    await db.collection(CANDIDATES).updateOne({ _id: batch._id }, { $set: { swapReceiptIds: appendUnique(batch.swapReceiptIds, id), lastActivityAt: atIso, updatedAt: new Date().toISOString() } })
  }

  let shouldNotify = false
  if (solanaUsdcDestination && batch && (batch.sourceReceiptIds || []).length) {
    // Claim one Telegram review card for the batch. A later destination can
    // retry the notification if the earlier send failed and released its claim.
    const claimNotification = !batch.notificationClaimedAt && !batch.notificationSentAt
    const now = new Date().toISOString()
    await db.collection(RECEIPTS).updateOne({ _id: id }, { $set: { notificationSuppressedReason: "consolidation_candidate", consolidationBatchId: String(batch._id), updatedAt: now } })
    await db.collection(CANDIDATES).updateOne(
      { _id: batch._id },
      { $set: { destinationReceiptIds: appendUnique(batch.destinationReceiptIds, id), status: "suggested", lastActivityAt: atIso, ...(claimNotification ? { notificationClaimedAt: now } : {}), updatedAt: now } },
    )
    shouldNotify = claimNotification
  }

  if (!batch) return { candidate: null, suppressRevenueNotification: false, shouldNotify: false }
  const refreshed = await refreshMetrics(String(batch._id))
  return { candidate: refreshed, suppressRevenueNotification: solanaUsdcDestination, shouldNotify }
}

export async function markConsolidationCandidateNotified(batchId: string) {
  const db = await getDb()
  await db.collection(CANDIDATES).updateOne({ _id: batchId }, { $set: { notificationSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() } })
}

export async function releaseConsolidationCandidateNotificationClaim(batchId: string) {
  const db = await getDb()
  const batch = await db.collection(CANDIDATES).findOne({ _id: batchId })
  if (!batch || batch.notificationSentAt) return
  await db.collection(CANDIDATES).updateOne(
    { _id: batchId },
    { $set: { notificationClaimedAt: null, updatedAt: new Date().toISOString() } },
  )
}

export async function getConsolidationCandidate(batchId: string) {
  return refreshMetrics(batchId)
}

export async function listConsolidationCandidates(date = teamDateKey(0)) {
  const db = await getDb()
  const batches = await db.collection(CANDIDATES).find({ date }).sort({ lastActivityAt: -1 }).toArray()
  const result = []
  for (const batch of batches) {
    const receipts = await candidateReceipts(batch)
    result.push({ ...batch, ...consolidationCandidateMetrics(receipts, batch as RevenueConsolidationCandidate), receipts })
  }
  return result.filter(Boolean)
}

export async function confirmConsolidationCandidate(batchId: string, telegramId?: number | null) {
  const db = await getDb()
  const batch = await db.collection(CANDIDATES).findOne({ _id: batchId }) as RevenueConsolidationCandidate | null
  if (!batch) throw new Error("Consolidation batch was not found")
  if (batch.status === "confirmed") return refreshMetrics(batchId)
  if (batch.status === "rejected") throw new Error("This consolidation batch was already rejected")
  if (!(batch.destinationReceiptIds || []).length) throw new Error("This batch has no Solana USDC arrivals")
  const receipts = await candidateReceipts(batch)
  const byId = new Map(receipts.map((receipt) => [String(receipt._id || ""), receipt]))
  for (const id of batch.sourceReceiptIds || []) {
    const receipt = byId.get(String(id))
    if (!receipt || receipt.direction !== "outgoing" || (receipt.walletRole || "revenue") !== "revenue") throw new Error("A source movement is no longer valid")
    if ((receipt.allocations || []).length || receipt.proposedFeeEventId) throw new Error("A source movement is already attached to revenue")
  }
  for (const id of batch.destinationReceiptIds || []) {
    const receipt = byId.get(String(id))
    if (!receipt || receipt.direction !== "incoming" || receipt.chain !== "solana" || receipt.asset !== "USDC") throw new Error("A destination receipt is no longer valid")
    if ((receipt.allocations || []).length || receipt.proposedFeeEventId || !["unclassified", "internal"].includes(receipt.status)) throw new Error("A destination receipt is already classified")
  }
  const now = new Date().toISOString()
  for (const id of Array.from(new Set([...(batch.sourceReceiptIds || []), ...(batch.destinationReceiptIds || [])].map(String)))) {
    await db.collection(RECEIPTS).updateOne({ _id: id }, { $set: { status: "internal", consolidationBatchId: batchId, internalReason: "privacy_consolidation", notificationSuppressedReason: null, updatedAt: now } })
  }
  await db.collection(CANDIDATES).updateOne({ _id: batchId }, { $set: { status: "confirmed", confirmedAt: now, confirmedByTelegramId: telegramId || null, updatedAt: now } })
  return refreshMetrics(batchId)
}

export async function rejectConsolidationCandidate(batchId: string, telegramId?: number | null) {
  const db = await getDb()
  const batch = await db.collection(CANDIDATES).findOne({ _id: batchId }) as RevenueConsolidationCandidate | null
  if (!batch) throw new Error("Consolidation batch was not found")
  if (batch.status === "confirmed") throw new Error("Confirmed consolidation cannot be rejected")
  const now = new Date().toISOString()
  for (const id of batch.destinationReceiptIds || []) {
    const receipt = await db.collection(RECEIPTS).findOne({ _id: id })
    if (receipt?.consolidationBatchId === batchId && receipt.status === "unclassified") {
      await db.collection(RECEIPTS).updateOne({ _id: id }, { $set: { consolidationBatchId: null, notificationSuppressedReason: null, updatedAt: now } })
    }
  }
  await db.collection(CANDIDATES).updateOne({ _id: batchId }, { $set: { status: "rejected", rejectedAt: now, rejectedByTelegramId: telegramId || null, updatedAt: now } })
  return refreshMetrics(batchId)
}

export async function removeReceiptFromConsolidationCandidate(batchId: string, receiptId: string) {
  const db = await getDb()
  const batch = await db.collection(CANDIDATES).findOne({ _id: batchId }) as RevenueConsolidationCandidate | null
  if (!batch) throw new Error("Consolidation batch was not found")
  if (!["collecting", "suggested"].includes(batch.status)) throw new Error("Only an open consolidation batch can be edited")
  const now = new Date().toISOString()
  const sourceReceiptIds = (batch.sourceReceiptIds || []).map(String).filter((id) => id !== receiptId)
  const destinationReceiptIds = (batch.destinationReceiptIds || []).map(String).filter((id) => id !== receiptId)
  const swapReceiptIds = (batch.swapReceiptIds || []).map(String).filter((id) => id !== receiptId)
  await db.collection(CANDIDATES).updateOne({ _id: batchId }, { $set: { sourceReceiptIds, destinationReceiptIds, swapReceiptIds, updatedAt: now } })
  const receipt = await db.collection(RECEIPTS).findOne({ _id: receiptId })
  if (receipt?.consolidationBatchId === batchId && receipt.status === "unclassified") {
    await db.collection(RECEIPTS).updateOne({ _id: receiptId }, { $set: { consolidationBatchId: null, notificationSuppressedReason: null, updatedAt: now } })
  }
  return refreshMetrics(batchId)
}
