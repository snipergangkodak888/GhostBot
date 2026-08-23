import { createHash } from "node:crypto"
import { getDb } from "@/lib/db"
import { dateKeyInTimeZone, teamDateKey } from "@/lib/team-timezone"
import { findReceiptCombination } from "@/lib/revenue-matching"
import { normalizedMessageFingerprint, parseFeeMessage } from "@/lib/revenue-parser"
import { projectFeeConfig } from "@/lib/revenue-projects"
import type {
  FeeType,
  RevenueFeeEvent,
  RevenueReceipt,
  RevenueReceiptStatus,
} from "@/lib/revenue-types"
import { getConsolidation } from "@/lib/revenue-consolidation"
import { valueRevenueReceipt } from "@/lib/revenue-pricing"

const FEES = "revenueFeeEvents"
const RECEIPTS = "revenueReceipts"

function iso(value = new Date()) {
  return value.toISOString()
}

function round(value: number, decimals = 8) {
  const factor = 10 ** decimals
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor
}

function stableAsset(asset: unknown) {
  return ["USD", "USDC"].includes(String(asset || "").toUpperCase())
}

function sourceFingerprint(chatId: number | string, messageId: number, text: string) {
  return createHash("sha256")
    .update(`${chatId}:${messageId}:${normalizedMessageFingerprint(text)}`)
    .digest("hex")
}

export async function createForwardedFeeEvent(params: {
  chatId: number | string
  messageId: number
  text: string
  telegramId?: number | null
  messageDate?: Date
}) {
  const db = await getDb()
  const sourceKey = `telegram:${params.chatId}:${params.messageId}`
  const existing = await db.collection(FEES).findOne({ sourceKey })
  if (existing) return { fee: existing as RevenueFeeEvent, duplicate: true }

  const now = new Date()
  const occurredAt = params.messageDate || now
  const parsed = parseFeeMessage(params.text)
  const fee: RevenueFeeEvent = {
    date: dateKeyInTimeZone(occurredAt),
    source: "telegram_forward",
    sourceKey,
    telegram: {
      chatId: String(params.chatId),
      messageId: params.messageId,
      forwardedByTelegramId: params.telegramId || null,
      originalText: params.text,
      originalDate: occurredAt.toISOString(),
    },
    occurredAt: occurredAt.toISOString(),
    projectId: null,
    projectName: null,
    chain: null,
    quoteAsset: parsed.grossAsset && parsed.grossAsset !== "USD" ? parsed.grossAsset : null,
    feeType: parsed.feeType,
    grossAmount: parsed.grossAmount,
    grossAsset: parsed.grossAsset,
    expectedAssetAmount: parsed.expectedAssetAmount,
    expectedUsd: parsed.expectedUsd,
    recognizedUsd: parsed.expectedUsd,
    valuationStatus: parsed.expectedUsd != null ? "valued" : "pending",
    liquidationPercentage: parsed.feeType === "liquidation" ? 5 : null,
    status: "awaiting_project",
    matchedReceiptIds: [],
    proposedReceiptIds: [],
    parse: parsed,
    createdByTelegramId: params.telegramId || null,
    createdAt: iso(now),
    updatedAt: iso(now),
  }
  const result = await db.collection(FEES).insertOne({ ...fee, sourceFingerprint: sourceFingerprint(params.chatId, params.messageId, params.text) })
  return { fee: { ...fee, _id: String(result.insertedId) }, duplicate: false }
}

function resolvedQuoteAsset(parsedAsset: string | null | undefined, quoteAssets: string[]) {
  const asset = String(parsedAsset || "").toUpperCase()
  if (asset && asset !== "USD" && quoteAssets.includes(asset)) return asset
  return quoteAssets.length === 1 ? quoteAssets[0] : null
}

export async function assignFeeProject(feeId: string, projectId: string) {
  const db = await getDb()
  const [fee, project] = await Promise.all([
    db.collection(FEES).findOne({ _id: feeId }),
    db.collection("opsProjects").findOne({ _id: projectId }),
  ])
  if (!fee) throw new Error("Fee entry was not found")
  if (!project) throw new Error("Project was not found")
  if (project.status === "inactive") throw new Error("Inactive projects cannot receive new fee entries")

  const config = projectFeeConfig(project)
  if (!config.chain) throw new Error("Set the project's revenue chain before assigning fees")
  if (!fee.feeType) throw new Error("The fee type was not recognized; classify it from Revenue Inbox")
  const explicitAsset = String(fee.grossAsset || fee.quoteAsset || "").toUpperCase()
  if (explicitAsset && explicitAsset !== "USD" && !config.quoteAssets.includes(explicitAsset)) {
    throw new Error(`${project.name || "This project"} is not configured to receive ${explicitAsset} revenue`)
  }
  if (fee.source === "telegram_forward" && fee.feeType === "daily_trading") {
    const scheduled = await db.collection(FEES).findOne({ sourceKey: `daily:${fee.date}:${project._id}` })
    if (scheduled) {
      await db.collection(FEES).updateOne({ _id: feeId }, { $set: { status: "ignored", duplicateOfFeeId: String(scheduled._id), projectId: String(project._id), projectName: String(project.name || ""), updatedAt: iso() } })
      return scheduled as RevenueFeeEvent
    }
  }

  const quoteAsset = resolvedQuoteAsset(fee.grossAsset || fee.quoteAsset, config.quoteAssets)
  let expectedAssetAmount = fee.expectedAssetAmount == null ? null : Number(fee.expectedAssetAmount)
  let expectedUsd = fee.expectedUsd == null ? null : Number(fee.expectedUsd)
  let liquidationPercentage: number | null = null

  if (fee.feeType === "liquidation") {
    if (!config.liquidationFeeEnabled) throw new Error("Liquidation fees are disabled for this project")
    liquidationPercentage = config.liquidationFeePercentage
    if (fee.grossAmount == null) throw new Error("The gross cashout amount is missing")
    expectedAssetAmount = round(Number(fee.grossAmount) * liquidationPercentage / 100)
    expectedUsd = stableAsset(fee.grossAsset) ? round(expectedAssetAmount, 2) : null
  } else if (fee.feeType === "daily_trading") {
    expectedAssetAmount = quoteAsset === "USDC" ? config.dailyTradingFeeUsd : null
    expectedUsd = config.dailyTradingFeeUsd
  } else if (fee.feeType === "launch") {
    expectedAssetAmount = quoteAsset === "USDC" ? config.launchFeeUsd : null
    expectedUsd = config.launchFeeUsd
  }

  const status = quoteAsset ? "awaiting_confirmation" : "awaiting_asset"
  const update = {
    projectId: String(project._id),
    projectName: String(project.name || ""),
    chain: config.chain,
    quoteAsset,
    expectedAssetAmount,
    expectedUsd,
    recognizedUsd: expectedUsd,
    valuationStatus: expectedUsd != null ? "valued" : "pending",
    liquidationPercentage,
    status,
    updatedAt: iso(),
  }
  await db.collection(FEES).updateOne({ _id: feeId }, { $set: update })
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

export async function setFeeQuoteAsset(feeId: string, assetInput: string) {
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId })
  if (!fee?.projectId) throw new Error("Select a project first")
  const project = await db.collection("opsProjects").findOne({ _id: fee.projectId })
  const config = projectFeeConfig(project)
  const asset = String(assetInput || "").trim().toUpperCase()
  if (!config.quoteAssets.includes(asset)) throw new Error(`${asset} is not configured for this project`)

  let expectedAssetAmount = fee.expectedAssetAmount ?? null
  if ((fee.feeType === "daily_trading" || fee.feeType === "launch") && asset === "USDC") {
    expectedAssetAmount = Number(fee.expectedUsd || 0)
  }
  await db.collection(FEES).updateOne(
    { _id: feeId },
    { $set: { quoteAsset: asset, expectedAssetAmount, status: "awaiting_confirmation", updatedAt: iso() } },
  )
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

export async function setFeeType(feeId: string, feeType: FeeType) {
  if (!["liquidation", "daily_trading", "launch", "dev_allocation", "fee_collector", "fee_rebate", "other"].includes(feeType)) throw new Error("Unsupported fee type")
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId })
  if (!fee) throw new Error("Fee entry was not found")
  await db.collection(FEES).updateOne(
    { _id: feeId },
    { $set: { feeType, status: fee.projectId ? "awaiting_asset" : "awaiting_project", updatedAt: iso() } },
  )
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

export async function getRevenueFee(feeId: string) {
  const db = await getDb()
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent | null>
}

export async function getRevenueReceipt(receiptId: string) {
  const db = await getDb()
  return db.collection(RECEIPTS).findOne({ _id: receiptId }) as Promise<RevenueReceipt | null>
}

export async function resolveFeeWithoutRevenue(feeId: string, status: "ignored" | "waived") {
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId })
  if (!fee) throw new Error("Fee entry was not found")
  if (fee.status === "confirmed") throw new Error("Confirmed revenue cannot be ignored or waived")
  for (const receiptId of fee.proposedReceiptIds || []) {
    const receipt = await db.collection(RECEIPTS).findOne({ _id: receiptId })
    if (receipt?.proposedFeeEventId === feeId && !(receipt.allocations || []).length) {
      await db.collection(RECEIPTS).updateOne({ _id: receiptId }, { $set: { status: "unclassified", proposedFeeEventId: null, updatedAt: iso() } })
    }
  }
  await db.collection(FEES).updateOne(
    { _id: feeId },
    { $set: { status, proposedReceiptIds: [], matchAlternatives: [], resolvedWithoutRevenueAt: iso(), updatedAt: iso() } },
  )
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

export async function createFeeFromReceipts(params: { receiptIds: string[]; feeType: FeeType; projectId?: string | null; amount?: number | null }) {
  const db = await getDb()
  const receiptIds = Array.from(new Set((params.receiptIds || []).map(String).filter(Boolean)))
  if (!receiptIds.length) throw new Error("Choose at least one incoming receipt")
  const receipts = await Promise.all(receiptIds.map((receiptId) => db.collection(RECEIPTS).findOne({ _id: receiptId })))
  if (receipts.some((receipt) => !receipt || receipt.direction !== "incoming")) throw new Error("One or more incoming receipts were not found")
  const [receipt] = receipts as any[]
  if (receipts.some((row: any) => row.chain !== receipt.chain || row.asset !== receipt.asset)) throw new Error("Grouped receipts must use the same chain and asset")
  if (receipts.some((row: any) => row.status !== "unclassified")) throw new Error("One or more receipts are already classified or reserved")
  if (!["daily_trading", "dev_allocation", "fee_collector", "fee_rebate", "other"].includes(params.feeType)) throw new Error("Use a forwarded message for this fee type")
  const projectRequired = params.feeType !== "fee_rebate"
  const project = params.projectId ? await db.collection("opsProjects").findOne({ _id: params.projectId }) : null
  if (projectRequired && !project) throw new Error("Choose an existing project")
  if (project) {
    const config = projectFeeConfig(project)
    if (config.chain !== receipt.chain || !config.quoteAssets.includes(receipt.asset)) throw new Error("Project chain or quote asset does not match this receipt")
  }
  if (params.feeType === "daily_trading") {
    const date = receipt.date || dateKeyInTimeZone(new Date(receipt.blockTime || iso()))
    if (receipts.some((row: any) => (row.date || dateKeyInTimeZone(new Date(row.blockTime || iso()))) !== date)) throw new Error("Daily fee receipts must be from the same accounting day")
    await ensureDailyTradingFeeExpectations(date)
    const dailyFee = await db.collection(FEES).findOne({ sourceKey: `daily:${date}:${project?._id}` })
    if (!dailyFee) throw new Error("This project is not eligible for a daily trading fee on this date")
    if (dailyFee.status === "confirmed") throw new Error(`${project?.name || "This project"}'s $500 daily trading fee is already confirmed for ${date}`)
    if (["ignored", "waived"].includes(dailyFee.status)) throw new Error("This daily trading fee was already ignored or waived")
    if (dailyFee.quoteAsset && dailyFee.quoteAsset !== receipt.asset) throw new Error(`This daily trading fee is waiting for ${dailyFee.quoteAsset}, not ${receipt.asset}`)
    const selectedUsd = receipts.reduce((sum: number, row: any) => {
      const available = receiptAvailableAmount(row)
      return sum + (row.amountUsd == null ? 0 : Number(row.amountUsd) * available / Math.max(Number(row.amount || 0), Number.EPSILON))
    }, 0)
    if (receipts.some((row: any) => row.amountUsd == null)) throw new Error("Value the selected receipt(s) in USD before applying the daily fee")
    const expectedUsd = Number(dailyFee.expectedUsd || projectFeeConfig(project).dailyTradingFeeUsd || 500)
    const allowedUsdVariance = Math.max(2, expectedUsd * 0.05)
    if (Math.abs(selectedUsd - expectedUsd) > allowedUsdVariance) throw new Error(`Selected receipts must be within ${allowedUsdVariance.toLocaleString("en-US", { style: "currency", currency: "USD" })} of the $${expectedUsd.toFixed(0)} daily fee`)
    for (const previousId of dailyFee.proposedReceiptIds || []) {
      const previous = await db.collection(RECEIPTS).findOne({ _id: previousId })
      if (previous?.proposedFeeEventId === String(dailyFee._id) && !(previous.allocations || []).length) {
        await db.collection(RECEIPTS).updateOne({ _id: previousId }, { $set: { status: "unclassified", proposedFeeEventId: null, updatedAt: iso() } })
      }
    }
    const now = iso()
    const feeId = String(dailyFee._id)
    await db.collection(FEES).updateOne(
      { _id: feeId },
      { $set: { quoteAsset: receipt.asset, expectedAssetAmount: receipt.asset === "USDC" ? expectedUsd : null, proposedReceiptIds: receiptIds, matchAlternatives: [], matchConfidence: Math.abs(selectedUsd - expectedUsd) <= Math.max(2, expectedUsd * 0.005) ? "high" : "medium", matchDelta: round(Math.abs(selectedUsd - expectedUsd), 2), manualReceiptSelection: true, status: "match_proposed", updatedAt: now } },
    )
    for (const row of receipts as any[]) {
      await db.collection(RECEIPTS).updateOne({ _id: row._id }, { $set: { status: "match_proposed", proposedFeeEventId: feeId, updatedAt: now } })
    }
    return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
  }
  const available = receipts.reduce((sum: number, row: any) => sum + receiptAvailableAmount(row), 0)
  const expectedAssetAmount = params.amount == null ? available : Number(params.amount)
  if (!Number.isFinite(expectedAssetAmount) || expectedAssetAmount <= 0 || expectedAssetAmount > available + 0.00000001) throw new Error("Classified amount must fit within the selected receipts")
  let remaining = expectedAssetAmount
  let expectedUsd = 0
  let fullyValued = true
  for (const row of receipts as any[]) {
    const take = Math.min(receiptAvailableAmount(row), remaining)
    if (take <= 0) continue
    if (row.amountUsd == null) fullyValued = false
    else expectedUsd += Number(row.amountUsd) * take / Math.max(Number(row.amount || 0), Number.EPSILON)
    remaining -= take
  }
  const receiptFingerprint = createHash("sha256").update(receiptIds.slice().sort().join(":")).digest("hex").slice(0, 16)
  const sourceKey = `receipts:${receiptFingerprint}:${params.feeType}:${project?._id || "global"}:${round(expectedAssetAmount)}`
  const existing = await db.collection(FEES).findOne({ sourceKey })
  if (existing) return existing as RevenueFeeEvent
  const now = iso()
  const parsed = parseFeeMessage(`${expectedAssetAmount} ${receipt.asset} ${params.feeType.replace(/_/g, " ")}`)
  const fee: RevenueFeeEvent = {
    date: receipt.date || dateKeyInTimeZone(new Date(receipt.blockTime || now)),
    occurredAt: receipt.blockTime || receipt.createdAt || now,
    source: "manual",
    sourceKey,
    projectId: project ? String(project._id) : null,
    projectName: project ? String(project.name || "") : params.feeType === "fee_rebate" ? "Fee rebate" : null,
    chain: receipt.chain,
    quoteAsset: receipt.asset,
    feeType: params.feeType,
    expectedAssetAmount,
    expectedUsd: fullyValued ? round(expectedUsd, 2) : null,
    recognizedUsd: fullyValued ? round(expectedUsd, 2) : null,
    valuationStatus: fullyValued ? "valued" : "pending",
    status: "match_proposed",
    matchedReceiptIds: [],
    proposedReceiptIds: receiptIds,
    parse: parsed,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection(FEES).insertOne(fee)
  const feeId = String(result.insertedId)
  for (const row of receipts as any[]) {
    await db.collection(RECEIPTS).updateOne({ _id: row._id }, { $set: { status: "match_proposed", proposedFeeEventId: feeId, updatedAt: now } })
  }
  return { ...fee, _id: feeId }
}

export async function createFeeFromReceipt(params: { receiptId: string; feeType: FeeType; projectId?: string | null; amount?: number | null }) {
  return createFeeFromReceipts({ ...params, receiptIds: [params.receiptId] })
}

export async function confirmFeeExpectation(feeId: string, telegramId?: number | null) {
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId })
  if (!fee) throw new Error("Fee entry was not found")
  if (!fee.projectId || !fee.chain || !fee.quoteAsset || !fee.feeType) throw new Error("Project, chain, asset, and fee type are required")
  await db.collection(FEES).updateOne(
    { _id: feeId },
    { $set: { status: "awaiting_receipt", confirmedByTelegramId: telegramId || null, confirmedAt: iso(), updatedAt: iso() } },
  )
  return proposeReceiptMatch(feeId)
}

export async function proposeReceiptMatch(feeId: string) {
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId }) as RevenueFeeEvent | null
  if (!fee || !fee.chain || !fee.quoteAsset) return fee
  if (["confirmed", "ignored", "waived"].includes(fee.status)) return fee
  for (const receiptId of fee.proposedReceiptIds || []) {
    const previous = await db.collection(RECEIPTS).findOne({ _id: receiptId })
    if (previous?.proposedFeeEventId === feeId && !(previous.allocations || []).length) {
      await db.collection(RECEIPTS).updateOne({ _id: receiptId }, { $set: { status: "unclassified", proposedFeeEventId: null, updatedAt: iso() } })
    }
  }
  await db.collection(FEES).updateOne({ _id: feeId }, { $set: { proposedReceiptIds: [], matchAlternatives: [], manualReceiptSelection: false, status: "awaiting_receipt", updatedAt: iso() } })
  const receipts = await db.collection(RECEIPTS).find({ date: fee.date }).sort({ blockTime: -1 }).limit(500).toArray() as RevenueReceipt[]
  const match = findReceiptCombination(receipts, {
    chain: fee.chain,
    asset: fee.quoteAsset,
    expectedAmount: fee.expectedAssetAmount,
    expectedUsd: fee.expectedUsd,
    occurredAt: fee.occurredAt || fee.telegram?.originalDate || fee.createdAt,
    date: fee.date,
  })
  if (!match?.receiptIds.length) return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
  await db.collection(FEES).updateOne(
    { _id: feeId },
    { $set: { proposedReceiptIds: match.receiptIds, matchAlternatives: match.alternatives || [], matchConfidence: match.confidence, matchDelta: match.delta, status: "match_proposed", updatedAt: iso() } },
  )
  for (const receiptId of match.receiptIds) {
    await db.collection(RECEIPTS).updateOne({ _id: receiptId }, { $set: { status: "match_proposed", proposedFeeEventId: feeId, updatedAt: iso() } })
  }
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

function receiptAvailableAmount(receipt: any) {
  const allocated = (receipt.allocations || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
  return Math.max(0, Number(receipt.amount || 0) - allocated)
}

export async function acceptReceiptMatch(feeId: string, telegramId?: number | null, receiptIdsInput?: string[]) {
  const db = await getDb()
  const fee = await db.collection(FEES).findOne({ _id: feeId })
  if (!fee) throw new Error("Fee entry was not found")
  const receiptIds = Array.from(new Set((receiptIdsInput?.length ? receiptIdsInput : fee.proposedReceiptIds || []).map(String)))
  if (!receiptIds.length) throw new Error("Choose at least one receipt")
  const receipts = await Promise.all(receiptIds.map((id) => db.collection(RECEIPTS).findOne({ _id: id })))
  if (receipts.some((receipt) => !receipt)) throw new Error("One or more receipts were not found")
  if (receipts.some((receipt) => receipt.chain !== fee.chain || receipt.asset !== fee.quoteAsset)) throw new Error("Receipt chain or asset does not match the fee")
  if (receipts.some((receipt) => receipt.status === "match_proposed" && receipt.proposedFeeEventId && receipt.proposedFeeEventId !== feeId)) throw new Error("A selected receipt is reserved for another fee")

  const now = iso()
  let remainingAmount = fee.expectedAssetAmount == null ? null : Number(fee.expectedAssetAmount)
  let remainingUsd = remainingAmount == null && fee.expectedUsd != null ? Number(fee.expectedUsd) : null
  let allocatedUsd = 0
  const usedReceiptIds: string[] = []
  const allocationPlan: Array<{ receipt: any; available: number; amount: number; amountUsd: number | null }> = []
  for (const receipt of receipts) {
    const available = receiptAvailableAmount(receipt)
    let allocationAmount = available
    let allocationUsd: number | null = null
    if (remainingAmount != null) {
      allocationAmount = Math.min(available, Math.max(0, remainingAmount))
      remainingAmount = round(Math.max(0, remainingAmount - allocationAmount))
      if (receipt.amountUsd != null) allocationUsd = Number(receipt.amountUsd) * allocationAmount / Math.max(Number(receipt.amount || 0), Number.EPSILON)
    } else if (remainingUsd != null && receipt.amountUsd != null) {
      const availableUsd = Number(receipt.amountUsd) * available / Math.max(Number(receipt.amount || 0), Number.EPSILON)
      const takeUsd = Math.min(availableUsd, Math.max(0, remainingUsd))
      allocationAmount = availableUsd > 0 ? available * takeUsd / availableUsd : 0
      allocationUsd = takeUsd
      remainingUsd = round(Math.max(0, remainingUsd - takeUsd), 2)
    } else if (receipt.amountUsd != null) {
      allocationUsd = Number(receipt.amountUsd) * allocationAmount / Math.max(Number(receipt.amount || 0), Number.EPSILON)
    }
    if (allocationAmount <= 0) continue
    allocatedUsd += Number(allocationUsd || 0)
    usedReceiptIds.push(String(receipt._id))
    allocationPlan.push({ receipt, available, amount: allocationAmount, amountUsd: allocationUsd })
  }

  const unresolved = remainingAmount ?? remainingUsd
  const normalAllowedDelta = remainingAmount != null ? Math.max(0.000001, Number(fee.expectedAssetAmount || 0) * 0.005) : Math.max(2, Number(fee.expectedUsd || 0) * 0.005)
  const manualDailyAllowedDelta = fee.feeType === "daily_trading" && fee.manualReceiptSelection
    ? (remainingAmount != null ? Math.max(0.000001, Number(fee.expectedAssetAmount || 0) * 0.05) : Math.max(2, Number(fee.expectedUsd || 0) * 0.05))
    : 0
  const allowedDelta = Math.max(normalAllowedDelta, manualDailyAllowedDelta)
  if (unresolved != null && unresolved > allowedDelta) throw new Error("Selected receipts do not add up to the expected fee")
  if (!usedReceiptIds.length) throw new Error("Selected receipts have no available amount")

  for (const plan of allocationPlan) {
    const allocations = [...(plan.receipt.allocations || []), { feeEventId: feeId, amount: round(plan.amount), amountUsd: plan.amountUsd == null ? null : round(plan.amountUsd, 2), createdAt: now }]
    const stillAvailable = Math.max(0, plan.available - plan.amount)
    await db.collection(RECEIPTS).updateOne(
      { _id: plan.receipt._id },
      { $set: { allocations, status: stillAvailable > 0.00000001 ? "unclassified" : "allocated", proposedFeeEventId: null, updatedAt: now } },
    )
  }
  for (const receipt of receipts) {
    if (usedReceiptIds.includes(String(receipt._id))) continue
    if (receipt.proposedFeeEventId === feeId && !(receipt.allocations || []).length) {
      await db.collection(RECEIPTS).updateOne(
        { _id: receipt._id },
        { $set: { status: "unclassified", proposedFeeEventId: null, updatedAt: now } },
      )
    }
  }

  let recognizedUsd = fee.expectedUsd == null ? null : Number(fee.expectedUsd)
  if (recognizedUsd == null && usedReceiptIds.length && allocatedUsd > 0) recognizedUsd = round(allocatedUsd, 2)

  await db.collection(FEES).updateOne(
    { _id: feeId },
    {
      $set: {
        matchedReceiptIds: usedReceiptIds,
        proposedReceiptIds: [],
        matchAlternatives: [],
        status: "confirmed",
        recognizedUsd,
        valuationStatus: recognizedUsd == null ? "pending" : "valued",
        confirmedByTelegramId: telegramId || fee.confirmedByTelegramId || null,
        confirmedAt: now,
        updatedAt: now,
      },
    },
  )
  return db.collection(FEES).findOne({ _id: feeId }) as Promise<RevenueFeeEvent>
}

export async function saveRevenueReceipt(input: Omit<RevenueReceipt, "_id" | "createdAt" | "updatedAt">) {
  const db = await getDb()
  const existing = await db.collection(RECEIPTS).findOne({ eventKey: input.eventKey })
  if (existing) return { receipt: existing as RevenueReceipt, duplicate: true }
  const now = iso()
  const receipt = {
    ...input,
    asset: String(input.asset || "").toUpperCase(),
    wallet: String(input.wallet || ""),
    transactionHash: String(input.transactionHash || ""),
    status: (input.status || "unclassified") as RevenueReceiptStatus,
    allocations: input.allocations || [],
    valuationStatus: input.amountUsd == null ? "pending" : "valued",
    date: dateKeyInTimeZone(new Date(input.blockTime || now)),
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection(RECEIPTS).insertOne(receipt)
  const saved = { ...receipt, _id: String(result.insertedId) } as RevenueReceipt

  const waiting = await db.collection(FEES).find({ status: "awaiting_receipt", chain: saved.chain, quoteAsset: saved.asset }).toArray()
  for (const fee of waiting) await proposeReceiptMatch(String(fee._id))
  return { receipt: saved, duplicate: false }
}

export async function updateReceiptClassification(receiptId: string, status: RevenueReceiptStatus, amountUsd?: number | null) {
  if (!["unclassified", "internal", "ignored", "match_proposed", "allocated"].includes(status)) throw new Error("Unsupported receipt classification")
  if (["match_proposed", "allocated"].includes(status) && amountUsd === undefined) throw new Error("Matched receipt status cannot be changed here")
  const db = await getDb()
  const existing = await db.collection(RECEIPTS).findOne({ _id: receiptId })
  if (!existing) throw new Error("Revenue receipt was not found")
  const update: Record<string, any> = { status, updatedAt: iso() }
  if (amountUsd !== undefined) {
    const normalizedAmountUsd = amountUsd == null ? null : Number(amountUsd)
    if (normalizedAmountUsd != null && (!Number.isFinite(normalizedAmountUsd) || normalizedAmountUsd < 0)) throw new Error("USD value must be a positive number")
    update.amountUsd = normalizedAmountUsd
    update.valuationStatus = amountUsd == null ? "pending" : "manual"
    update.priceUsd = normalizedAmountUsd == null ? null : normalizedAmountUsd / Math.max(Number(existing.amount || 0), Number.EPSILON)
    update.priceSource = amountUsd == null ? null : "manual"
    update.priceTimestamp = amountUsd == null ? null : iso()
    update.priceFetchedAt = amountUsd == null ? null : iso()
  }
  await db.collection(RECEIPTS).updateOne({ _id: receiptId }, { $set: update })
  const saved = await db.collection(RECEIPTS).findOne({ _id: receiptId }) as RevenueReceipt | null
  if (saved && amountUsd != null) {
    for (const allocation of saved.allocations || []) {
      const fee = await db.collection(FEES).findOne({ _id: allocation.feeEventId })
      if (!fee || fee.expectedUsd != null) continue
      const receipts = await Promise.all((fee.matchedReceiptIds || []).map((id: string) => db.collection(RECEIPTS).findOne({ _id: id })))
      if (receipts.length && receipts.every((receipt) => receipt?.amountUsd != null)) {
        const recognizedUsd = round(receipts.reduce((sum, receipt: any) => {
          const allocated = (receipt.allocations || []).find((row: any) => row.feeEventId === String(fee._id))
          return sum + Number(receipt.amountUsd || 0) * (Number(allocated?.amount || 0) / Math.max(Number(receipt.amount || 0), Number.EPSILON))
        }, 0), 2)
        await db.collection(FEES).updateOne({ _id: fee._id }, { $set: { recognizedUsd, valuationStatus: "valued", updatedAt: iso() } })
      }
    }
  }
  return saved as RevenueReceipt
}

export async function valuePendingRevenueReceipts(date = teamDateKey(0)) {
  const db = await getDb()
  const receipts = (await db.collection(RECEIPTS).find({ date, direction: "incoming" }).toArray())
    .filter((receipt: any) => receipt.amountUsd == null && ["ETH", "SOL", "BNB"].includes(String(receipt.asset || "").toUpperCase()))
  let valued = 0
  let pending = 0
  for (const receipt of receipts) {
    try {
      const next = await valueRevenueReceipt(receipt)
      if (next.amountUsd == null) {
        pending += 1
        continue
      }
      await updateReceiptClassification(String(receipt._id), receipt.status, Number(next.amountUsd))
      await db.collection(RECEIPTS).updateOne({ _id: receipt._id }, { $set: { priceUsd: next.priceUsd, priceSource: next.priceSource, priceTimestamp: next.priceTimestamp, priceFetchedAt: next.priceFetchedAt, valuationStatus: "valued", updatedAt: iso() } })
      valued += 1
    } catch (error) {
      console.error("[revenue] pending receipt valuation failed", receipt._id, error instanceof Error ? error.message : error)
      pending += 1
    }
  }
  const waitingFees = await db.collection(FEES).find({ date, status: "awaiting_receipt" }).toArray()
  let proposed = 0
  for (const fee of waitingFees) {
    const result = await proposeReceiptMatch(String(fee._id))
    if (result?.status === "match_proposed") proposed += 1
  }
  return { date, checked: receipts.length, valued, pending, retried: waitingFees.length, proposed }
}

function projectEligibleForDailyFee(project: any, date: string) {
  if (project.status !== "active") return false
  const config = projectFeeConfig(project)
  if (!config.chain || !config.dailyTradingFeeEnabled || config.dailyTradingFeeUsd <= 0) return false
  const start = String(project.startDate || project.launchDate || "").slice(0, 10)
  const end = String(project.endDate || "").slice(0, 10)
  if (start && date < start) return false
  if (end && date > end) return false
  return true
}

export async function ensureDailyTradingFeeExpectations(date = teamDateKey(0)) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  let created = 0
  let existing = 0
  for (const project of projects.filter((row) => projectEligibleForDailyFee(row, date))) {
    const sourceKey = `daily:${date}:${project._id}`
    const found = await db.collection(FEES).findOne({ sourceKey })
    if (found) {
      existing += 1
      continue
    }
    const config = projectFeeConfig(project)
    const quoteAsset = config.quoteAssets.length === 1 ? config.quoteAssets[0] : null
    const parsed = parseFeeMessage(`$${config.dailyTradingFeeUsd} daily trading fee`)
    const now = iso()
    const result = await db.collection(FEES).insertOne({
      date,
      source: "daily_schedule",
      sourceKey,
      projectId: String(project._id),
      projectName: String(project.name || ""),
      chain: config.chain,
      quoteAsset,
      feeType: "daily_trading" as FeeType,
      grossAmount: null,
      grossAsset: null,
      expectedAssetAmount: quoteAsset === "USDC" ? config.dailyTradingFeeUsd : null,
      expectedUsd: config.dailyTradingFeeUsd,
      recognizedUsd: config.dailyTradingFeeUsd,
      valuationStatus: "valued",
      liquidationPercentage: null,
      status: quoteAsset ? "awaiting_receipt" : "awaiting_asset",
      matchedReceiptIds: [],
      proposedReceiptIds: [],
      parse: parsed,
      createdAt: now,
      updatedAt: now,
    })
    if (quoteAsset) await proposeReceiptMatch(String(result.insertedId))
    created += 1
  }
  return { date, eligible: created + existing, created, existing }
}

export async function listRevenueDay(date = teamDateKey(0)) {
  const db = await getDb()
  const [fees, receipts, projects, consolidation] = await Promise.all([
    db.collection(FEES).find({ date }).sort({ createdAt: -1 }).toArray(),
    db.collection(RECEIPTS).find({ date }).sort({ blockTime: -1, createdAt: -1 }).limit(250).toArray(),
    db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ name: 1 }).toArray(),
    getConsolidation(date),
  ])
  const dayReceipts = receipts
  return {
    date,
    fees,
    receipts: dayReceipts,
    projects,
    consolidation,
    summary: {
      fees: fees.length,
      confirmedFees: fees.filter((fee: any) => fee.status === "confirmed").length,
      unresolvedFees: fees.filter((fee: any) => !["confirmed", "waived", "ignored"].includes(fee.status)).length,
      receipts: dayReceipts.length,
      unclassifiedReceipts: dayReceipts.filter((receipt: any) => receipt.status === "unclassified" && receipt.direction === "incoming").length,
      recognizedUsd: round(fees.filter((fee: any) => fee.status === "confirmed").reduce((sum: number, fee: any) => sum + Number(fee.recognizedUsd || 0), 0), 2),
      pendingValuation: fees.filter((fee: any) => fee.status === "confirmed" && fee.valuationStatus === "pending").length,
    },
  }
}

export async function revenuePayrollDraft(date = teamDateKey(0)) {
  const db = await getDb()
  const consolidation = await getConsolidation(date)
  if (!consolidation || consolidation.status !== "confirmed") throw new Error("Finalize end-of-day revenue reconciliation before importing payroll")
  const fees = await db.collection(FEES).find({ date, status: "confirmed" }).toArray()
  const valued = fees.filter((fee: any) => Number(fee.recognizedUsd || 0) > 0 && (fee.projectId || fee.feeType === "fee_rebate"))
  const clientGroups = new Map<string, { projectId: string; incomeType: string; income: number; sourceFeeEventIds: string[] }>()
  const devGroups = new Map<string, { projectId: string; category: string; income: number; sourceFeeEventIds: string[] }>()
  for (const fee of valued) {
    const isMisc = ["dev_allocation", "fee_rebate"].includes(fee.feeType)
    const target = isMisc ? devGroups : clientGroups
    const key = `${fee.projectId || "global"}:${fee.feeType}`
    const existing = target.get(key) || {
      projectId: String(fee.projectId),
      ...(isMisc ? { category: fee.feeType } : { incomeType: String(fee.feeType || "trading") }),
      income: 0,
      sourceFeeEventIds: [],
    } as any
    existing.income = round(existing.income + Number(fee.recognizedUsd || 0), 2)
    existing.sourceFeeEventIds.push(String(fee._id))
    target.set(key, existing as any)
  }
  return { date, clientIncome: Array.from(clientGroups.values()), devAllocations: Array.from(devGroups.values()) }
}
