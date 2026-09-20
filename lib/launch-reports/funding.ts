import type { LaunchOperations } from './types'
import { ceilDiv, formatAmount, parseAmount } from './utils'

export const FUNDING_MONEY_KEYS = ['setupAmount', 'buyerGasAmount', 'cleanupAmount', 'holderAmount', 'tipAmount', 'launchFeeAmount', 'recipientBufferAmount', 'sourceGasAmount', 'agedWalletUnitAmount'] as const
export function nativeDecimals(symbol: string): number {
  if (symbol === 'SOL') return 9
  if (symbol === 'ETH' || symbol === 'BNB') return 18
  throw new Error('Automatic native funding supports SOL, ETH and BNB.')
}
/** Round each native allowance up to the quote's atomic unit, never down. */
export function convertNativeAmount(amount: string, nativeSymbol: string, quoteDecimals: number, nativeUsd: string, quoteUsd: string): string {
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 30) throw new Error('Quote decimals must be between 0 and 30.')
  const nativePrice = parseAmount(nativeUsd, 30, 'Native USD price'), quotePrice = parseAmount(quoteUsd, 30, 'Quote USD price')
  if (nativePrice <= 0n || quotePrice <= 0n) throw new Error('Funding conversion requires positive exchange rates.')
  return formatAmount(ceilDiv(parseAmount(amount, nativeDecimals(nativeSymbol)) * nativePrice * 10n ** BigInt(quoteDecimals), 10n ** BigInt(nativeDecimals(nativeSymbol)) * quotePrice), quoteDecimals)
}
export function convertNativeOperations(native: LaunchOperations, quoteSymbol: string, quoteDecimals: number, nativeUsd: string, quoteUsd: string): LaunchOperations {
  const next = { ...native, currencySymbol: quoteSymbol }
  for (const key of FUNDING_MONEY_KEYS) next[key] = convertNativeAmount(native[key], native.currencySymbol, quoteDecimals, nativeUsd, quoteUsd)
  return next
}
