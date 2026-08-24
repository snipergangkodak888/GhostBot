export function receiptAllocatedAmount(receipt: any) {
  return (receipt?.allocations || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
}

export function receiptAvailableAmount(receipt: any) {
  return Math.max(0, Number(receipt?.amount || 0) - receiptAllocatedAmount(receipt))
}

export function receiptAvailableUsd(receipt: any) {
  if (receipt?.amountUsd == null) return null
  return Number(receipt.amountUsd) * receiptAvailableAmount(receipt) / Math.max(Number(receipt.amount || 0), Number.EPSILON)
}

export function validateClassifiedAmount(amount: number, available: number, asset: string) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Classified amount must be greater than zero")
  if (amount > available + 0.00000001) {
    const roundedAvailable = Math.round((available + Number.EPSILON) * 100_000_000) / 100_000_000
    throw new Error(`Only ${roundedAvailable} ${asset} remains available after prior allocations`)
  }
}
