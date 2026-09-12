import { receiptAvailableAmount, receiptAvailableUsd } from "@/lib/revenue-allocations"
import type { RevenueFeeEvent, RevenueReceipt } from "@/lib/revenue-types"

export function receiptMatchPreview(fee: RevenueFeeEvent, receipts: RevenueReceipt[]) {
  const ids = Array.from(new Set(fee.proposedReceiptIds || []))
  const rows = ids.map((id) => receipts.find((receipt) => String(receipt._id) === id)).filter(Boolean) as RevenueReceipt[]
  const inAsset = fee.expectedAssetAmount != null
  const values = rows.map((receipt) => inAsset ? receiptAvailableAmount(receipt) : receiptAvailableUsd(receipt))
  const total = rows.length === ids.length && values.every((value) => value != null) ? values.reduce<number>((sum, value) => sum + Number(value), 0) : null
  const expected = Number(inAsset ? fee.expectedAssetAmount : fee.expectedUsd)
  const times = rows.map((row) => new Date(row.blockTime || row.createdAt).getTime()).filter(Number.isFinite)
  return {
    rows, total, expected,
    asset: inAsset ? fee.quoteAsset || fee.grossAsset || "" : "USD",
    difference: total == null ? null : total - expected,
    spanSeconds: times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : 0,
    missingReceipts: ids.length - rows.length,
  }
}
