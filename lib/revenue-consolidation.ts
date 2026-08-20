import { getDb } from "@/lib/db"
import { teamDateKey } from "@/lib/team-timezone"

const FEES = "revenueFeeEvents"
const RECEIPTS = "revenueReceipts"
const BATCHES = "revenueConsolidationBatches"
const round = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

function originalUsd(fee: any) {
  return Number(fee.preConsolidationUsd ?? fee.recognizedUsd ?? 0)
}

export async function getConsolidation(date = teamDateKey(0)) {
  const db = await getDb()
  return db.collection(BATCHES).findOne({ date })
}

export async function previewConsolidation(date: string, finalUsdcInput: number) {
  const finalUsdc = round(Number(finalUsdcInput))
  if (!Number.isFinite(finalUsdc) || finalUsdc < 0) throw new Error("Final Solana USDC amount must be zero or greater")
  const db = await getDb()
  const [allFees, receipts] = await Promise.all([
    db.collection(FEES).find({ date }).toArray(),
    db.collection(RECEIPTS).find({ date, direction: "incoming" }).toArray(),
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
