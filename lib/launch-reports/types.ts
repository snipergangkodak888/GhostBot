/** Public, versioned request format. Decimal amount strings are whole currency units. */
export interface LaunchReportRequest {
  schemaVersion: 1
  title: string
  client?: string
  modelId: string
  chain?: string
  targetsPct: number[]
  liquidityAmounts?: string[]
  base: { symbol: string; decimals: number; supply: string }
  quote: { symbol: string; decimals: number; usdPrice?: string; priceAsOf?: string; priceSource?: string }
  /** Adapter-specific configuration. Raw integer fields are explicitly named *Raw / *Wei. */
  terms: Record<string, unknown>
  operations: LaunchOperations
  /** Native costs and the dated FX rates used to express them in the quote currency. */
  fundingConversion?: { nativeOperations: LaunchOperations; nativeUsdPrice: string; quoteUsdPrice: string; asOf: string; source: string }
  termsSource?: { label: string; url?: string; asOf?: string; kind: 'snapshot' | 'user' | 'code-default' }
}

export interface LaunchOperations {
  /** Every amount in this object is denominated in this quote currency. */
  currencySymbol: string
  buyerCount: number
  curveBuyerCount?: number
  poolBuyerCount?: number
  retainedPct: number
  includeInitialLiquidity: boolean
  setupAmount: string
  buyerGasAmount: string
  /** Total cleanup allowance, independent of holder funding. */
  cleanupAmount: string
  holderCount: number
  holderAmount: string
  tipAmount: string
  launchFeeAmount: string
  /** Funding provider fee deducted from the sent amount; grossed up. */
  providerFeeBps: number
  recipientCount: number
  recipientBufferAmount: string
  sourceGasAmount: string
  agedWalletCount: number
  agedWalletUnitAmount: string
}

export interface ModelCatalogEntry {
  id: string
  label: string
  description: string
  group: string
  requiresLiquidity: boolean
}

export interface ModelPreset {
  label: string
  description: string
  group?: string
  requiresLiquidity?: boolean
  request: LaunchReportRequest
}

export interface AdapterContext {
  request: LaunchReportRequest
  targetPct: number
  targetRaw: bigint
  supplyRaw: bigint
  liquidityRaw: bigint
  buyerCount: number
  retainedRaw: bigint
}

export interface AdapterResult {
  buyRaw: bigint
  /** Purchased plus explicitly retained supply, in base atomic units. */
  actualBaseRaw: bigint
  fdvQuote: number | null
  phase: string
  initialLiquidityRaw?: bigint
  refundableReserveRaw?: bigint
  details: Record<string, unknown>
  warnings?: string[]
}

export interface LaunchReportAmounts {
  buys: string
  initialLiquidity: string
  operations: string
  modelReserves: string
  providerFee: string
  recipientBuffers: string
  sourceGas: string
  funding: string
  agedWallets: string
  total: string
}

export interface LaunchReportRow {
  id: string
  targetPct: number
  liquidity: string
  status: 'ok' | 'unavailable'
  error?: string
  actualPct?: number
  phase?: string
  amounts?: LaunchReportAmounts
  raw?: LaunchReportAmounts
  fdvQuote?: number | null
  fdvUsd?: number | null
  totalUsd?: number | null
  details?: Record<string, unknown>
  warnings: string[]
}

export interface LaunchReport {
  schemaVersion: 1
  modelVersion: string
  sourceVersion: string
  sourceHashes: Record<string, string>
  pricingVersion: string
  generatedAt: string
  title: string
  client?: string
  modelId: string
  request: LaunchReportRequest
  rows: LaunchReportRow[]
  warnings: string[]
  assumptions: string[]
}
