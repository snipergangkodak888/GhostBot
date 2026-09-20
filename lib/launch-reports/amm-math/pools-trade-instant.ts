/**
 * Deterministic percentage-first planning for Pools Instant Launch.
 *
 * Pools creates one hookless native/token Uniswap V4 position with immutable
 * launch parameters. This adapter deliberately reuses the canonical
 * concentrated-liquidity arithmetic in `uniswap-v3.ts`; it only supplies the
 * Pools constants and ordered allocation semantics.
 */

import {
  getUniswapV3SqrtRatioAtTick,
  quoteConcentratedLiquiditySingleRangeExactInput,
  quoteConcentratedLiquiditySingleRangeExactOutput,
  UNISWAP_V3_Q96,
  type UniswapV3SingleRangeState,
} from './uniswap-v3.ts';

export const POOLS_TRADE_TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;
export const POOLS_TRADE_LP_FEE_PIPS = 2_500;
export const POOLS_TRADE_TICK_SPACING = 25;
export const POOLS_TRADE_MIN_LAUNCH_TICK = -160_100;
export const POOLS_TRADE_INITIAL_TICK = 198_050;
export const POOLS_TRADE_INITIAL_SQRT_PRICE_X96 = 1_582_215_647_010_010_450_556_252_328_775_749n;
export const POOLS_TRADE_POSITION_LIQUIDITY = 50_074_188_046_840_591_947_412n;
/** Product cap proven below the 30M buffered transaction envelope on a production fork. */
export const POOLS_TRADE_MAX_BUYERS = 128;
/** Product cap leaves at least 1% of the fixed V4 range inventory public. */
export const POOLS_TRADE_MAX_SUPPLY_CONTROL_PCT = 99;

/** Immutable InstantLaunchStrategy curve terms pinned into a launch plan. */
export interface PoolsTradeInstantTerms {
  initialTick: number;
  initialSqrtPriceX96: bigint;
  positionLiquidity: bigint;
}

/** One percentage-derived exact token target in execution order. */
export interface PoolsTradeLaunchAllocation {
  role: 'bundle' | 'dev';
  targetTokensOutWei: bigint;
  walletId: string;
}

/** One exact-input buy derived from a Pools percentage allocation. */
export interface PoolsTradePlannedBuy extends PoolsTradeLaunchAllocation {
  expectedTokensOutWei: bigint;
  minTokensOutWei: bigint;
  quoteInWei: bigint;
}

/** Complete ordered Pools opening-buy plan. */
export interface PoolsTradeLaunchPlan {
  buys: PoolsTradePlannedBuy[];
  finalState: UniswapV3SingleRangeState;
  totalQuoteInWei: bigint;
  totalTokensOutWei: bigint;
}

/** Official immutable terms shared by both deployed Instant Launch strategies. */
export const POOLS_TRADE_OFFICIAL_TERMS: PoolsTradeInstantTerms = {
  initialSqrtPriceX96: POOLS_TRADE_INITIAL_SQRT_PRICE_X96,
  initialTick: POOLS_TRADE_INITIAL_TICK,
  positionLiquidity: POOLS_TRADE_POSITION_LIQUIDITY,
};

/**
 * Returns the current native-token price as 18-decimal native units per token.
 *
 * Pools uses native currency as currency0 and the launched token as currency1,
 * so the canonical sqrt price is token/native and must be inverted for the
 * market-cap price shown by SUMO.
 *
 * @param state - Current canonical single-range state
 * @returns Native units per token scaled by 1e18
 */
export function calculatePoolsTradeSpotPriceWad(state: UniswapV3SingleRangeState): bigint {
  if (state.sqrtPriceX96 <= 0n) throw new Error('Pools spot price requires a positive sqrt price');
  return (UNISWAP_V3_Q96 * UNISWAP_V3_Q96 * 10n ** 18n) / (state.sqrtPriceX96 * state.sqrtPriceX96);
}

/**
 * Validates the selected InstantLaunchStrategy immutables and builds its
 * opening one-sided range state.
 *
 * @param terms - Live immutable values read from the selected strategy
 * @returns Canonical opening range state
 * @throws {Error} If any immutable does not match the strategy formula
 */
export function buildPoolsTradeInitialState(
  terms: PoolsTradeInstantTerms,
): UniswapV3SingleRangeState {
  if (
    !Number.isInteger(terms.initialTick) ||
    terms.initialTick % POOLS_TRADE_TICK_SPACING !== 0 ||
    terms.initialTick <= POOLS_TRADE_MIN_LAUNCH_TICK
  ) {
    throw new Error('Pools Instant Launch initial tick is invalid');
  }
  const sqrtPriceLowerX96 = getUniswapV3SqrtRatioAtTick(POOLS_TRADE_MIN_LAUNCH_TICK);
  const sqrtPriceUpperX96 = getUniswapV3SqrtRatioAtTick(terms.initialTick);
  if (terms.initialSqrtPriceX96 !== sqrtPriceUpperX96) {
    throw new Error('Pools Instant Launch sqrt price does not match its initial tick');
  }
  const expectedLiquidity =
    (POOLS_TRADE_TOTAL_SUPPLY_WEI * UNISWAP_V3_Q96) / (sqrtPriceUpperX96 - sqrtPriceLowerX96);
  if (terms.positionLiquidity !== expectedLiquidity) {
    throw new Error('Pools Instant Launch position liquidity does not match the fixed supply');
  }
  return {
    liquidity: terms.positionLiquidity,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    sqrtPriceX96: terms.initialSqrtPriceX96,
  };
}

/**
 * Derives exact native inputs for ordered percentage-derived Pools buys.
 *
 * The inverse quote finds the required gross input; the forward exact-input
 * quote then determines the state and output that the Universal Router will
 * actually produce with that integer input.
 *
 * @param input - Strategy terms, ordered allocations, and slippage
 * @returns Frozen exact-input launch plan
 * @throws {Error} If allocations, slippage, or available range are invalid
 */
export function planPoolsTradeLaunchBuys(input: {
  allocations: readonly PoolsTradeLaunchAllocation[];
  slippageBps: number;
  terms: PoolsTradeInstantTerms;
}): PoolsTradeLaunchPlan {
  if (input.allocations.length < 1 || input.allocations.length > POOLS_TRADE_MAX_BUYERS + 1) {
    throw new Error(`Pools launch requires 1-${POOLS_TRADE_MAX_BUYERS} bundle buyers`);
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('Pools launch slippage must be between 0 and 5000 bps');
  }
  const devCount = input.allocations.filter((allocation) => allocation.role === 'dev').length;
  const bundleCount = input.allocations.length - devCount;
  if (
    devCount > 1 ||
    (devCount === 1 && input.allocations[0]?.role !== 'dev') ||
    bundleCount < 1 ||
    bundleCount > POOLS_TRADE_MAX_BUYERS
  ) {
    throw new Error(
      `Pools launch requires an optional first dev buy and 1-${POOLS_TRADE_MAX_BUYERS} bundle buys`,
    );
  }
  if (
    new Set(input.allocations.map((allocation) => allocation.walletId)).size !==
    input.allocations.length
  ) {
    throw new Error('Pools launch buyer wallet ids must be unique');
  }

  let state = buildPoolsTradeInitialState(input.terms);
  let totalQuoteInWei = 0n;
  let totalTokensOutWei = 0n;
  const buys: PoolsTradePlannedBuy[] = [];

  for (const allocation of input.allocations) {
    if (
      allocation.targetTokensOutWei <= 0n ||
      allocation.targetTokensOutWei >= POOLS_TRADE_TOTAL_SUPPLY_WEI
    ) {
      throw new Error(`Pools launch token target is invalid for wallet ${allocation.walletId}`);
    }
    const inverse = quoteConcentratedLiquiditySingleRangeExactOutput(
      state,
      allocation.targetTokensOutWei,
      POOLS_TRADE_LP_FEE_PIPS,
      true,
    );
    if (inverse.insufficientLiquidity || inverse.amountIn <= 0n) {
      throw new Error(`Pools launch has insufficient liquidity for wallet ${allocation.walletId}`);
    }
    const forward = quoteConcentratedLiquiditySingleRangeExactInput(
      state,
      inverse.amountIn,
      POOLS_TRADE_LP_FEE_PIPS,
      true,
    );
    if (
      forward.insufficientLiquidity ||
      forward.amountIn !== inverse.amountIn ||
      forward.amountOut < allocation.targetTokensOutWei
    ) {
      throw new Error(
        `Pools launch exact-input quote cannot satisfy wallet ${allocation.walletId}`,
      );
    }
    const minTokensOutWei =
      (allocation.targetTokensOutWei * BigInt(10_000 - input.slippageBps)) / 10_000n;
    if (minTokensOutWei <= 0n) {
      throw new Error(`Pools launch minimum output is zero for wallet ${allocation.walletId}`);
    }
    buys.push({
      ...allocation,
      expectedTokensOutWei: forward.amountOut,
      minTokensOutWei,
      quoteInWei: inverse.amountIn,
    });
    state = forward.nextState;
    totalQuoteInWei += inverse.amountIn;
    totalTokensOutWei += forward.amountOut;
  }
  return { buys, finalState: state, totalQuoteInWei, totalTokensOutWei };
}
