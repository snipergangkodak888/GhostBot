import type { AdapterContext, AdapterResult, LaunchReportRequest } from './types'
import { ceilDiv, integerTerm, splitRaw } from './utils'

// DAMM v2 SDK 1.5.1, commit 79ebbfe59a225e641a2f37cd03404f26de1b0c8e.
// Reference: math/priceMath.ts, liquidity/concentratedLiquidity.ts and feeMath.ts.
// Q64 prices and Q128 liquidity; OnlyB collects buy fees on the quote input.
// Fees are claimed separately, never compounded into the active reserves.
const MIN = 4295048016n
const MAX = 79226673521066979257578248091n
const Q128 = 1n << 128n
const U64_MAX = (1n << 64n) - 1n
export const isMeteora = (id: string) => id === 'meteora-damm-v2' || id === 'meteora-damm-v2-usdc'

export function validateBundleWalletCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) throw new Error('Enter a whole number of bundle wallets from 1 to 64.')
}

/** Execution count is independent of the number of aged wallets purchased. */
export function applyBundleWalletCount(request: LaunchReportRequest, count: number) {
  validateBundleWalletCount(count)
  const next = structuredClone(request)
  next.operations.buyerCount = count
  if (next.fundingConversion) next.fundingConversion.nativeOperations.buyerCount = count
  return next
}

function sqrtFloor(value: bigint): bigint {
  if (value < 0n) throw new Error('Invalid square-root input')
  if (value < 2n) return value
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2))
  for (;;) {
    const next = (x + value / x) / 2n
    if (next >= x) return x
    x = next
  }
}

export function meteoraInitialPosition(base: bigint, quote: bigint) {
  if (base <= 0n || quote <= 0n || base > U64_MAX || quote > U64_MAX) throw new Error('Initial Meteora pool amounts must fit positive Solana token balances.')
  // Solve the SDK's quadratic exactly, avoiding floating-point cancellation.
  const a = base * MAX, b = quote * Q128 - base * MIN * MAX, c = quote * Q128 * MAX
  const sqrtPrice = (sqrtFloor(b * b + 4n * a * c) - b) / (2n * a)
  if (sqrtPrice <= MIN || sqrtPrice >= MAX) throw new Error('Initial LP is outside the supported Meteora price range.')
  const fromBase = base * sqrtPrice * MAX / (MAX - sqrtPrice)
  const fromQuote = quote * Q128 / (sqrtPrice - MIN)
  const liquidity = fromBase < fromQuote ? fromBase : fromQuote
  if (liquidity <= 0n || liquidity >= 1n << 128n) throw new Error('Initial Meteora liquidity is outside the supported range.')
  return { sqrtPrice, liquidity, baseRaw: ceilDiv(liquidity * (MAX - sqrtPrice), sqrtPrice * MAX), quoteRaw: ceilDiv(liquidity * (sqrtPrice - MIN), Q128) }
}

export function calculateMeteora(context: AdapterContext): AdapterResult {
  const { request, supplyRaw, retainedRaw, targetRaw, liquidityRaw } = context
  if (request.terms.collectFeeMode !== 'OnlyB' || request.terms.dynamicFee !== false || request.terms.transferFee) throw new Error('This Meteora model requires fixed fees in the quote token, no dynamic fee and no transfer tax.')
  if (!['SOL', 'USDC'].includes(request.quote.symbol) || request.quote.decimals !== (request.quote.symbol === 'SOL' ? 9 : 6)) throw new Error('Choose the Meteora SOL or USDC preset.')
  const feeBps = integerTerm(request.terms, 'poolFeeBps', undefined, 9900)
  if (feeBps < 1) throw new Error('Meteora pool fees must be at least 0.01%.')
  const position = meteoraInitialPosition(supplyRaw - retainedRaw, liquidityRaw)
  if (targetRaw - retainedRaw >= position.baseRaw) throw new Error('Target exhausts the Meteora pool inventory.')
  let sqrtPrice = position.sqrtPrice, buyRaw = 0n, actualBaseRaw = retainedRaw
  const buys = []
  for (const output of splitRaw(targetRaw - retainedRaw, context.buyerCount)) {
    if (output === 0n) continue
    const denominator = position.liquidity - output * sqrtPrice
    if (denominator <= 0n) throw new Error('Target exceeds the Meteora price range.')
    const next = ceilDiv(position.liquidity * sqrtPrice, denominator)
    if (next > MAX) throw new Error('Target exceeds the Meteora price range.')
    const netInput = ceilDiv(position.liquidity * (next - sqrtPrice), Q128)
    const input = ceilDiv(netInput * 10000n, 10000n - BigInt(feeBps))
    if (input > U64_MAX) throw new Error('Purchase exceeds the Solana token amount limit.')
    buys.push({ outputRaw: output, inputRaw: input, feeRaw: input - netInput, nextSqrtPrice: next })
    buyRaw += input; actualBaseRaw += output; sqrtPrice = next
  }
  return { buyRaw, actualBaseRaw, initialLiquidityRaw: position.quoteRaw,
    fdvQuote: (Number(sqrtPrice) / 2 ** 64) ** 2 * Number(supplyRaw) / 10 ** request.quote.decimals,
    phase: 'DAMM v2 full-range pool', details: { position, buys, finalSqrtPrice: sqrtPrice, poolFeeBps: feeBps, collectFeeMode: 'OnlyB' },
    warnings: ['Fixed pool fee; no dynamic fee or token transfer tax.'] }
}
