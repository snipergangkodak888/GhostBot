export const REVENUE_CHAINS = ["ethereum", "base", "bnb", "robinhood", "solana"] as const

export type RevenueChain = (typeof REVENUE_CHAINS)[number]

export const REVENUE_WALLET_ROLES = ["revenue", "treasury"] as const

export type RevenueWalletRole = (typeof REVENUE_WALLET_ROLES)[number]

export const FEE_TYPES = ["liquidation", "daily_trading", "launch", "dev_allocation", "fee_collector", "fee_rebate", "sumo_ref_claim", "other"] as const

export type FeeType = (typeof FEE_TYPES)[number]

export const GLOBAL_REVENUE_FEE_TYPES = ["fee_rebate", "sumo_ref_claim"] as const

export function isGlobalRevenueFeeType(value: unknown): value is (typeof GLOBAL_REVENUE_FEE_TYPES)[number] {
  return GLOBAL_REVENUE_FEE_TYPES.includes(value as any)
}

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
  walletRole?: RevenueWalletRole
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
  priceUsd?: number | null
  priceSource?: "stablecoin" | "coingecko" | "defillama" | "manual" | null
  priceTimestamp?: string | null
  priceFetchedAt?: string | null
  notificationSuppressedReason?: "dust" | "internal_swap" | "consolidation_candidate" | null
  autoClassification?: "dust" | "same_transaction_swap" | "treasury_transfer" | null
  status: RevenueReceiptStatus
  proposedFeeEventId?: string | null
  allocations: RevenueAllocation[]
  date?: string
  consolidationMatched?: boolean
  consolidationBatchId?: string | null
  internalReason?: "same_transaction_swap" | "privacy_consolidation" | "treasury_transfer" | "network_fee" | "manual" | null
  pairedReceiptId?: string | null
  raw?: unknown
  createdAt: string
  updatedAt: string
}

export type RevenueConsolidationCandidateStatus = "collecting" | "suggested" | "confirmed" | "rejected"

export type RevenueConsolidationCandidate = {
  _id?: string
  date: string
  status: RevenueConsolidationCandidateStatus
  sourceReceiptIds: string[]
  destinationReceiptIds: string[]
  swapReceiptIds: string[]
  sourceUsd?: number | null
  destinationUsd?: number | null
  estimatedCostUsd?: number | null
  confidence?: "high" | "medium" | "low"
  firstActivityAt: string
  lastActivityAt: string
  notificationClaimedAt?: string | null
  notificationSentAt?: string | null
  confirmedAt?: string | null
  confirmedByTelegramId?: number | null
  rejectedAt?: string | null
  rejectedByTelegramId?: number | null
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
    originalDate?: string | null
  }
  occurredAt?: string | null
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
  actualReceivedUsd?: number | null
  conversionVarianceUsd?: number | null
  valuationStatus?: "valued" | "pending"
  liquidationPercentage?: number | null
  status: FeeEventStatus
  matchedReceiptIds: string[]
  proposedReceiptIds: string[]
  matchAlternatives?: Array<{
    receiptIds: string[]
    total: number
    delta: number
    confidence: "high" | "medium"
    receiptCount: number
    firstReceiptAt?: string | null
    lastReceiptAt?: string | null
  }>
  manualReceiptSelection?: boolean
  parse: ParsedFeeMessage
  createdByTelegramId?: number | null
  confirmedByTelegramId?: number | null
  confirmedAt?: string | null
  createdAt: string
  updatedAt: string
}
