import type { LaunchReportRequest } from './types'
import { ceilDiv, parseAmount } from './utils'

export const GHOST_INJECTION_VERSION = 'ghost-injection-v1' as const
const SOLANA_MODELS = new Set(['pumpfun', 'pumpfun-custom', 'launchlab', 'stonkfun', 'raydium-cpmm'])
const USD_UNIT = 10n ** 30n
export const injectionReference = (modelId: string): 'SOL' | 'ETH' => SOLANA_MODELS.has(modelId) ? 'SOL' : 'ETH'

export function validateInjectionPolicy(request: LaunchReportRequest) {
  const policy = request.injectionLiquidity
  if (!policy) return
  if (policy.policyVersion !== GHOST_INJECTION_VERSION || policy.referenceSymbol !== injectionReference(request.modelId)) throw new Error('Unsupported injection liquidity policy. Generate a new report.')
  if (policy.quoteUsdPrice !== request.quote.usdPrice) throw new Error('Injection liquidity conversion does not match the report price. Generate again.')
  if (parseAmount(policy.referenceUsdPrice, 30, 'Injection reference price') <= 0n || parseAmount(policy.quoteUsdPrice, 30, 'Injection quote price') <= 0n) throw new Error('Injection liquidity requires positive conversion prices.')
  if (policy.referenceSymbol === request.quote.symbol && policy.referenceUsdPrice !== request.quote.usdPrice) throw new Error('Injection reference price does not match the native report price.')
  if (request.fundingConversion?.nativeOperations.currencySymbol === policy.referenceSymbol && policy.referenceUsdPrice !== request.fundingConversion.nativeUsdPrice) throw new Error('Injection reference price does not match native funding conversion.')
  if (typeof policy.source !== 'string' || !policy.source.trim() || policy.source.length > 1000 || typeof policy.asOf !== 'string' || !Number.isFinite(Date.parse(policy.asOf))) throw new Error('Injection liquidity needs a dated exchange-rate source.')
}

/** Additional trading capital. It does not execute a buy or alter the model's MC. */
export function injectionLiquidityRaw(request: LaunchReportRequest, mcUsd: number | null): bigint {
  const policy = request.injectionLiquidity
  if (!policy) return 0n // Preserve explicit legacy snapshots without adding new costs.
  validateInjectionPolicy(request)
  if (mcUsd === null || mcUsd < 0 || !Number.isFinite(mcUsd * 1e6)) throw new Error('Injection liquidity requires a valid USD market cap.')
  // MC is a model estimate; round its USD value upward to one millionth of a dollar.
  // All reserve amounts, interpolation and native conversion use integer arithmetic.
  const mc = BigInt(Math.ceil(mcUsd * 1e6)) * 10n ** 24n
  const referencePrice = parseAmount(policy.referenceUsdPrice, 30)
  let usd: bigint
  if (policy.referenceSymbol === 'SOL') {
    const baseline = 30n * referencePrice, threshold = 500_000n * USD_UNIT
    usd = mc <= threshold ? baseline : ceilDiv(baseline * mc, threshold)
  } else {
    const low = ceilDiv(13n * referencePrice, 10n), middle = 2n * referencePrice
    const high = 10_000n * USD_UNIT > middle ? 10_000n * USD_UNIT : middle
    if (mc <= 300_000n * USD_UNIT) usd = low
    else if (mc <= 500_000n * USD_UNIT) usd = low + ceilDiv((middle - low) * (mc - 300_000n * USD_UNIT), 200_000n * USD_UNIT)
    else if (mc <= 1_000_000n * USD_UNIT) usd = middle + ceilDiv((high - middle) * (mc - 500_000n * USD_UNIT), 500_000n * USD_UNIT)
    else usd = ceilDiv(high * mc, 1_000_000n * USD_UNIT)
  }
  return ceilDiv(usd * 10n ** BigInt(request.quote.decimals), parseAmount(policy.quoteUsdPrice, 30))
}

export function injectionPolicyNote(request: LaunchReportRequest): string {
  if (!request.injectionLiquidity) return 'Injection / MM liquidity is excluded from this legacy snapshot; generate a fresh report to include Ghost’s current buffer policy.'
  return request.injectionLiquidity.referenceSymbol === 'SOL'
    ? 'Injection / MM reserve: 30 SOL through $500k MC, then proportional to MC. Converted into the report currency; additional trading capital, separate from initial pool liquidity.'
    : 'Injection / MM reserve: 1.3 ETH through $300k MC; 2 ETH at $500k; $10,000 at $1m (minimum 2 ETH). Linear between anchors; proportional above $1m. Converted into the report currency.'
}
