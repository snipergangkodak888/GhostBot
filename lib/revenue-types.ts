export const REVENUE_CHAINS = ["ethereum", "base", "bnb", "robinhood", "solana"] as const

export type RevenueChain = (typeof REVENUE_CHAINS)[number]

export const FEE_TYPES = ["liquidation", "daily_trading", "launch", "dev_allocation", "fee_collector", "fee_rebate", "other"] as const

export type FeeType = (typeof FEE_TYPES)[number]

export type FeeEventStatus =
  | "awaiting_project"
  | "awaiting_asset"
  | "awaiting_confirmation"
  | "awaiting_receipt"
  | "match_proposed"
  | "confirmed"
  | "missing"
  | "waived"
  | "ignored"

export type RevenueReceiptStatus = "unclassified" | "match_proposed" | "allocated" | "internal" | "ignored"

export type ProjectFeeConfig = {
  chain: RevenueChain | ""
  quoteAssets: string[]
  dailyTradingFeeEnabled: boolean
  dailyTradingFeeUsd: number
  liquidationFeeEnabled: boolean
  liquidationFeePercentage: number
  launchFeeUsd: number
}

export type ParsedFeeMessage = {
  feeType: FeeType | null
  grossAmount: number | null
  grossAsset: string | null
  expectedAssetAmount: number | null
  expectedUsd: number | null
  ignoredSupplyPercentage: number | null
  confidence: "high" | "medium" | "low"
  warnings: string[]
}

export type RevenueAllocation = {
  feeEventId: string
  amount: number
  amountUsd?: number | null
  date?: string
  createdAt: string
}

export type RevenueReceipt = {
  _id?: string
  eventKey: string
  provider: "quicknode" | "manual"
  chain: RevenueChain
  wallet: string
  direction: "incoming" | "outgoing"
  transactionHash: string
  eventIndex: number
  blockNumber?: number | string | null
  blockTime?: string | null
  counterparty?: string | null
  asset: string
  tokenAddress?: string | null
  decimals?: number | null
  amount: number
  amountUsd?: number | null
  valuationStatus?: "valued" | "pending" | "manual"
  status: RevenueReceiptStatus
  proposedFeeEventId?: string | null
  allocations: RevenueAllocation[]
  raw?: unknown
  createdAt: string
  updatedAt: string
}

export type RevenueFeeEvent = {
  _id?: string
  date: string
  source: "telegram_forward" | "daily_schedule" | "manual"
  sourceKey: string
  telegram?: {
    chatId: string
    messageId: number
    forwardedByTelegramId?: number | null
    originalText: string
  }
  projectId?: string | null
  projectName?: string | null
  chain?: RevenueChain | null
  quoteAsset?: string | null
  feeType: FeeType | null
  grossAmount?: number | null
  grossAsset?: string | null
  expectedAssetAmount?: number | null
  expectedUsd?: number | null
  recognizedUsd?: number | null
  valuationStatus?: "valued" | "pending"
  liquidationPercentage?: number | null
  status: FeeEventStatus
  matchedReceiptIds: string[]
  proposedReceiptIds: string[]
  parse: ParsedFeeMessage
  createdByTelegramId?: number | null
  confirmedByTelegramId?: number | null
  confirmedAt?: string | null
  createdAt: string
  updatedAt: string
}
