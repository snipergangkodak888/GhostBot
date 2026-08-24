import { getDb } from "@/lib/db"
import { teamDateKey } from "@/lib/team-timezone"
import type { RevenueReceipt } from "@/lib/revenue-types"

const FEES = "revenueFeeEvents"
const RECEIPTS = "revenueReceipts"
const BATCHES = "revenueConsolidationBatches"
const round = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

function originalUsd(fee: any) {
  return Number(fee.preConsolidationUsd ?? fee.recognizedUsd ?? 0)
}

export function consolidationPairMatches(left: Pick<RevenueReceipt, "chain" | "asset" | "direction" | "transactionHash" | "amount" | "walletRole">, right: Pick<RevenueReceipt, "chain" | "asset" | "direction" | "transactionHash" | "amount" | "walletRole">) {
  const revenue = (left.walletRole || "revenue") === "revenue" ? left : right
  const treasury = left.walletRole === "treasury" ? left : right
  const tolerance = Math.max(0.000001, Math.max(Number(left.amount || 0), Number(right.amount || 0)) * 0.000000001)
  return left.chain === "solana"
    && right.chain === "solana"
    && left.asset === "USDC"
    && right.asset === "USDC"
    && (revenue.walletRole || "revenue") === "revenue"
    && treasury.walletRole === "treasury"
    && revenue.direction === "outgoing"
    && treasury.direction === "incoming"
    && left.transactionHash === right.transactionHash
    && Math.abs(Number(left.amount || 0) - Number(right.amount || 0)) <= tolerance
}

export async function reconcileConsolidationReceipt(receipt: RevenueReceipt) {
  if (receipt.chain !== "solana" || receipt.asset !== "USDC") return { matched: false as const }
  const role = receipt.walletRole || "revenue"
  if (!((role === "treasury" && receipt.direction === "incoming") || (role === "revenue" && receipt.direction === "outgoing"))) return { matched: false as const }
  const db = await getDb()
  const partner = await db.collection(RECEIPTS).findOne({
    chain: "solana",
    asset: "USDC",
    transactionHash: receipt.transactionHash,
    walletRole: role === "treasury" ? "revenue" : "treasury",
    direction: role === "treasury" ? "outgoing" : "incoming",
  }) as RevenueReceipt | null
  if (!partner || !consolidationPairMatches(receipt, partner)) return { matched: false as const }
  const treasury = role === "treasury" ? receipt : partner
  const revenue = role === "revenue" ? receipt : partner
  const date = treasury.date || revenue.date || teamDateKey(0)
  const now = new Date().toISOString()
  const revenueMovements = await db.collection(RECEIPTS).find({
    chain: "solana",
    transactionHash: treasury.transactionHash,
    walletRole: "revenue",
    direction: "outgoing",
  }).toArray()
  await Promise.all([
    db.collection(RECEIPTS).updateOne({ _id: treasury._id }, { $set: { status: "internal", autoClassification: "treasury_transfer", internalReason: "treasury_transfer", consolidationMatched: true, pairedReceiptId: String(revenue._id || ""), consolidationDate: date, amountUsd: Number(treasury.amount), valuationStatus: "valued", updatedAt: now } }),
    ...revenueMovements.map((movement: any) => db.collection(RECEIPTS).updateOne(
      { _id: movement._id },
      { $set: { status: "internal", autoClassification: "treasury_transfer", internalReason: movement.asset === "USDC" ? "treasury_transfer" : "network_fee", consolidationMatched: true, pairedReceiptId: String(treasury._id || ""), consolidationDate: date, updatedAt: now } },
    )),
  ])
  return { matched: true as const, date, amount: Number(treasury.amount), treasuryReceiptId: String(treasury._id || ""), revenueReceiptId: String(revenue._id || ""), transactionHash: treasury.transactionHash }
}

async function detectedTreasuryConsolidation(date: string) {
  const db = await getDb()
  const receipts = await db.collection(RECEIPTS).find({
    date,
    chain: "solana",
    walletRole: "treasury",
    direction: "incoming",
    asset: "USDC",
    status: "internal",
    consolidationMatched: true,
  }).toArray()
  return {
    detectedTreasuryUsdc: round(receipts.reduce((sum: number, receipt: any) => sum + Number(receipt.amount || 0), 0)),
    detectedTreasuryReceiptIds: receipts.map((receipt: any) => String(receipt._id)),
    detectedTreasuryTransactions: Array.from(new Set(receipts.map((receipt: any) => String(receipt.transactionHash || "")).filter(Boolean))),
  }
}

export async function getConsolidation(date = teamDateKey(0)) {
  const db = await getDb()
  const [batch, detected] = await Promise.all([
    db.collection(BATCHES).findOne({ date }),
    detectedTreasuryConsolidation(date),
  ])
  if (!batch && !detected.detectedTreasuryReceiptIds.length) return null
  return { date, status: "detected", ...(batch || {}), ...detected }
}

export async function previewConsolidation(date: string, finalUsdcInput: number) {
  const finalUsdc = round(Number(finalUsdcInput))
  if (!Number.isFinite(finalUsdc) || finalUsdc < 0) throw new Error("Final Solana USDC amount must be zero or greater")
  const db = await getDb()
  const [allFees, receipts, detected] = await Promise.all([
    db.collection(FEES).find({ date }).toArray(),
    db.collection(RECEIPTS).find({ date, direction: "incoming" }).toArray(),
    detectedTreasuryConsolidation(date),
  ])
  const fees = allFees.filter((fee: any) => fee.status === "confirmed")
  const unresolvedFees = allFees.filter((fee: any) => !["confirmed", "waived", "ignored"].includes(fee.status))
  const unclassifiedIncomingReceipts = receipts.filter((receipt: any) => ["unclassified", "match_proposed"].includes(receipt.status))
  const pendingValuation = fees.filter((fee: any) => fee.recognizedUsd == null || fee.valuationStatus === "pending")
  const liquidations = fees.filter((fee: any) => fee.feeType === "liquidation")
  const protectedFees = fees.filter((fee: any) => fee.feeType !== "liquidation")
  const rawTotalUsd = round(fees.reduce((sum: number, fee: any) => sum + originalUsd(fee), 0))
  const protectedUsd = round(protectedFees.reduce((sum: number, fee: any) => sum + originalUsd(fee), 0))
  const liquidationUsd = round(liquidations.reduce((sum: number, fee: any) => sum + originalUsd(fee), 0))
  const adjustedLiquidationUsd = round(finalUsdc - protectedUsd)
  const discrepancyUsd = round(finalUsdc - rawTotalUsd)

  const adjustments = liquidations.map((fee: any, index: number) => {
    const baseUsd = originalUsd(fee)
    const nextUsd = liquidationUsd > 0 ? round(adjustedLiquidationUsd * baseUsd / liquidationUsd) : 0
    return { feeEventId: String(fee._id), projectId: fee.projectId || null, projectName: fee.projectName || "", baseUsd, finalUsd: nextUsd, adjustmentUsd: round(nextUsd - baseUsd), index }
  })
  if (adjustments.length) {
    const distributed = round(adjustments.reduce((sum, row) => sum + row.finalUsd, 0))
    const remainder = round(adjustedLiquidationUsd - distributed)
    adjustments[0].finalUsd = round(adjustments[0].finalUsd + remainder)
    adjustments[0].adjustmentUsd = round(adjustments[0].finalUsd - adjustments[0].baseUsd)
  }

  return {
    date,
    finalUsdc,
    rawTotalUsd,
    protectedUsd,
    liquidationUsd,
    adjustedLiquidationUsd,
    discrepancyUsd,
    ...detected,
    pendingValuation: pendingValuation.length,
    unresolvedFees: unresolvedFees.length,
    unclassifiedIncomingReceipts: unclassifiedIncomingReceipts.length,
    canConfirm: pendingValuation.length === 0 && unresolvedFees.length === 0 && unclassifiedIncomingReceipts.length === 0 && adjustedLiquidationUsd >= 0 && (liquidationUsd > 0 || discrepancyUsd === 0),
    adjustments: adjustments.map(({ index: _index, ...row }) => row),
  }
}

export async function saveConsolidationPreview(date: string, finalUsdc: number) {
  const preview = await previewConsolidation(date, finalUsdc)
  const db = await getDb()
  const existing = await db.collection(BATCHES).findOne({ date })
  if (existing?.status === "confirmed") throw new Error("This day is already finalized")
  const now = new Date()
  await db.collection(BATCHES).updateOne(
    { date },
    { $set: { ...preview, status: "review", updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )
  return db.collection(BATCHES).findOne({ date })
}

export async function confirmConsolidation(date: string) {
  const db = await getDb()
  const batch = await db.collection(BATCHES).findOne({ date })
  if (!batch || batch.status !== "review") throw new Error("Preview the final Solana USDC amount first")
  if (!batch.canConfirm) {
    if (batch.unresolvedFees) throw new Error("Resolve every fee expectation before finalizing")
    if (batch.unclassifiedIncomingReceipts) throw new Error("Classify every incoming receipt before finalizing")
    if (batch.pendingValuation) throw new Error("Value all confirmed receipts before finalizing")
    throw new Error("Final USDC cannot be reconciled without reducing protected fixed fees")
  }
  const now = new Date()
  for (const row of batch.adjustments || []) {
    const fee = await db.collection(FEES).findOne({ _id: row.feeEventId })
    if (!fee) continue
    await db.collection(FEES).updateOne(
      { _id: row.feeEventId },
      { $set: { preConsolidationUsd: originalUsd(fee), recognizedUsd: Number(row.finalUsd), consolidationAdjustmentUsd: Number(row.adjustmentUsd), consolidationDate: date, updatedAt: now.toISOString() } },
    )
  }
  await db.collection(BATCHES).updateOne({ date }, { $set: { status: "confirmed", confirmedAt: now, updatedAt: now } })
  return db.collection(BATCHES).findOne({ date })
}
