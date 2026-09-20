/**
 * Deterministic lunch.fun launch math.
 *
 * lunch.fun has no bonding curve. The pair launchers mint the whole supply
 * into one single-sided position of the pool the coin trades on from block
 * one: a Uniswap V3 1% pool (fair launch) or a hooked Uniswap V4 0.3% pool
 * (tax launch, with or without holder rewards). Both seed the same geometry
 * from a per-quote tick magnitude, so one state builder and one swap walk
 * cover both branches. The V4 tax hook takes `amount * bps / 10000` from the
 * quote side of every buy before the pool swaps the remainder; routing part
 * of the creator's tax to holders changes nothing about the swap.
 *
 * Fills are quoted exactly as V3 and V4 core do: one `computeSwapStep` per
 * 256-tick word, with the tick tracked the way core updates `slot0.tick`.
 */

import { getPonsV2TickAtSqrtPrice, resolveNextTickWithinWord } from './pons-v2-graduated-pool.ts';
import {
  computeConcentratedLiquiditySwapStep,
  getUniswapV3LiquidityForAmounts,
  getUniswapV3SqrtRatioAtTick,
  quoteConcentratedLiquiditySingleRangeExactOutput,
  UNISWAP_V3_MAX_TICK,
  UNISWAP_V3_MIN_TICK,
  UNISWAP_V3_Q96,
  type UniswapV3SingleRangeState,
} from './uniswap-v3.ts';

const BPS_DENOMINATOR = 10_000n;
const MAX_UINT128 = (1n << 128n) - 1n;
/** V4 narrows position amounts to `int128`; the V4 pair launcher enforces it. */
const MAX_INT128 = (1n << 127n) - 1n;

/** Both lunch.fun pool tiers use a 200-tick spacing. */
export const LUNCH_FUN_TICK_SPACING = 200;
/** V3 fair-launch pool fee, in pips (1%). */
export const LUNCH_FUN_V3_POOL_FEE_PIPS = 10_000;
/** V4 tax-launch pool LP fee, in pips (0.3%). */
export const LUNCH_FUN_V4_POOL_FEE_PIPS = 3_000;
/** `LunchTaxHookPair.MAX_SIDE_BPS`: 5% per side. */
export const LUNCH_FUN_MAX_TAX_BPS = 500;
/** `LunchLaunchDelegate.MAX_REWARDS_BPS`: the whole creator share may go to holders. */
export const LUNCH_FUN_MAX_REWARDS_BPS = 10_000;
/** USD worth of accrued tax at which a holder-rewards pool distributes in-swap. */
/** Product cap on bundle wallets; the delegate itself allows 99. */
export const LUNCH_FUN_MAX_BUNDLE_WALLETS = 32;
/** Most of the supply a bundle may control; beyond this the last buys price in tens of quote. */
export const LUNCH_FUN_MAX_SUPPLY_CONTROL_PCT = 90;
/** Supply bounds: the seed must mint non-zero liquidity and fit V4's `int128`. */
export const LUNCH_FUN_MIN_SUPPLY_WEI = 1_000_000n * 10n ** 18n;
export const LUNCH_FUN_MAX_SUPPLY_WEI = MAX_INT128;
/** Default lunch.fun supply, the one its own site presents. */
export const LUNCH_FUN_DEFAULT_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/**
 * Launch branch: the frozen V3 pair launcher, the V4 tax pair launcher, or
 * the V4 launcher's holder-rewards path (same hooked pool, dividend coin).
 */
export type LunchFunLaunchKind = 'v3' | 'v4_tax' | 'v4_rewards';

/**
 * Whether a launch kind trades on the hooked Uniswap V4 pool.
 *
 * Both V4 kinds share the launcher, the tax hook, the pool key, the tax
 * math, and the receipt shape; only the coin contract and the tax routing
 * differ.
 *
 * @param kind - Launch branch.
 * @returns True for `v4_tax` and `v4_rewards`.
 */
export function isLunchFunV4Kind(kind: LunchFunLaunchKind): boolean {
  return kind === 'v4_tax' || kind === 'v4_rewards';
}

/** Fee terms of one lunch.fun launch pool. */
export interface LunchFunPoolTerms {
  kind: LunchFunLaunchKind;
  /** Creator buy tax the hook skims from the quote input; zero on V3. */
  buyTaxBps: number;
}

/** One deterministic launch pool: seed facts plus the active range state. */
export interface LunchFunPoolState extends LunchFunPoolTerms {
  /** Whether the coin sorts as token0 (its address is below the quote's). */
  tokenIsToken0: boolean;
  poolFeePips: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  /** Current pool tick, tracked exactly as core updates `slot0.tick`. */
  tick: number;
  range: UniswapV3SingleRangeState;
}

/** Settlement result for one exact-input buy. */
export interface LunchFunBuyQuote {
  quoteInWei: bigint;
  /** Quote the hook kept before the swap; zero on V3. */
  taxWei: bigint;
  tokensOutWei: bigint;
  nextState: LunchFunPoolState;
}

/** One percentage-derived target in execution order. */
export interface LunchFunLaunchAllocation {
  role: 'bundle' | 'dev';
  targetTokensOutWei: bigint;
  walletId: string;
}

/** One exact-input buy derived from a target token allocation. */
export interface LunchFunPlannedBuy extends LunchFunLaunchAllocation {
  /** Exact signed input; the maximum over every modelled ordering. */
  quoteInWei: bigint;
  /** Tokens the buyer receives in the least favourable modelled ordering. */
  expectedTokensOutWei: bigint;
  minTokensOutWei: bigint;
}

/** Complete ordered opening-buy plan across every modelled ordering. */
export interface LunchFunLaunchPlan {
  buys: LunchFunPlannedBuy[];
  /** Final state per modelled ordering, aligned with the input states. */
  finalStates: LunchFunPoolState[];
  totalQuoteInWei: bigint;
  totalExpectedTokensOutWei: bigint;
}

/**
 * Resolves the usable full-range ticks at the lunch.fun spacing, exactly as
 * both launchers truncate `TickMath.MIN_TICK / spacing * spacing`.
 *
 * @returns Minimum and maximum usable ticks.
 */
export function resolveLunchFunUsableTicks(): { minUsable: number; maxUsable: number } {
  return {
    maxUsable: Math.trunc(UNISWAP_V3_MAX_TICK / LUNCH_FUN_TICK_SPACING) * LUNCH_FUN_TICK_SPACING,
    minUsable: Math.trunc(UNISWAP_V3_MIN_TICK / LUNCH_FUN_TICK_SPACING) * LUNCH_FUN_TICK_SPACING,
  };
}

/**
 * Mirrors the launchers' seed: the aligned magnitude sets the launch tick on
 * the coin's side of parity, the range runs from there to the usable bound,
 * and the whole supply becomes single-sided liquidity through the same
 * `LiquidityAmounts` formula the V3 position manager and V4 locker use.
 *
 * @param input.supplyWei - Whole supply the launcher mints into the position.
 * @param input.magnitude - Live `pairMagnitude` (or `launchTickMagnitude` for WETH).
 * @param input.tokenIsToken0 - Whether the coin sorts below the quote.
 * @param input.terms - Launch branch and creator buy tax.
 * @returns Canonical pool state before the first buy.
 * @throws {Error} When the seed would not be mintable.
 */
export function buildLunchFunInitialState(input: {
  supplyWei: bigint;
  magnitude: number;
  tokenIsToken0: boolean;
  terms: LunchFunPoolTerms;
}): LunchFunPoolState {
  validateTerms(input.terms);
  if (input.supplyWei <= 0n || input.supplyWei > LUNCH_FUN_MAX_SUPPLY_WEI) {
    throw new Error('lunch.fun supply is outside the launcher bounds');
  }
  if (!Number.isInteger(input.magnitude) || input.magnitude <= 0) {
    throw new Error('lunch.fun pair magnitude must be a positive tick count');
  }
  const { maxUsable, minUsable } = resolveLunchFunUsableTicks();
  const alignedMagnitude =
    Math.trunc(input.magnitude / LUNCH_FUN_TICK_SPACING) * LUNCH_FUN_TICK_SPACING;
  if (alignedMagnitude <= 0 || alignedMagnitude >= maxUsable) {
    throw new Error('lunch.fun pair magnitude is outside the usable tick range');
  }
  const launchTick = input.tokenIsToken0 ? -alignedMagnitude : alignedMagnitude;
  const tickLower = input.tokenIsToken0 ? launchTick : minUsable;
  const tickUpper = input.tokenIsToken0 ? maxUsable : launchTick;
  const sqrtPriceLowerX96 = getUniswapV3SqrtRatioAtTick(tickLower);
  const sqrtPriceUpperX96 = getUniswapV3SqrtRatioAtTick(tickUpper);
  const sqrtPriceX96 = getUniswapV3SqrtRatioAtTick(launchTick);
  const liquidity = getUniswapV3LiquidityForAmounts(
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    input.tokenIsToken0 ? input.supplyWei : 0n,
    input.tokenIsToken0 ? 0n : input.supplyWei,
  );
  if (liquidity <= 0n || liquidity > MAX_UINT128) {
    throw new Error('lunch.fun seed liquidity does not fit uint128');
  }
  return {
    ...input.terms,
    poolFeePips:
      input.terms.kind === 'v3' ? LUNCH_FUN_V3_POOL_FEE_PIPS : LUNCH_FUN_V4_POOL_FEE_PIPS,
    range: { liquidity, sqrtPriceLowerX96, sqrtPriceUpperX96, sqrtPriceX96 },
    tick: launchTick,
    tickLower,
    tickSpacing: LUNCH_FUN_TICK_SPACING,
    tickUpper,
    tokenIsToken0: input.tokenIsToken0,
  };
}

/**
 * Calculates the tax the V4 hook keeps from a quote input.
 *
 * Mirrors `LunchTaxHookPair._taxOn`: `FullMath.mulDiv(amount, bps * 100, 1e6)`.
 *
 * @param quoteInWei - Signed exact input.
 * @param buyTaxBps - Creator buy tax.
 * @returns Quote kept by the hook, rounded down.
 */
export function calculateLunchFunBuyTax(quoteInWei: bigint, buyTaxBps: number): bigint {
  if (buyTaxBps === 0 || quoteInWei === 0n) return 0n;
  return (quoteInWei * BigInt(buyTaxBps) * 100n) / 1_000_000n;
}

/**
 * Quotes one exact-input buy in the exact core arithmetic order.
 *
 * Walks the pool exactly as `Pool.swap` does: one `computeSwapStep` per tick
 * word, tick updated the way core updates `slot0.tick`, and the swap
 * stopping when the input is spent. Reaching the position's own boundary
 * means the seeded liquidity is exhausted and is rejected: the delegate
 * requires full input consumption.
 *
 * @param state - Pool state immediately before the buy.
 * @param quoteInWei - Exact quote input, tax included.
 * @returns Tax, output, and the next pool state.
 * @throws {Error} If the input is invalid or the swap would leave the range.
 */
export function quoteLunchFunBuyExactIn(
  state: LunchFunPoolState,
  quoteInWei: bigint,
): LunchFunBuyQuote {
  validateTerms(state);
  if (quoteInWei <= 0n) throw new Error('lunch.fun buy input must be positive');
  const taxWei = isLunchFunV4Kind(state.kind)
    ? calculateLunchFunBuyTax(quoteInWei, state.buyTaxBps)
    : 0n;
  const zeroForOne = !state.tokenIsToken0;
  const boundaryTick = zeroForOne ? state.tickLower : state.tickUpper;
  const limit = zeroForOne ? state.range.sqrtPriceLowerX96 : state.range.sqrtPriceUpperX96;

  let sqrtPriceX96 = state.range.sqrtPriceX96;
  let tick = state.tick;
  let remaining = quoteInWei - taxWei;
  if (remaining <= 0n) throw new Error('lunch.fun buy input is consumed by the tax');
  let tokensOutWei = 0n;
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
    tokensOutWei += step.amountOut;
    if (sqrtPriceX96 === sqrtPriceNextX96) {
      if (tickNext === boundaryTick || sqrtPriceX96 === limit) {
        throw new Error('lunch.fun buy exceeds the seeded range');
      }
      tick = zeroForOne ? tickNext - 1 : tickNext;
    } else if (sqrtPriceX96 !== start) {
      tick = getPonsV2TickAtSqrtPrice(sqrtPriceX96);
    }
  }
  if (remaining !== 0n) throw new Error('lunch.fun buy exceeds the seeded range');
  return {
    nextState: { ...state, range: { ...state.range, sqrtPriceX96 }, tick },
    quoteInWei,
    taxWei,
    tokensOutWei,
  };
}

/**
 * Solves the minimum exact quote input that delivers a token target, proven
 * by forwarding the chosen input and one unit less.
 *
 * The single-range exact-output quote seeds the search (grossed up for the
 * tax); the exact word-by-word forward quote decides, so the answer is
 * minimal under core's own rounding.
 *
 * @param state - Pool state immediately before the buy.
 * @param targetTokensOutWei - Required token output.
 * @returns Minimal input and its exact forward quote.
 * @throws {Error} If the target is zero or unreachable inside the range.
 */
export function solveLunchFunBuyForTokens(
  state: LunchFunPoolState,
  targetTokensOutWei: bigint,
): LunchFunBuyQuote {
  validateTerms(state);
  if (targetTokensOutWei <= 0n) throw new Error('lunch.fun buy target must be positive');
  const zeroForOne = !state.tokenIsToken0;
  const exactOut = quoteConcentratedLiquiditySingleRangeExactOutput(
    state.range,
    targetTokensOutWei,
    state.poolFeePips,
    zeroForOne,
  );
  if (exactOut.insufficientLiquidity || exactOut.amountOut < targetTokensOutWei) {
    throw new Error('lunch.fun buy target exceeds the seeded range');
  }
  const taxBps = isLunchFunV4Kind(state.kind) ? BigInt(state.buyTaxBps) : 0n;
  let quoteInWei =
    (exactOut.amountIn * BPS_DENOMINATOR + (BPS_DENOMINATOR - taxBps) - 1n) /
    (BPS_DENOMINATOR - taxBps);
  if (quoteInWei <= 0n) quoteInWei = 1n;
  let quote = quoteLunchFunBuyExactIn(state, quoteInWei);
  while (quote.tokensOutWei < targetTokensOutWei) {
    quoteInWei += 1n;
    quote = quoteLunchFunBuyExactIn(state, quoteInWei);
  }
  while (quoteInWei > 1n) {
    let previous: LunchFunBuyQuote;
    try {
      previous = quoteLunchFunBuyExactIn(state, quoteInWei - 1n);
    } catch {
      break;
    }
    if (previous.tokensOutWei < targetTokensOutWei) break;
    quoteInWei -= 1n;
    quote = previous;
  }
  return quote;
}

/**
 * Plans every opening buy in saved order across the modelled orderings.
 *
 * With one state (V3, salted, ordering predicted) the plan is exact. With
 * both orderings (V4, the launcher salts by block number) the signed input is
 * the larger requirement and the expected output the smaller delivery, so the
 * plan stays safe whichever address the coin receives.
 *
 * @param input - One or two pool states, ordered allocations, and slippage.
 * @returns Ordered buys and the final state per modelled ordering.
 * @throws {Error} If allocations or slippage are invalid.
 */
export function planLunchFunLaunchBuys(input: {
  poolStates: readonly LunchFunPoolState[];
  allocations: readonly LunchFunLaunchAllocation[];
  slippageBps: number;
}): LunchFunLaunchPlan {
  if (input.poolStates.length < 1 || input.poolStates.length > 2) {
    throw new Error('lunch.fun planning models one or two token orderings');
  }
  if (input.allocations.length === 0) {
    throw new Error('lunch.fun planning requires at least one allocation');
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('lunch.fun slippage must be between 0 and 5000 bps');
  }
  if (new Set(input.allocations.map((a) => a.walletId)).size !== input.allocations.length) {
    throw new Error('lunch.fun buyer wallet ids must be unique');
  }
  const devIndex = input.allocations.findIndex((allocation) => allocation.role === 'dev');
  if (devIndex > 0 || input.allocations.filter((a) => a.role === 'dev').length > 1) {
    throw new Error('lunch.fun dev allocation must be first and unique');
  }

  let states = [...input.poolStates];
  const buys: LunchFunPlannedBuy[] = [];
  let totalQuoteInWei = 0n;
  let totalExpectedTokensOutWei = 0n;
  for (const allocation of input.allocations) {
    if (allocation.targetTokensOutWei <= 0n) {
      throw new Error(`lunch.fun target must be positive for wallet ${allocation.walletId}`);
    }
    let quoteInWei = 0n;
    for (const state of states) {
      const solved = solveLunchFunBuyForTokens(state, allocation.targetTokensOutWei);
      if (solved.quoteInWei > quoteInWei) quoteInWei = solved.quoteInWei;
    }
    const forwards = states.map((state) => quoteLunchFunBuyExactIn(state, quoteInWei));
    const expectedTokensOutWei = forwards.reduce(
      (minimum, quote) => (quote.tokensOutWei < minimum ? quote.tokensOutWei : minimum),
      forwards[0]?.tokensOutWei ?? 0n,
    );
    const minTokensOutWei =
      (allocation.targetTokensOutWei * BigInt(10_000 - input.slippageBps)) / BPS_DENOMINATOR;
    if (minTokensOutWei <= 0n) {
      throw new Error(`lunch.fun minimum output is zero for wallet ${allocation.walletId}`);
    }
    buys.push({
      expectedTokensOutWei,
      minTokensOutWei,
      quoteInWei,
      role: allocation.role,
      targetTokensOutWei: allocation.targetTokensOutWei,
      walletId: allocation.walletId,
    });
    states = forwards.map((quote) => quote.nextState);
    totalQuoteInWei += quoteInWei;
    totalExpectedTokensOutWei += expectedTokensOutWei;
  }
  return { buys, finalStates: states, totalExpectedTokensOutWei, totalQuoteInWei };
}

/**
 * Calculates the pool's marginal price as quote raw units per coin raw unit.
 *
 * @param state - Pool state.
 * @returns WAD-scaled marginal price.
 */
export function calculateLunchFunSpotPriceWad(state: LunchFunPoolState): bigint {
  const sqrt = state.range.sqrtPriceX96;
  if (sqrt <= 0n) throw new Error('lunch.fun spot price requires a positive sqrt price');
  // sqrtPriceX96^2 / 2^192 is token1 per token0.
  return state.tokenIsToken0
    ? (sqrt * sqrt * 10n ** 18n) / (UNISWAP_V3_Q96 * UNISWAP_V3_Q96)
    : (UNISWAP_V3_Q96 * UNISWAP_V3_Q96 * 10n ** 18n) / (sqrt * sqrt);
}

function validateTerms(terms: LunchFunPoolTerms): void {
  if (terms.kind !== 'v3' && !isLunchFunV4Kind(terms.kind)) {
    throw new Error('lunch.fun launch kind must be v3, v4_tax, or v4_rewards');
  }
  if (
    !Number.isInteger(terms.buyTaxBps) ||
    terms.buyTaxBps < 0 ||
    terms.buyTaxBps > LUNCH_FUN_MAX_TAX_BPS ||
    (terms.kind === 'v3' && terms.buyTaxBps !== 0)
  ) {
    throw new Error('lunch.fun buy tax is invalid for the launch kind');
  }
}
