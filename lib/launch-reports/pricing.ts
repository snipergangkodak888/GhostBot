import type { LaunchOperations, LaunchReportRequest } from './types'

/** Ghost commercial policy. These prices are not network or launchpad fees. */
export const GHOST_WALLET_PRICING = Object.freeze({ SOL: '0.10', ETH: '0.01', BNB: '0.02' })
export const GHOST_DEFAULT_AGED_WALLET_COUNT = 125
export const GHOST_PRICING_VERSION = 'ghost-wallets-v2'

export function validateAgedWalletCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new Error('Enter a whole number of aged wallets from 0 to 10,000.')
}

/** Keep the native and converted funding snapshots consistent when changing the count. */
export function applyAgedWalletCount(request: LaunchReportRequest, count: number): LaunchReportRequest {
  validateAgedWalletCount(count)
  const next = structuredClone(request)
  next.operations.agedWalletCount = count
  if (next.fundingConversion) next.fundingConversion.nativeOperations.agedWalletCount = count
  return next
}

/** Refresh old ETH setups at today's commercial rate; saved report rows stay intact. */
export function currentWalletPricingDraft(request: LaunchReportRequest): LaunchReportRequest {
  const next = structuredClone(request)
  const native = next?.fundingConversion?.nativeOperations || next?.operations
  if (native?.currencySymbol === 'ETH' && /^0\.10*$/.test(native.agedWalletUnitAmount)) native.agedWalletUnitAmount = GHOST_WALLET_PRICING.ETH
  return next
}

export function getAgedWalletUnitAmount(symbol: string): string | undefined {
  return GHOST_WALLET_PRICING[symbol.toUpperCase() as keyof typeof GHOST_WALLET_PRICING]
}

/** Explicit operating examples, editable in saved scenario configuration. */
export function createGhostOperations(symbol: string): LaunchOperations {
  const unit = getAgedWalletUnitAmount(symbol)
  const sol = symbol === 'SOL'
  return {
    currencySymbol: symbol, buyerCount: sol ? 25 : 32, retainedPct: 0,
    includeInitialLiquidity: true, setupAmount: sol ? '0.09' : '0',
    buyerGasAmount: sol ? '0.01' : '0', cleanupAmount: sol ? '0.25' : '0',
    holderCount: sol ? 100 : 0, holderAmount: sol ? '0.02' : '0', tipAmount: sol ? '0.02' : '0',
    launchFeeAmount: '0', providerFeeBps: 0, recipientCount: 0, recipientBufferAmount: '0', sourceGasAmount: '0',
    agedWalletCount: unit ? GHOST_DEFAULT_AGED_WALLET_COUNT : 0, agedWalletUnitAmount: unit ?? '0',
  }
}
