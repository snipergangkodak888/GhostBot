/**
 * Deterministic percentage-first planning for native LetsCash launches.
 *
 * LetsCash seeds the entire token supply in a one-sided Uniswap V4 range from
 * the minimum usable tick to the configured starting tick. Its hook takes a
 * flat fee from the gross native exact-input amount before the remainder is
 * swapped. The shared concentrated-liquidity primitives own the curve math;
 * this module only adds LetsCash config and hook accounting.
 */

import {
  getUniswapV3SqrtRatioAtTick,
  quoteConcentratedLiquiditySingleRangeExactInput,
  quoteConcentratedLiquiditySingleRangeExactOutput,
  UNISWAP_V3_Q96,
  type UniswapV3SingleRangeState,
} from './uniswap-v3.ts';

export const LETSCASH_FEE_DENOMINATOR = 1_000_000n;
export const LETSCASH_MAX_BUYERS = 100;
export const LETSCASH_MAX_SUPPLY_CONTROL_PCT = 99;
export const LETSCASH_MIN_TICK = -887_272;

/** Reviewed, enabled native-quote factory configs exposed by SUMO. */
export const LETSCASH_NATIVE_CONFIGS = [
  {
    configId: 1000,
    creatorFeeBps: 7000,
    feeRatePips: 10_000,
    selfBurn: false,
    startTick: 204_200,
    supplyWei: 1_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1001,
    creatorFeeBps: 7000,
    feeRatePips: 10_000,
    selfBurn: true,
    startTick: 204_200,
    supplyWei: 1_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1002,
    creatorFeeBps: 9000,
    feeRatePips: 30_000,
    selfBurn: false,
    startTick: 204_200,
    supplyWei: 1_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1004,
    creatorFeeBps: 9400,
    feeRatePips: 50_000,
    selfBurn: false,
    startTick: 204_200,
    supplyWei: 1_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1006,
    creatorFeeBps: 9700,
    feeRatePips: 100_000,
    selfBurn: false,
    startTick: 204_200,
    supplyWei: 1_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1016,
    creatorFeeBps: 7000,
    feeRatePips: 10_000,
    selfBurn: false,
    startTick: 227_200,
    supplyWei: 10_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1017,
    creatorFeeBps: 7000,
    feeRatePips: 10_000,
    selfBurn: true,
    startTick: 227_200,
    supplyWei: 10_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1018,
    creatorFeeBps: 9000,
    feeRatePips: 30_000,
    selfBurn: false,
    startTick: 227_200,
    supplyWei: 10_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1020,
    creatorFeeBps: 9400,
    feeRatePips: 50_000,
    selfBurn: false,
    startTick: 227_200,
    supplyWei: 10_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
  {
    configId: 1022,
    creatorFeeBps: 9700,
    feeRatePips: 100_000,
    selfBurn: false,
    startTick: 227_200,
    supplyWei: 10_000_000_000n * 10n ** 18n,
    tickSpacing: 200,
  },
] as const;

/** O(1) lookup for validating one selected native launch configuration. */
export const LETSCASH_NATIVE_CONFIG_BY_ID = new Map<
  number,
  (typeof LETSCASH_NATIVE_CONFIGS)[number]
>(LETSCASH_NATIVE_CONFIGS.map((config) => [config.configId, config]));

/** Native launch config terms read from the current factory implementation. */
export interface LetsCashCurveTerms {
  feeRatePips: number;
  startTick: number;
  supplyWei: bigint;
  tickSpacing: number;
}

/** One percentage-derived target in execution order. */
export interface LetsCashLaunchAllocation {
  role: 'bundle' | 'dev';
  targetTokensOutWei: bigint;
  walletId: string;
}

/** One exact-input buy derived from a target token allocation. */
export interface LetsCashPlannedBuy extends LetsCashLaunchAllocation {
  expectedTokensOutWei: bigint;
  minTokensOutWei: bigint;
  poolQuoteInWei: bigint;
  quoteInWei: bigint;
}

/** Complete ordered opening-buy plan, including the factory's optional dev buy. */
export interface LetsCashLaunchPlan {
  buys: LetsCashPlannedBuy[];
  finalState: UniswapV3SingleRangeState;
  totalQuoteInWei: bigint;
  totalTokensOutWei: bigint;
}

/**
 * Returns the minimum tick usable by a V4 pool at the configured spacing.
 *
 * @param tickSpacing - Positive V4 tick spacing.
 * @returns Minimum usable tick, matching Solidity's truncation toward zero.
 */
export function resolveLetsCashMinUsableTick(tickSpacing: number): number {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new Error('LetsCash tick spacing must be a positive integer');
  }
  return Math.ceil(LETSCASH_MIN_TICK / tickSpacing) * tickSpacing;
}

/**
 * Builds the exact one-sided opening state created by the LetsCash factory.
 *
 * @param terms - Live native launch config.
 * @returns Canonical single-range state before the first buy.
 */
export function buildLetsCashInitialState(terms: LetsCashCurveTerms): UniswapV3SingleRangeState {
  if (
    !Number.isInteger(terms.startTick) ||
    terms.startTick % terms.tickSpacing !== 0 ||
    terms.startTick <= resolveLetsCashMinUsableTick(terms.tickSpacing)
  ) {
    throw new Error('LetsCash start tick is invalid');
  }
  if (terms.supplyWei <= 0n) throw new Error('LetsCash supply must be positive');
  if (
    !Number.isInteger(terms.feeRatePips) ||
    terms.feeRatePips <= 0 ||
    BigInt(terms.feeRatePips) >= LETSCASH_FEE_DENOMINATOR
  ) {
    throw new Error('LetsCash hook fee is invalid');
  }
  const sqrtPriceLowerX96 = getUniswapV3SqrtRatioAtTick(
    resolveLetsCashMinUsableTick(terms.tickSpacing),
  );
  const sqrtPriceUpperX96 = getUniswapV3SqrtRatioAtTick(terms.startTick);
  const liquidity = (terms.supplyWei * UNISWAP_V3_Q96) / (sqrtPriceUpperX96 - sqrtPriceLowerX96);
  if (liquidity <= 0n || liquidity > (1n << 128n) - 1n) {
    throw new Error('LetsCash opening liquidity does not fit uint128');
  }
  return {
    liquidity,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    sqrtPriceX96: sqrtPriceUpperX96,
  };
}

/**
 * Calculates the hook fee for a native exact-input buy.
 *
 * @param grossQuoteInWei - Trader's total native spend.
 * @param feeRatePips - Hook fee in parts per million.
 * @returns Fee retained by the hook.
 */
export function calculateLetsCashExactInputFee(
  grossQuoteInWei: bigint,
  feeRatePips: number,
): bigint {
  return (grossQuoteInWei * BigInt(feeRatePips)) / LETSCASH_FEE_DENOMINATOR;
}

/**
 * Finds the smallest gross input whose post-hook amount covers a pool input.
 *
 * @param poolQuoteInWei - Exact native amount required by the V4 curve.
 * @param feeRatePips - Hook fee in parts per million.
 * @returns Minimum gross trader spend.
 */
export function grossUpLetsCashExactInput(poolQuoteInWei: bigint, feeRatePips: number): bigint {
  if (poolQuoteInWei <= 0n) throw new Error('LetsCash pool quote input must be positive');
  const rate = BigInt(feeRatePips);
  if (rate <= 0n || rate >= LETSCASH_FEE_DENOMINATOR) {
    throw new Error('LetsCash hook fee is invalid');
  }
  const divisor = LETSCASH_FEE_DENOMINATOR - rate;
  let gross = (poolQuoteInWei * LETSCASH_FEE_DENOMINATOR + divisor - 1n) / divisor;
  while (
    gross > 1n &&
    gross - 1n - calculateLetsCashExactInputFee(gross - 1n, feeRatePips) >= poolQuoteInWei
  ) {
    gross -= 1n;
  }
  while (gross - calculateLetsCashExactInputFee(gross, feeRatePips) < poolQuoteInWei) {
    gross += 1n;
  }
  return gross;
}

/**
 * Returns current native units per token, scaled by 1e18.
 *
 * @param state - Canonical V4 range state.
 * @returns Native/token spot price wad.
 */
export function calculateLetsCashSpotPriceWad(state: UniswapV3SingleRangeState): bigint {
  if (state.sqrtPriceX96 <= 0n)
    throw new Error('LetsCash spot price requires a positive sqrt price');
  return (UNISWAP_V3_Q96 * UNISWAP_V3_Q96 * 10n ** 18n) / (state.sqrtPriceX96 * state.sqrtPriceX96);
}

/**
 * Derives exact gross native inputs for ordered LetsCash allocations.
 *
 * @param input - Live config, ordered allocations, and user slippage.
 * @returns Frozen exact-input launch plan.
 */
export function planLetsCashLaunchBuys(input: {
  allocations: readonly LetsCashLaunchAllocation[];
  slippageBps: number;
  terms: LetsCashCurveTerms;
}): LetsCashLaunchPlan {
  const devCount = input.allocations.filter((allocation) => allocation.role === 'dev').length;
  const bundleCount = input.allocations.length - devCount;
  if (
    devCount > 1 ||
    (devCount === 1 && input.allocations[0]?.role !== 'dev') ||
    bundleCount < 1 ||
    bundleCount > LETSCASH_MAX_BUYERS
  ) {
    throw new Error(
      `LetsCash launch requires an optional first dev buy and 1-${LETSCASH_MAX_BUYERS} bundle buys`,
    );
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('LetsCash launch slippage must be between 0 and 5000 bps');
  }
  if (
    new Set(input.allocations.map((allocation) => allocation.walletId)).size !==
    input.allocations.length
  ) {
    throw new Error('LetsCash launch buyer wallet ids must be unique');
  }

  let state = buildLetsCashInitialState(input.terms);
  let totalQuoteInWei = 0n;
  let totalTokensOutWei = 0n;
  const buys: LetsCashPlannedBuy[] = [];
  for (const allocation of input.allocations) {
    if (
      allocation.targetTokensOutWei <= 0n ||
      allocation.targetTokensOutWei >= input.terms.supplyWei
    ) {
      throw new Error(`LetsCash token target is invalid for wallet ${allocation.walletId}`);
    }
    const inverse = quoteConcentratedLiquiditySingleRangeExactOutput(
      state,
      allocation.targetTokensOutWei,
      0,
      true,
    );
    if (inverse.insufficientLiquidity || inverse.amountIn <= 0n) {
      throw new Error(`LetsCash has insufficient liquidity for wallet ${allocation.walletId}`);
    }
    const grossQuoteInWei = grossUpLetsCashExactInput(inverse.amountIn, input.terms.feeRatePips);
    const poolQuoteInWei =
      grossQuoteInWei - calculateLetsCashExactInputFee(grossQuoteInWei, input.terms.feeRatePips);
    const forward = quoteConcentratedLiquiditySingleRangeExactInput(state, poolQuoteInWei, 0, true);
    if (forward.insufficientLiquidity || forward.amountOut < allocation.targetTokensOutWei) {
      throw new Error(`LetsCash exact-input quote cannot satisfy wallet ${allocation.walletId}`);
    }
    const minTokensOutWei =
      (allocation.targetTokensOutWei * BigInt(10_000 - input.slippageBps)) / 10_000n;
    if (minTokensOutWei <= 0n) {
      throw new Error(`LetsCash minimum output is zero for wallet ${allocation.walletId}`);
    }
    buys.push({
      ...allocation,
      expectedTokensOutWei: forward.amountOut,
      minTokensOutWei,
      poolQuoteInWei,
      quoteInWei: grossQuoteInWei,
    });
    state = forward.nextState;
    totalQuoteInWei += grossQuoteInWei;
    totalTokensOutWei += forward.amountOut;
  }
  return { buys, finalState: state, totalQuoteInWei, totalTokensOutWei };
}
