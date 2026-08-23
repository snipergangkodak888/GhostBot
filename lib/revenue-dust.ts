import type { RevenueReceipt } from "@/lib/revenue-types"

export const DEFAULT_REVENUE_NOTIFICATION_MIN_USD = 1

export function revenueNotificationMinimumUsd() {
  const raw = String(process.env.REVENUE_NOTIFICATION_MIN_USD || "").trim()
  if (!raw) return DEFAULT_REVENUE_NOTIFICATION_MIN_USD
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_REVENUE_NOTIFICATION_MIN_USD
}

export function isRevenueReceiptDust(receipt: Pick<RevenueReceipt, "direction" | "amountUsd">, minimumUsd = revenueNotificationMinimumUsd()) {
  const amountUsd = receipt.amountUsd == null ? null : Number(receipt.amountUsd)
  return receipt.direction === "incoming" && amountUsd != null && Number.isFinite(amountUsd) && amountUsd < minimumUsd
}
