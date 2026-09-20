import { applyLaunchLabBuy, createLaunchLabCurve, sizeLaunchLabBuy, type LaunchLabCurveTerms } from './amm-math/launchlab-quote-math'
import { buyPumpQuoteExactOut, buyPumpQuoteAmmExactIn, createPumpQuoteCurve, migratePumpQuoteCurve, pumpQuoteGross, sizePumpQuoteBuy, type PumpfunCustomQuoteTerms, type PumpQuoteAmm, type PumpQuoteCurve } from './amm-math/pumpfun-quote-math'
import { uniswapV2GetAmountOut } from './amm-math/uniswap-v2'
import type { AdapterContext, AdapterResult } from './types'
import { ceilDiv, integerTerm, splitRaw, termBigInt } from './utils'

const BPS = 10_000n

export function graduationCounts(context: AdapterContext): { curve: number; pool: number } {
  const op = context.request.operations
  const pool = op.poolBuyerCount ?? 1
  const curve = op.curveBuyerCount ?? context.buyerCount - pool
  if (!Number.isInteger(curve) || !Number.isInteger(pool) || curve < 1 || pool < 1 || curve + pool !== context.buyerCount) {
    throw new Error('For graduation, positive curve and pool buyer counts must add up to total buyer count')
  }
  return { curve, pool }
}

function assertCurveContext(context: AdapterContext) {
  if (context.retainedRaw !== 0n) throw new Error('Retained supply is not an independent allocation in this launch curve; set retained supply to 0')
  if (context.liquidityRaw !== 0n) throw new Error('Initial liquidity is derived by the launch curve; remove the liquidity sweep')
}

interface PumpFeeTier { thresholdRaw: bigint; lpFeeBps: number; protocolFeeBps: number; creatorFeeBps: number }

function pumpFeeTiers(terms: Record<string, unknown>): PumpFeeTier[] {
  if (!Array.isArray(terms.ammFeeTiers) || terms.ammFeeTiers.length === 0 || terms.ammFeeTiers.length > 100) {
    throw new Error('Native Pump graduation requires an explicit AMM fee-tier snapshot')
  }
  const tiers = terms.ammFeeTiers.map((row: Record<string, unknown>) => ({
    thresholdRaw: termBigInt(row, 'thresholdRaw'),
    lpFeeBps: integerTerm(row, 'lpFeeBps', undefined, 9999),
    protocolFeeBps: integerTerm(row, 'protocolFeeBps', undefined, 9999),
    creatorFeeBps: integerTerm(row, 'creatorFeeBps', undefined, 9999),
  }))
  if (tiers[0].thresholdRaw !== 0n || tiers.some((tier, i) => tier.lpFeeBps + tier.protocolFeeBps + tier.creatorFeeBps >= 10000 || (i > 0 && tier.thresholdRaw <= tiers[i - 1].thresholdRaw))) {
    throw new Error('AMM fee tiers must start at zero, increase strictly, and total less than 100% each')
  }
  return tiers
}

/** Native Pump SDK uses floor + 1 for curve exact-output sizing. */
function nativeCurveBuy(state: PumpQuoteCurve, target: bigint): bigint {
  if (target === 0n) return 0n
  const numerator = state.virtualQuoteReserves * target
  const denominator = state.virtualTokenReserves - target
  const before = state.realQuoteReserves
  buyPumpQuoteExactOut(state, target)
  if (numerator % denominator === 0n) { state.virtualQuoteReserves++; state.realQuoteReserves++ }
  return pumpQuoteGross(state.realQuoteReserves - before, state)
}

function nativeAmmBuy(state: PumpQuoteAmm, budget: bigint, tiers: PumpFeeTier[], supply: bigint): bigint {
  if (budget <= 1n) return 0n
  const fdvRaw = state.quoteReserve * supply / state.baseReserve
  const fee = [...tiers].reverse().find(tier => fdvRaw >= tier.thresholdRaw)!
  const lp = BigInt(fee.lpFeeBps), protocol = BigInt(fee.protocolFeeBps), creator = BigInt(fee.creatorFeeBps)
  let net = budget * BPS / (BPS + lp + protocol + creator)
  const gross = net + ceilDiv(net * lp, BPS) + ceilDiv(net * protocol, BPS) + ceilDiv(net * creator, BPS)
  if (gross > budget) net -= gross - budget
  if (net <= 1n) return 0n
  const out = (net - 1n) * state.baseReserve / (state.quoteReserve + net - 1n)
  state.baseReserve -= out
  state.quoteReserve += net + ceilDiv(net * lp, BPS)
  return out
}

function calculatePump(context: AdapterContext): AdapterResult {
  assertCurveContext(context)
  const { request, targetRaw, supplyRaw } = context
  if (request.base.decimals !== 6 || supplyRaw !== 1_000_000_000_000_000n) throw new Error('The supplied Pump model requires 1 billion tokens with 6 decimals')
  const terms = request.terms
  const native = request.modelId === 'pumpfun'
  const stable = !native && terms.quoteSchedule === 'stable'
  if (stable && (request.quote.symbol !== 'USDC' || request.quote.decimals !== 6)) throw new Error('Pump stable fee schedules require mainnet USDC with 6 decimals')
  if (native && (request.quote.symbol !== 'SOL' || request.quote.decimals !== 9)) throw new Error('Native Pump requires SOL with 9 decimals; use Pump custom quote for other currencies')
  const quoteTerms: PumpfunCustomQuoteTerms = {
    mint: String(terms.mint ?? 'scenario'), tokenProgramId: String(terms.tokenProgramId ?? 'scenario'),
    decimals: request.quote.decimals, symbol: request.quote.symbol, registry: String(terms.registry ?? 'scenario'),
    initialVirtualQuoteReserves: termBigInt(terms, 'initialVirtualQuoteReserves').toString(),
    protocolFeeBps: integerTerm(terms, 'protocolFeeBps', undefined, 9999),
    creatorFeeBps: integerTerm(terms, 'creatorFeeBps', undefined, 9999),
    ...(terms.creatorFeeOverrideBps !== undefined ? { creatorFeeOverrideBps: integerTerm(terms, 'creatorFeeOverrideBps', undefined, 9999) } : {}),
  }
  if ((native || stable) && quoteTerms.creatorFeeOverrideBps !== undefined) throw new Error('Native and USDC Pump tiered-fee adapters do not apply custom-quote creator overrides')
  const curve = createPumpQuoteCurve(quoteTerms)
  const curveSupply = curve.realTokenReserves
  const graduate = targetRaw >= curveSupply
  const usesPool = targetRaw > curveSupply
  const counts = usesPool ? graduationCounts(context) : { curve: context.buyerCount, pool: 0 }
  const curveRows: Record<string, unknown>[] = [], poolRows: Record<string, unknown>[] = []
  let buyRaw = 0n, actualBaseRaw = 0n
  for (const target of splitRaw(graduate ? curveSupply : targetRaw, counts.curve)) {
    const input = native || stable ? nativeCurveBuy(curve, target) : buyPumpQuoteExactOut(curve, target)
    buyRaw += input; actualBaseRaw += target
    curveRows.push({ targetRaw: target, inputRaw: input })
  }
  let fdvQuote = Number(curve.virtualQuoteReserves) / 10 ** request.quote.decimals / Number(curve.virtualTokenReserves) * Number(supplyRaw)
  let finalAmm: PumpQuoteAmm | undefined
  let migrationFeeRaw = 0n
  let nativeMigrationFundingRaw = 0n
  if (graduate) {
    migrationFeeRaw = termBigInt(terms, 'migrationFeeRaw', native ? undefined : 0n)
    if (migrationFeeRaw >= curve.realQuoteReserves) throw new Error('Migration fee consumes the quote reserves')
    finalAmm = migratePumpQuoteCurve({ ...curve, realQuoteReserves: curve.realQuoteReserves - migrationFeeRaw })
    if (stable && termBigInt(terms, 'nativeMigrationCostLamports', 0n) > 0n) nativeMigrationFundingRaw = termBigInt(terms, 'nativeMigrationFundingQuoteRaw')
    const tiers = (native || stable) && usesPool ? pumpFeeTiers(terms) : []
    const quote = native || stable ? (state: PumpQuoteAmm, input: bigint) => nativeAmmBuy(state, input, tiers, supplyRaw) : buyPumpQuoteAmmExactIn
    for (const nominal of usesPool ? splitRaw(targetRaw - curveSupply, counts.pool) : []) {
      const before = { ...finalAmm }
      const sized = sizePumpQuoteBuy(finalAmm, nominal, quote)
      if (sized.tokenOutRaw < nominal || quote({ ...before }, sized.quoteAtomic - 1n) >= nominal) throw new Error('Pump migration input verification failed')
      buyRaw += sized.quoteAtomic; actualBaseRaw += sized.tokenOutRaw
      poolRows.push({ targetRaw: nominal, inputRaw: sized.quoteAtomic, actualBaseRaw: sized.tokenOutRaw })
    }
    fdvQuote = Number(finalAmm.quoteReserve) / 10 ** request.quote.decimals / Number(finalAmm.baseReserve) * Number(supplyRaw)
  }
  return { buyRaw, actualBaseRaw, fdvQuote, refundableReserveRaw: nativeMigrationFundingRaw, phase: usesPool ? 'Curve + graduated pool' : graduate ? 'Curve → migration' : 'Curve', details: { quoteTerms, curveRows, poolRows, migrationFeeRaw, nativeMigrationFundingRaw, finalCurve: curve, finalAmm, count: counts }, warnings: (native || stable) && graduate ? [nativeMigrationFundingRaw > 0n ? 'Pump graduation includes the SOL migration charge converted into the report quote currency; this charge is a fee, not a refundable reserve.' : 'Pump graduation uses the selected quote currency’s migration and AMM fee snapshot.'] : [] }
}

function calculateLaunchLab(context: AdapterContext): AdapterResult {
  assertCurveContext(context)
  const { request, targetRaw, supplyRaw } = context
  const terms = request.terms as unknown as LaunchLabCurveTerms
  for (const key of ['supply', 'totalSellA', 'totalLockedAmount', 'totalFundRaisingB', 'migrateFee', 'tradeFeeRate', 'platformFeeRate', 'creatorFeeRate']) termBigInt(request.terms, key)
  if (BigInt(terms.supply) !== supplyRaw) throw new Error('LaunchLab raw supply must match the report token supply and decimals')
  const curve = createLaunchLabCurve(terms)
  if (targetRaw > curve.totalSellA) throw new Error(`Target exceeds the LaunchLab curve sale allocation (${Number(curve.totalSellA) / Number(supplyRaw) * 100}%). Post-migration pool terms require a separate DEX report.`)
  let buyRaw = 0n, actualBaseRaw = 0n
  const buys = []
  for (const [index, nominal] of splitRaw(targetRaw, context.buyerCount).entries()) {
    const remaining = targetRaw - actualBaseRaw
    const target = index === context.buyerCount - 1 || nominal > remaining ? remaining : nominal
    if (target <= 0n) break
    const buy = sizeLaunchLabBuy(curve, target)
    if (buy.tokenOutRaw < target) throw new Error('The curve cannot deliver this wallet target after token transfer fees')
    applyLaunchLabBuy(curve, buy)
    buyRaw += buy.quoteAtomic; actualBaseRaw += buy.tokenOutRaw; buys.push(buy)
  }
  return { buyRaw, actualBaseRaw, fdvQuote: Number(curve.virtualQuote + curve.realQuote) / 10 ** request.quote.decimals / Number(curve.virtualBase - curve.realBase) * Number(supplyRaw), phase: 'LaunchLab curve', details: { buys, finalCurve: curve }, warnings: terms.transferFee ? ['Control is tokens retained after transfer fees; transfer-fee withholding consumes curve inventory.'] : [] }
}

function calculateRaydium(context: AdapterContext): AdapterResult {
  const { request, targetRaw, supplyRaw, retainedRaw, liquidityRaw } = context
  if (liquidityRaw <= 0n) throw new Error('Initial quote liquidity must be positive')
  const terms = request.terms
  const fee = BigInt(integerTerm(terms, 'tradeFeeRate', undefined, 999999))
  const protocol = BigInt(integerTerm(terms, 'protocolFeeRate', undefined, 1_000_000))
  const fund = BigInt(integerTerm(terms, 'fundFeeRate', undefined, 1_000_000))
  if (protocol + fund > 1_000_000n) throw new Error('Protocol and fund fee shares cannot exceed the total swap fee')
  if (integerTerm(terms, 'creatorFeeRate', 0) !== 0) throw new Error('This Raydium CPMM adapter supports creator fee disabled; provide a zero creatorFeeRate')
  let quoteReserve = liquidityRaw, baseReserve = supplyRaw - retainedRaw, buyRaw = 0n, actualBaseRaw = retainedRaw
  const initialBaseRaw = baseReserve
  const buys = []
  for (const target of splitRaw(targetRaw - retainedRaw, context.buyerCount)) {
    if (target === 0n) continue
    if (target >= baseReserve) throw new Error('Target exhausts the pool base reserve')
    const net = ceilDiv(quoteReserve * target, baseReserve - target)
    const input = ceilDiv(net * 1_000_000n, 1_000_000n - fee)
    const tradeFee = ceilDiv(input * fee, 1_000_000n)
    const protocolFee = tradeFee * protocol / 1_000_000n, fundFee = tradeFee * fund / 1_000_000n
    const actual = uniswapV2GetAmountOut({ amountIn: input - tradeFee, feeBps: 0, reserveIn: quoteReserve, reserveOut: baseReserve })
    if (actual < target) throw new Error('Raydium input verification failed')
    quoteReserve += input - protocolFee - fundFee; baseReserve -= actual; buyRaw += input; actualBaseRaw += actual
    buys.push({ targetRaw: target, inputRaw: input, actualBaseRaw: actual, tradeFeeRaw: tradeFee, protocolFeeRaw: protocolFee, fundFeeRaw: fundFee })
  }
  return { buyRaw, actualBaseRaw, initialLiquidityRaw: liquidityRaw, fdvQuote: Number(quoteReserve) / 10 ** request.quote.decimals / Number(baseReserve) * Number(supplyRaw), phase: 'CPMM pool', details: { initialBaseRaw, finalQuoteRaw: quoteReserve, finalBaseRaw: baseReserve, buys }, warnings: ['Raydium CPMM creator fees are disabled in this model; protocol and fund fees are excluded from trading reserves.'] }
}

export function calculateSolana(context: AdapterContext): AdapterResult {
  switch (context.request.modelId) {
    case 'pumpfun': case 'pumpfun-custom': return calculatePump(context)
    case 'launchlab': case 'stonkfun': return calculateLaunchLab(context)
    case 'raydium-cpmm': return calculateRaydium(context)
    default: throw new Error(`Unknown Solana model: ${context.request.modelId}`)
  }
}
