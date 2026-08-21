/**
 * Pump.fun → PumpSwap bundle math ported from Sumo's deterministic BigInt
 * implementation. These are protocol/configuration constants and integer
 * quote functions, not values calibrated from client examples.
 */

const BPS_DENOMINATOR = 10_000n
const LAMPORTS_PER_SOL = 1_000_000_000n
const TOKEN_BASE_UNITS = 1_000_000n
const PUMPFUN_FEE_BPS = 125n
const PUMPFUN_ROUNDING_MARGIN_LAMPORTS = 1n
const PUMPFUN_PRE_MIGRATION_SLIPPAGE_BPS = 100n
const PUMPSWAP_TOTAL_FEE_BPS = 25n

export const PUMPFUN_TOTAL_SUPPLY_RAW = 1_000_000_000_000_000n
export const PUMPFUN_MIGRATION_TOKEN_TARGET_RAW = 793_100_000_000_000n
export const PUMPSWAP_INITIAL_BASE_RESERVE_RAW = 206_900_000n * TOKEN_BASE_UNITS
export const PUMPSWAP_INITIAL_QUOTE_RESERVE_LAMPORTS = 84_990_359_072n
export const PUMPFUN_MIGRATION_CONTROL_PCT =
  (Number(PUMPFUN_MIGRATION_TOKEN_TARGET_RAW) / Number(PUMPFUN_TOTAL_SUPPLY_RAW)) * 100

type PumpSwapState = { baseReserve: bigint; quoteReserve: bigint }

export type PumpfunCapitalQuote = {
  curveCapitalSol: number
  migrationCapitalSol: number
  supplyControlPct: number
  marketCapNative: number
}

function ceilDiv(value: bigint, divisor: bigint) {
  if (divisor <= 0n) return 0n
  return (value + divisor - 1n) / divisor
}

function applyBpsBuffer(value: bigint, bps: bigint) {
  return ceilDiv(value * (BPS_DENOMINATOR + bps), BPS_DENOMINATOR)
}

function supplyPercentToRaw(percent: number) {
  const scaledPercent = BigInt(Math.round(percent * 1_000_000))
  return (PUMPFUN_TOTAL_SUPPLY_RAW * scaledPercent) / 100_000_000n
}

function pumpfunExactOutSpendableLamports(tokenAmountRaw: bigint) {
  const actualTokens = tokenAmountRaw > PUMPFUN_MIGRATION_TOKEN_TARGET_RAW
    ? PUMPFUN_MIGRATION_TOKEN_TARGET_RAW
    : tokenAmountRaw
  if (actualTokens <= 0n) return 0n
  const virtualTokenReserves = 1_073_000_000_000_000n
  const virtualSolReserves = 30_000_000_000n
  const targetTokenReserves = virtualTokenReserves - actualTokens
  if (targetTokenReserves <= 1n) return 0n
  const newSolReserves = (virtualTokenReserves * virtualSolReserves) / (targetTokenReserves - 1n) + 1n
  return newSolReserves - virtualSolReserves
}

function pumpfunExactOutCapitalLamports(tokenAmountRaw: bigint) {
  const spendable = pumpfunExactOutSpendableLamports(tokenAmountRaw)
  if (spendable <= 0n) return 0n
  return spendable + ceilDiv(spendable * PUMPFUN_FEE_BPS, BPS_DENOMINATOR) + PUMPFUN_ROUNDING_MARGIN_LAMPORTS
}

function initialPumpSwapState(): PumpSwapState {
  return {
    baseReserve: PUMPSWAP_INITIAL_BASE_RESERVE_RAW,
    quoteReserve: PUMPSWAP_INITIAL_QUOTE_RESERVE_LAMPORTS,
  }
}

function pumpSwapTokenOut(quoteInLamports: bigint, state: PumpSwapState) {
  if (quoteInLamports <= 0n || state.baseReserve <= 0n || state.quoteReserve <= 0n) return 0n
  const effectiveQuote = (quoteInLamports * BPS_DENOMINATOR) / (BPS_DENOMINATOR + PUMPSWAP_TOTAL_FEE_BPS)
  if (effectiveQuote <= 0n) return 0n
  const tokenOut = (state.baseReserve * effectiveQuote) / (state.quoteReserve + effectiveQuote)
  return tokenOut >= state.baseReserve ? state.baseReserve - 1n : tokenOut
}

function pumpSwapExactInForTargetTokens(tokenAmountRaw: bigint, state: PumpSwapState) {
  const target = tokenAmountRaw >= state.baseReserve ? state.baseReserve - 1n : tokenAmountRaw
  if (target <= 0n || state.baseReserve <= 0n || state.quoteReserve <= 0n) return 0n
  const remainingBase = state.baseReserve - target
  const effectiveQuote = ceilDiv(target * state.quoteReserve, remainingBase)
  let quoteIn = ceilDiv(effectiveQuote * (BPS_DENOMINATOR + PUMPSWAP_TOTAL_FEE_BPS), BPS_DENOMINATOR)
  for (let index = 0; index < 16; index += 1) {
    if (pumpSwapTokenOut(quoteIn, state) >= target) return quoteIn
    quoteIn += 1n
  }
  return quoteIn
}

function applyPumpSwapBuy(state: PumpSwapState, quoteInLamports: bigint) {
  const tokenOut = pumpSwapTokenOut(quoteInLamports, state)
  if (tokenOut <= 0n) return 0n
  const effectiveQuote = (quoteInLamports * BPS_DENOMINATOR) / (BPS_DENOMINATOR + PUMPSWAP_TOTAL_FEE_BPS)
  state.baseReserve -= tokenOut
  state.quoteReserve += effectiveQuote
  return tokenOut
}

function pumpSwapMarketCapNative(state: PumpSwapState) {
  const quoteSol = Number(state.quoteReserve) / Number(LAMPORTS_PER_SOL)
  const baseTokens = Number(state.baseReserve) / Number(TOKEN_BASE_UNITS)
  return (quoteSol / baseTokens) * (Number(PUMPFUN_TOTAL_SUPPLY_RAW) / Number(TOKEN_BASE_UNITS))
}

function quotePostMigrationTarget(postTargetRaw: bigint) {
  const state = initialPumpSwapState()
  const migrationCapitalLamports = pumpSwapExactInForTargetTokens(postTargetRaw, state)
  const actualPostTokens = applyPumpSwapBuy(state, migrationCapitalLamports)
  return { migrationCapitalLamports, actualPostTokens, marketCapNative: pumpSwapMarketCapNative(state) }
}

function fullCurveCapitalLamports() {
  return applyBpsBuffer(
    pumpfunExactOutCapitalLamports(PUMPFUN_MIGRATION_TOKEN_TARGET_RAW),
    PUMPFUN_PRE_MIGRATION_SLIPPAGE_BPS,
  )
}

/**
 * Quotes Pump.fun capital from a desired total supply-control percentage.
 * Uses Pump.fun exact-out math through migration, then PumpSwap exact-in math.
 */
export function quotePumpfunBySupplyControl(percent: number): PumpfunCapitalQuote {
  const totalTargetRaw = supplyPercentToRaw(percent)
  if (totalTargetRaw <= PUMPFUN_MIGRATION_TOKEN_TARGET_RAW) {
    const curveCapital = pumpfunExactOutCapitalLamports(totalTargetRaw)
    const spendable = pumpfunExactOutSpendableLamports(totalTargetRaw)
    const virtualQuote = 30 + Number(spendable) / Number(LAMPORTS_PER_SOL)
    const virtualTokens = (1_073_000_000_000_000n - totalTargetRaw)
    const marketCapNative = (virtualQuote / (Number(virtualTokens) / Number(TOKEN_BASE_UNITS))) * 1_000_000_000
    return {
      curveCapitalSol: Number(curveCapital) / Number(LAMPORTS_PER_SOL),
      migrationCapitalSol: 0,
      supplyControlPct: (Number(totalTargetRaw) / Number(PUMPFUN_TOTAL_SUPPLY_RAW)) * 100,
      marketCapNative,
    }
  }

  const postTargetRaw = totalTargetRaw - PUMPFUN_MIGRATION_TOKEN_TARGET_RAW
  if (postTargetRaw >= PUMPSWAP_INITIAL_BASE_RESERVE_RAW) throw new Error("Pump.fun supply control must be below 100%.")
  const post = quotePostMigrationTarget(postTargetRaw)
  const totalTokens = PUMPFUN_MIGRATION_TOKEN_TARGET_RAW + post.actualPostTokens
  return {
    curveCapitalSol: Number(fullCurveCapitalLamports()) / Number(LAMPORTS_PER_SOL),
    migrationCapitalSol: Number(post.migrationCapitalLamports) / Number(LAMPORTS_PER_SOL),
    supplyControlPct: (Number(totalTokens) / Number(PUMPFUN_TOTAL_SUPPLY_RAW)) * 100,
    marketCapNative: post.marketCapNative,
  }
}

/**
 * Quotes a post-migration Pump.fun launch from a desired native market cap.
 * A binary search finds the minimum exact token target whose PumpSwap state
 * reaches the requested fully diluted market cap.
 */
export function quotePumpfunMigrationByMarketCap(targetMarketCapNative: number): PumpfunCapitalQuote {
  const initialMarketCap = pumpSwapMarketCapNative(initialPumpSwapState())
  if (!(targetMarketCapNative > initialMarketCap)) throw new Error("That market cap is below Pump.fun migration pricing.")
  let low = 0n
  let high = PUMPSWAP_INITIAL_BASE_RESERVE_RAW - 1n
  while (low < high) {
    const middle = (low + high) / 2n
    const quote = quotePostMigrationTarget(middle)
    if (quote.marketCapNative >= targetMarketCapNative) high = middle
    else low = middle + 1n
  }
  const post = quotePostMigrationTarget(low)
  const totalTokens = PUMPFUN_MIGRATION_TOKEN_TARGET_RAW + post.actualPostTokens
  return {
    curveCapitalSol: Number(fullCurveCapitalLamports()) / Number(LAMPORTS_PER_SOL),
    migrationCapitalSol: Number(post.migrationCapitalLamports) / Number(LAMPORTS_PER_SOL),
    supplyControlPct: (Number(totalTokens) / Number(PUMPFUN_TOTAL_SUPPLY_RAW)) * 100,
    marketCapNative: post.marketCapNative,
  }
}
