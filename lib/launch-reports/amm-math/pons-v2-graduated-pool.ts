/**
 * Deterministic Pons V2 graduated-pool math.
 *
 * When a Pons curve is exhausted the factory sweeps it and seeds one
 * full-range Uniswap V4 position whose price continues the curve's terminal
 * price. Every input to that seed is fixed by the curve's terminal state, so
 * the pool a launch graduates into is known before the launch transaction is
 * sent. This module mirrors the factory's seed arithmetic
 * (`PonsV2LaunchFactory._poolTokenAmount`, `PonsV2GraduationMath`,
 * `LiquidityAmounts.getLiquidityForAmounts`), V4 core's swap loop (one
 * `computeSwapStep` per 256-tick word, exactly as `Pool.swap` walks the tick
 * bitmap), and the meme hook's `afterSwap` skim, so post-graduation buys can
 * be planned with the same exactness as curve buys.
 *
 * The pool's currency ordering depends on the launched token's address. A
 * native launch always has ETH as currency0. An ERC-20 launch's ordering is
 * known once the token address is predicted or observed; until then callers
 * plan against both orderings and keep the conservative side.
 *
 * The swept quote is modelled as the curve's net quote reserve above its
 * phantom reserve, which is what the factory records for a standard pair
 * token. A fee-on-transfer pair token would deliver less to the factory than
 * the curve tracked; Pons does not screen for such tokens at approval, and
 * the delegate's exact-input check fails closed if one is ever approved.
 */

import type { PonsV2CurveState } from './pons-v2-curve.ts';
import {
  computeConcentratedLiquiditySwapStep,
  getUniswapV3LiquidityForAmounts,
  getUniswapV3SqrtRatioAtTick,
  integerSqrt,
  quoteConcentratedLiquiditySingleRangeExactOutput,
  UNISWAP_V3_MAX_SQRT_RATIO,
  UNISWAP_V3_MAX_TICK,
  UNISWAP_V3_MIN_SQRT_RATIO,
  UNISWAP_V3_MIN_TICK,
  UNISWAP_V3_Q96,
  type UniswapV3SingleRangeState,
} from './uniswap-v3.ts';

const BPS_DENOMINATOR = 10_000n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT192 = (1n << 192n) - 1n;
/**
 * V4 narrows position amounts to `int128` in `Pool.modifyLiquidity`, and the
 * Pons graduation guard enforces that same signed bound before the sweep.
 */
const MAX_SEED_AMOUNT = (1n << 127n) - 1n;
const TICK_WORD_BITS = 256;
const LOG_SQRT_10001_FACTOR = 255_738_958_999_603_826_347_141n;
const TICK_LOW_ERROR = 3_402_992_956_809_132_418_596_140_100_660_247_210n;
const TICK_HIGH_ERROR = 291_339_464_771_989_622_907_027_621_153_398_088_495n;

/** Fee terms of the graduated pool, snapshotted from the meme hook at launch. */
export interface PonsV2GraduatedPoolTerms {
  /** Hook fee on every pool swap, from `PonsV2MemeHook.hookFeeBps` at launch. */
  hookFeeBps: number;
  /** Creator tax chosen at launch; charged by the hook on the output leg. */
  creatorTaxBps: number;
  /** Pool LP fee in pips; the factory requires zero for every launch config. */
  poolFeePips: number;
  /** Launch config tick spacing; the position spans the usable full range. */
  tickSpacing: number;
}

/** One deterministic graduated pool: seed facts plus the active range state. */
export interface PonsV2GraduatedPoolState extends PonsV2GraduatedPoolTerms {
  /** Whether the launch token sorts as currency0 (its address is below the quote's). */
  tokenIsCurrency0: boolean;
  /** Quote asset the factory seeded into the pool. */
  seededQuoteWei: bigint;
  /** Launch tokens the factory seeded into the pool. */
  seededTokensWei: bigint;
  /** Launch tokens the factory locked permanently at graduation. */
  lockedTokensWei: bigint;
  tickLower: number;
  tickUpper: number;
  /** Current pool tick, tracked exactly as `Pool.swap` updates `slot0.tick`. */
  tick: number;
  range: UniswapV3SingleRangeState;
}

/** Settlement result for one exact-input post-graduation buy. */
export interface PonsV2PoolBuyQuote {
  quoteInWei: bigint;
  /** Tokens the pool released before the hook skim. */
  grossTokensOutWei: bigint;
  hookFeeWei: bigint;
  creatorTaxWei: bigint;
  /** Tokens the buyer actually receives. */
  tokensOutWei: bigint;
  nextState: PonsV2GraduatedPoolState;
}

/** One authoritative post-graduation allocation in execution order. */
export interface PonsV2PoolAllocation {
  walletId: string;
  tokensOutWei: bigint;
}

/** One planned post-graduation buy derived from an authoritative allocation. */
export interface PonsV2PlannedPoolBuy {
  walletId: string;
  targetTokensOutWei: bigint;
  /** Exact signed input; the maximum over every modelled ordering. */
  quoteInWei: bigint;
  /** Tokens the buyer receives in the least favourable modelled ordering. */
  expectedTokensOutWei: bigint;
  minTokensOutWei: bigint;
}

/** Complete ordered post-graduation plan across every modelled ordering. */
export interface PonsV2PoolPlan {
  buys: PonsV2PlannedPoolBuy[];
  /** Final state per modelled ordering, aligned with the input states. */
  finalStates: PonsV2GraduatedPoolState[];
  totalQuoteInWei: bigint;
  totalExpectedTokensOutWei: bigint;
}

/**
 * Derives the tokens the factory seeds into the pool and locks forever.
 *
 * Mirrors `_poolTokenAmount`: the seeded fraction preserves the curve's
 * terminal price once the virtual reserve is removed, and the remainder is
 * locked in the launch locker.
 *
 * @param input - Swept reserves and the curve's phantom quote.
 * @returns Seeded and locked token amounts.
 * @throws {Error} If the seed rounds to nothing.
 */
export function calculatePonsV2GraduationSeed(input: {
  sweptQuoteWei: bigint;
  sweptTokensWei: bigint;
  phantomQuoteWei: bigint;
}): { seededTokensWei: bigint; lockedTokensWei: bigint } {
  if (input.sweptQuoteWei <= 0n || input.sweptTokensWei <= 0n || input.phantomQuoteWei <= 0n) {
    throw new Error('Pons V2 graduation seed requires positive reserves');
  }
  const seededTokensWei =
    (input.sweptTokensWei * input.sweptQuoteWei) / (input.sweptQuoteWei + input.phantomQuoteWei);
  if (seededTokensWei === 0n) throw new Error('Pons V2 graduation seed rounds to zero');
  return { lockedTokensWei: input.sweptTokensWei - seededTokensWei, seededTokensWei };
}

/**
 * Mirrors `PonsV2GraduationMath.sqrtPriceX96FromAmounts`.
 *
 * @param amount0 - Seed amount of currency0.
 * @param amount1 - Seed amount of currency1.
 * @returns Q64.96 square-root price the factory initializes the pool at.
 * @throws {Error} If either amount is zero or the price is unrepresentable.
 */
export function calculatePonsV2GraduationSqrtPriceX96(amount0: bigint, amount1: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) throw new Error('Pons V2 seed amounts must be positive');
  const fitsQ192 = amount0 > MAX_UINT192 || amount1 < amount0 << 64n;
  if (fitsQ192) {
    return integerSqrt((amount1 << 192n) / amount0);
  }
  const fitsQ128 = amount0 > MAX_UINT128 || amount1 < amount0 << 128n;
  if (!fitsQ128) throw new Error('Pons V2 seed price is unsupported');
  const sqrtPriceX64 = integerSqrt((amount1 << 128n) / amount0);
  if (sqrtPriceX64 > MAX_UINT128) throw new Error('Pons V2 seed price is unsupported');
  return sqrtPriceX64 << 32n;
}

/**
 * Mirrors `TickMath.getTickAtSqrtPrice`: the greatest tick whose sqrt ratio
 * is at or below `sqrtPriceX96`.
 *
 * @param sqrtPriceX96 - Q64.96 square-root price inside the TickMath bounds.
 * @returns Tick, exactly as V4 core stores it in `slot0`.
 * @throws {Error} If the price is outside the TickMath bounds.
 */
export function getPonsV2TickAtSqrtPrice(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < UNISWAP_V3_MIN_SQRT_RATIO || sqrtPriceX96 >= UNISWAP_V3_MAX_SQRT_RATIO) {
    throw new Error('Pons V2 sqrt price is outside TickMath bounds');
  }
  const price = sqrtPriceX96 << 32n;
  const msb = BigInt(price.toString(2).length - 1);
  let r = msb >= 128n ? price >> (msb - 127n) : price << (127n - msb);
  let log2 = (msb - 128n) << 64n;
  for (let shift = 63n; shift >= 50n; shift -= 1n) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log2 |= f << shift;
    r >>= f;
  }
  const logSqrt10001 = log2 * LOG_SQRT_10001_FACTOR;
  const tickLow = Number((logSqrt10001 - TICK_LOW_ERROR) >> 128n);
  const tickHigh = Number((logSqrt10001 + TICK_HIGH_ERROR) >> 128n);
  if (tickLow === tickHigh) return tickLow;
  return getUniswapV3SqrtRatioAtTick(tickHigh) <= sqrtPriceX96 ? tickHigh : tickLow;
}

/**
 * Resolves V4's usable full-range ticks for a tick spacing (truncation toward zero).
 *
 * @param tickSpacing - Pool tick spacing.
 * @returns Lower and upper full-range ticks.
 */
export function resolvePonsV2FullRangeTicks(tickSpacing: number): {
  tickLower: number;
  tickUpper: number;
} {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new Error('Pons V2 tick spacing must be a positive integer');
  }
  return {
    tickLower: Math.trunc(UNISWAP_V3_MIN_TICK / tickSpacing) * tickSpacing,
    tickUpper: Math.trunc(UNISWAP_V3_MAX_TICK / tickSpacing) * tickSpacing,
  };
}

/**
 * Mirrors `Pool.tickSpacingToMaxLiquidityPerTick`.
 *
 * @param tickSpacing - Pool tick spacing.
 * @returns Maximum gross liquidity one initialized tick may carry.
 */
export function calculatePonsV2MaxLiquidityPerTick(tickSpacing: number): bigint {
  let minTick = Math.trunc(UNISWAP_V3_MIN_TICK / tickSpacing);
  if (UNISWAP_V3_MIN_TICK % tickSpacing !== 0) minTick -= 1;
  const maxTick = Math.trunc(UNISWAP_V3_MAX_TICK / tickSpacing);
  return MAX_UINT128 / BigInt(maxTick - minTick + 1);
}

/**
 * Builds the deterministic graduated pool from swept reserves.
 *
 * Runs the same seed derivation and viability checks as the factory and the
 * graduation guard, so a plan that would leave the launch unseedable is
 * rejected before anything is signed.
 *
 * @param input - Swept reserves, phantom quote, pool terms, and ordering.
 * @returns Seed facts and the active full-range state.
 * @throws {Error} If the factory or V4 would reject the seed.
 */
export function buildPonsV2GraduatedPoolState(input: {
  sweptQuoteWei: bigint;
  sweptTokensWei: bigint;
  phantomQuoteWei: bigint;
  terms: PonsV2GraduatedPoolTerms;
  tokenIsCurrency0: boolean;
}): PonsV2GraduatedPoolState {
  validatePoolTerms(input.terms);
  const seed = calculatePonsV2GraduationSeed(input);
  if (input.sweptQuoteWei > MAX_SEED_AMOUNT || seed.seededTokensWei > MAX_SEED_AMOUNT) {
    throw new Error('Pons V2 graduation seed exceeds the V4 amount bound');
  }
  const [amount0, amount1] = input.tokenIsCurrency0
    ? [seed.seededTokensWei, input.sweptQuoteWei]
    : [input.sweptQuoteWei, seed.seededTokensWei];
  const sqrtPriceX96 = calculatePonsV2GraduationSqrtPriceX96(amount0, amount1);
  if (sqrtPriceX96 <= UNISWAP_V3_MIN_SQRT_RATIO || sqrtPriceX96 >= UNISWAP_V3_MAX_SQRT_RATIO) {
    throw new Error('Pons V2 graduation price is outside V4 bounds');
  }
  const { tickLower, tickUpper } = resolvePonsV2FullRangeTicks(input.terms.tickSpacing);
  const sqrtPriceLowerX96 = getUniswapV3SqrtRatioAtTick(tickLower);
  const sqrtPriceUpperX96 = getUniswapV3SqrtRatioAtTick(tickUpper);
  const liquidity = getUniswapV3LiquidityForAmounts(
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    amount0,
    amount1,
  );
  if (liquidity <= 0n || liquidity > calculatePonsV2MaxLiquidityPerTick(input.terms.tickSpacing)) {
    throw new Error('Pons V2 graduation seed is not mintable');
  }
  return {
    ...input.terms,
    lockedTokensWei: seed.lockedTokensWei,
    range: { liquidity, sqrtPriceLowerX96, sqrtPriceUpperX96, sqrtPriceX96 },
    seededQuoteWei: input.sweptQuoteWei,
    seededTokensWei: seed.seededTokensWei,
    tick: getPonsV2TickAtSqrtPrice(sqrtPriceX96),
    tickLower,
    tickUpper,
    tokenIsCurrency0: input.tokenIsCurrency0,
  };
}

/**
 * Builds the graduated pool implied by an exhausted curve state.
 *
 * The swept quote is the curve's net quote reserve above the phantom reserve
 * (fees leave the curve in the same sweep), and the swept tokens are the
 * curve's remaining reserve, which equals its reserved allocation once the
 * sellable allocation is exhausted.
 *
 * @param input - Terminal curve state, phantom quote, pool terms, and ordering.
 * @returns Graduated pool state.
 * @throws {Error} If the curve is not exhausted.
 */
export function buildPonsV2GraduatedPoolFromCurve(input: {
  curveState: PonsV2CurveState;
  phantomQuoteWei: bigint;
  terms: PonsV2GraduatedPoolTerms;
  tokenIsCurrency0: boolean;
}): PonsV2GraduatedPoolState {
  if (input.curveState.sellableTokensWei !== 0n) {
    throw new Error('Pons V2 curve must be exhausted before it graduates');
  }
  return buildPonsV2GraduatedPoolState({
    phantomQuoteWei: input.phantomQuoteWei,
    sweptQuoteWei: input.curveState.quoteReserveWei - input.phantomQuoteWei,
    sweptTokensWei: input.curveState.tokenReserveWei,
    terms: input.terms,
    tokenIsCurrency0: input.tokenIsCurrency0,
  });
}

/**
 * Quotes one exact-input pool buy in the exact V4 and hook arithmetic order.
 *
 * Walks the pool exactly as `Pool.swap` does: one `computeSwapStep` per tick
 * word (the bitmap returns the word boundary when no initialized tick lies
 * within it), tick updated the way core updates `slot0.tick`, and the swap
 * stopping when the input is spent. Reaching the position's own boundary
 * means the seeded liquidity is exhausted and is rejected. The pool then
 * releases the gross output and `afterSwap` floors the hook fee and creator
 * tax independently on that output and keeps both.
 *
 * @param state - Pool state immediately before the buy.
 * @param quoteInWei - Exact quote input.
 * @returns Gross and net outputs, fees, and the next pool state.
 * @throws {Error} If the input is invalid or the swap would leave the range.
 */
export function quotePonsV2PoolBuyExactIn(
  state: PonsV2GraduatedPoolState,
  quoteInWei: bigint,
): PonsV2PoolBuyQuote {
  validatePoolTerms(state);
  if (quoteInWei <= 0n) throw new Error('Pons V2 pool buy input must be positive');
  const zeroForOne = !state.tokenIsCurrency0;
  const boundaryTick = zeroForOne ? state.tickLower : state.tickUpper;
  const limit = zeroForOne ? state.range.sqrtPriceLowerX96 : state.range.sqrtPriceUpperX96;

  let sqrtPriceX96 = state.range.sqrtPriceX96;
  let tick = state.tick;
  let remaining = quoteInWei;
  let grossTokensOutWei = 0n;
  while (remaining !== 0n && sqrtPriceX96 !== limit) {
    let tickNext = resolveNextTickWithinWord(tick, state.tickSpacing, zeroForOne);
    if (tickNext <= UNISWAP_V3_MIN_TICK) tickNext = UNISWAP_V3_MIN_TICK;
    if (tickNext >= UNISWAP_V3_MAX_TICK) tickNext = UNISWAP_V3_MAX_TICK;
    const sqrtPriceNextX96 = getUniswapV3SqrtRatioAtTick(tickNext);
    const target = zeroForOne
      ? sqrtPriceNextX96 < limit
        ? limit
        : sqrtPriceNextX96
      : sqrtPriceNextX96 > limit
        ? limit
        : sqrtPriceNextX96;
    const step = computeConcentratedLiquiditySwapStep({
      amountRemaining: remaining,
      exactIn: true,
      feePips: state.poolFeePips,
      liquidity: state.range.liquidity,
      sqrtPriceCurrentX96: sqrtPriceX96,
      sqrtPriceTargetX96: target,
    });
    const start = sqrtPriceX96;
    sqrtPriceX96 = step.sqrtPriceNextX96;
    remaining -= step.amountIn + step.feeAmount;
    grossTokensOutWei += step.amountOut;
    if (sqrtPriceX96 === sqrtPriceNextX96) {
      if (tickNext === boundaryTick || sqrtPriceX96 === limit) {
        throw new Error('Pons V2 pool buy exceeds the seeded range');
      }
      tick = zeroForOne ? tickNext - 1 : tickNext;
    } else if (sqrtPriceX96 !== start) {
      tick = getPonsV2TickAtSqrtPrice(sqrtPriceX96);
    }
  }
  if (remaining !== 0n) throw new Error('Pons V2 pool buy exceeds the seeded range');

  const fees = calculateHookSkim(grossTokensOutWei, state);
  return {
    creatorTaxWei: fees.creatorTaxWei,
    grossTokensOutWei,
    hookFeeWei: fees.hookFeeWei,
    nextState: { ...state, range: { ...state.range, sqrtPriceX96 }, tick },
    quoteInWei,
    tokensOutWei: grossTokensOutWei - fees.hookFeeWei - fees.creatorTaxWei,
  };
}

/**
 * Solves the minimum exact quote input that delivers a token target net of
 * the hook skim, proven by forwarding the chosen input and one unit less.
 *
 * The single-range exact-output quote seeds the search; the exact word-by-word
 * forward quote decides, so the answer is minimal under core's own rounding.
 *
 * @param state - Pool state immediately before the buy.
 * @param targetTokensOutWei - Required net token output.
 * @returns Minimal input and its exact forward quote.
 * @throws {Error} If the target is zero or unreachable inside the range.
 */
export function solvePonsV2PoolBuyForTokens(
  state: PonsV2GraduatedPoolState,
  targetTokensOutWei: bigint,
): PonsV2PoolBuyQuote {
  validatePoolTerms(state);
  if (targetTokensOutWei <= 0n) throw new Error('Pons V2 pool target must be positive');
  const skimBps = BigInt(state.hookFeeBps + state.creatorTaxBps);
  let grossTarget = (targetTokensOutWei * BPS_DENOMINATOR) / (BPS_DENOMINATOR - skimBps);
  while (netAfterSkim(grossTarget, state) < targetTokensOutWei) grossTarget += 1n;

  const zeroForOne = !state.tokenIsCurrency0;
  const exactOut = quoteConcentratedLiquiditySingleRangeExactOutput(
    state.range,
    grossTarget,
    state.poolFeePips,
    zeroForOne,
  );
  if (exactOut.insufficientLiquidity || exactOut.amountOut < grossTarget) {
    throw new Error('Pons V2 pool target exceeds the seeded range');
  }
  let quoteInWei = exactOut.amountIn;
  let quote = quotePonsV2PoolBuyExactIn(state, quoteInWei);
  while (quote.tokensOutWei < targetTokensOutWei) {
    quoteInWei += 1n;
    quote = quotePonsV2PoolBuyExactIn(state, quoteInWei);
  }
  while (quoteInWei > 1n) {
    const previous = quotePonsV2PoolBuyExactIn(state, quoteInWei - 1n);
    if (previous.tokensOutWei < targetTokensOutWei) break;
    quoteInWei -= 1n;
    quote = previous;
  }
  return quote;
}

/**
 * Plans every post-graduation buy in saved order across the modelled orderings.
 *
 * With one state (ordering known) the plan is exact. With both orderings the
 * signed input is the larger requirement and the expected output the smaller
 * delivery, so the plan stays safe whichever address the token receives.
 *
 * @param input - One or two pool states, ordered allocations, and slippage.
 * @returns Ordered buys and the final state per modelled ordering.
 * @throws {Error} If allocations or slippage are invalid.
 */
export function planPonsV2PoolBuys(input: {
  poolStates: readonly PonsV2GraduatedPoolState[];
  allocations: readonly PonsV2PoolAllocation[];
  slippageBps: number;
}): PonsV2PoolPlan {
  if (input.poolStates.length < 1 || input.poolStates.length > 2) {
    throw new Error('Pons V2 pool planning models one or two currency orderings');
  }
  if (input.allocations.length === 0) {
    throw new Error('Pons V2 pool planning requires at least one allocation');
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('Pons V2 slippage must be between 0 and 5000 bps');
  }
  if (new Set(input.allocations.map((a) => a.walletId)).size !== input.allocations.length) {
    throw new Error('Pons V2 pool buyer wallet ids must be unique');
  }

  let states = [...input.poolStates];
  const buys: PonsV2PlannedPoolBuy[] = [];
  let totalQuoteInWei = 0n;
  let totalExpectedTokensOutWei = 0n;
  for (const allocation of input.allocations) {
    if (allocation.tokensOutWei <= 0n) {
      throw new Error(`Pons V2 pool target must be positive for wallet ${allocation.walletId}`);
    }
    let quoteInWei = 0n;
    for (const state of states) {
      const solved = solvePonsV2PoolBuyForTokens(state, allocation.tokensOutWei);
      if (solved.quoteInWei > quoteInWei) quoteInWei = solved.quoteInWei;
    }
    const forwards = states.map((state) => quotePonsV2PoolBuyExactIn(state, quoteInWei));
    const expectedTokensOutWei = forwards.reduce(
      (minimum, quote) => (quote.tokensOutWei < minimum ? quote.tokensOutWei : minimum),
      forwards[0]?.tokensOutWei ?? 0n,
    );
    const minTokensOutWei =
      (allocation.tokensOutWei * BigInt(10_000 - input.slippageBps)) / BPS_DENOMINATOR;
    if (minTokensOutWei <= 0n) {
      throw new Error(`Pons V2 pool minimum output is zero for wallet ${allocation.walletId}`);
    }
    buys.push({
      expectedTokensOutWei,
      minTokensOutWei,
      quoteInWei,
      targetTokensOutWei: allocation.tokensOutWei,
      walletId: allocation.walletId,
    });
    states = forwards.map((quote) => quote.nextState);
    totalQuoteInWei += quoteInWei;
    totalExpectedTokensOutWei += expectedTokensOutWei;
  }
  return { buys, finalStates: states, totalExpectedTokensOutWei, totalQuoteInWei };
}

/**
 * Calculates the pool's marginal price as quote raw units per token raw unit.
 *
 * @param state - Pool state.
 * @returns WAD-scaled marginal price.
 */
export function calculatePonsV2PoolSpotPriceWad(state: PonsV2GraduatedPoolState): bigint {
  const sqrt = state.range.sqrtPriceX96;
  if (sqrt <= 0n) throw new Error('Pons V2 pool spot price requires a positive sqrt price');
  // sqrtPriceX96^2 / 2^192 is currency1 per currency0.
  return state.tokenIsCurrency0
    ? (sqrt * sqrt * 10n ** 18n) / (UNISWAP_V3_Q96 * UNISWAP_V3_Q96)
    : (UNISWAP_V3_Q96 * UNISWAP_V3_Q96 * 10n ** 18n) / (sqrt * sqrt);
}

/**
 * Mirrors `TickBitmap.nextInitializedTickWithinOneWord` for a bitmap whose
 * only initialized ticks are the position's own boundaries: with nothing
 * initialized inside the word, core returns the word's edge tick.
 *
 * Shared by every single-position pool walk (Pons graduated pools and
 * lunch.fun launch pools).
 *
 * @param tick - Current pool tick.
 * @param tickSpacing - Pool tick spacing.
 * @param zeroForOne - Swap direction.
 * @returns The next word-boundary tick core would step to.
 */
export function resolveNextTickWithinWord(
  tick: number,
  tickSpacing: number,
  zeroForOne: boolean,
): number {
  let compressed = Math.floor(tick / tickSpacing);
  if (zeroForOne) {
    const bitPos = compressed & (TICK_WORD_BITS - 1);
    return (compressed - bitPos) * tickSpacing;
  }
  compressed += 1;
  const bitPos = compressed & (TICK_WORD_BITS - 1);
  return (compressed + (TICK_WORD_BITS - 1 - bitPos)) * tickSpacing;
}

function calculateHookSkim(
  grossTokensOutWei: bigint,
  terms: PonsV2GraduatedPoolTerms,
): { hookFeeWei: bigint; creatorTaxWei: bigint } {
  return {
    creatorTaxWei: (grossTokensOutWei * BigInt(terms.creatorTaxBps)) / BPS_DENOMINATOR,
    hookFeeWei: (grossTokensOutWei * BigInt(terms.hookFeeBps)) / BPS_DENOMINATOR,
  };
}

function netAfterSkim(grossTokensOutWei: bigint, terms: PonsV2GraduatedPoolTerms): bigint {
  const skim = calculateHookSkim(grossTokensOutWei, terms);
  return grossTokensOutWei - skim.hookFeeWei - skim.creatorTaxWei;
}

function validatePoolTerms(terms: PonsV2GraduatedPoolTerms): void {
  if (
    !Number.isInteger(terms.hookFeeBps) ||
    !Number.isInteger(terms.creatorTaxBps) ||
    terms.hookFeeBps < 0 ||
    terms.creatorTaxBps < 0 ||
    terms.hookFeeBps + terms.creatorTaxBps >= 10_000
  ) {
    throw new Error('Invalid Pons V2 pool fee configuration');
  }
  if (!Number.isInteger(terms.poolFeePips) || terms.poolFeePips < 0 || terms.poolFeePips >= 1e6) {
    throw new Error('Invalid Pons V2 pool LP fee');
  }
  if (
    !Number.isInteger(terms.tickSpacing) ||
    terms.tickSpacing <= 0 ||
    terms.tickSpacing > 32_767
  ) {
    throw new Error('Invalid Pons V2 pool tick spacing');
  }
}
