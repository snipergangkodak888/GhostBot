/**
 * Flap post-graduation pool math.
 *
 * When a Flap curve crosses its DEX threshold the Portal migrates the unsold
 * supply and the curve reserve into a PancakeSwap V2 pair. A Graduation Bundle
 * keeps buying from that pair through the Portal, which routes the swap and
 * pays the caller. The pair math itself is the generic V2 graduated-pool
 * module (`v2-graduated-pool.ts`); this file keeps Flap's names and adds the
 * migration model that seeds the pair from the curve's terminal state.
 *
 * All amounts are raw atomic bigints. The API planner refines these numbers
 * against a full-bundle `eth_simulateV1` run; the browser uses them directly
 * for the Buy Setup estimate.
 */

import {
  applyV2PoolBuyTax,
  grossV2PoolOutputForDelivery,
  invertV2GraduatedPoolBuy,
  PANCAKESWAP_V2_GRADUATED_POOL_FEE_BPS,
  planV2GraduatedPoolBuys,
  quoteV2GraduatedPoolBuyExactIn,
  type V2GraduatedPoolAllocation,
  type V2GraduatedPoolBuyQuote,
  type V2GraduatedPoolBuyStep,
  type V2GraduatedPoolPlan,
  type V2GraduatedPoolState,
} from './v2-graduated-pool.ts';

const BPS = 10_000n;

/** PancakeSwap V2 pair fee applied to every pool buy. */
export const FLAP_GRADUATED_POOL_FEE_BPS = PANCAKESWAP_V2_GRADUATED_POOL_FEE_BPS;

/** Constant-product pair the migration created, plus the tax on outgoing transfers. */
export type FlapGraduatedPoolState = V2GraduatedPoolState;
export type FlapGraduatedPoolBuyQuote = V2GraduatedPoolBuyQuote;
export type FlapGraduatedPoolAllocation = V2GraduatedPoolAllocation;
export type FlapGraduatedPoolBuyStep = V2GraduatedPoolBuyStep;
export type FlapGraduatedPoolPlan = V2GraduatedPoolPlan;

/**
 * Models the pair the Portal creates at graduation from the curve's terminal
 * state: every unsold token plus the whole curve reserve.
 *
 * @param input.buyTaxBps - Tax V3 buy tax in bps.
 * @param input.curveReserveAtThreshold - Quote held by the curve when it hits the threshold.
 * @param input.dexSupplyThreshold - Circulating supply at which the curve migrates.
 * @param input.totalSupply - Token total supply.
 * @param input.quoteRetentionBps - Share of the reserve the Portal keeps at
 *   migration instead of seeding the pair, in bps. Defaults to zero; the
 *   planner reads the real reserves from simulation.
 * @returns The modelled pair state.
 */
export function modelFlapGraduatedPool(input: {
  buyTaxBps: bigint;
  curveReserveAtThreshold: bigint;
  dexSupplyThreshold: bigint;
  quoteRetentionBps?: bigint;
  totalSupply: bigint;
}): FlapGraduatedPoolState {
  const retention = input.quoteRetentionBps ?? 0n;
  if (retention < 0n || retention >= BPS) {
    throw new Error('Flap migration quote retention must be between 0 and 9999 bps.');
  }
  const reserveToken =
    input.totalSupply > input.dexSupplyThreshold
      ? input.totalSupply - input.dexSupplyThreshold
      : 0n;
  return {
    buyTaxBps: input.buyTaxBps,
    feeBps: FLAP_GRADUATED_POOL_FEE_BPS,
    reserveQuote: (input.curveReserveAtThreshold * (BPS - retention)) / BPS,
    reserveToken,
  };
}

/** Tokens the buyer keeps from a pre-tax pair output. */
export function applyFlapBuyTax(poolTokensOut: bigint, buyTaxBps: bigint): bigint {
  return applyV2PoolBuyTax(poolTokensOut, buyTaxBps);
}

/** Smallest pre-tax pair output whose after-tax delivery reaches a target. */
export function grossFlapPoolOutputForDelivery(deliveredTokens: bigint, buyTaxBps: bigint): bigint {
  return grossV2PoolOutputForDelivery(deliveredTokens, buyTaxBps);
}

/**
 * Quotes an exact-input pool buy: pair output for the quote in, then the
 * transfer tax on the way to the buyer.
 *
 * @param state - Pair state before the buy.
 * @param quoteIn - Quote asset spent, raw units.
 */
export function quoteFlapGraduatedPoolBuyExactIn(
  state: FlapGraduatedPoolState,
  quoteIn: bigint,
): FlapGraduatedPoolBuyQuote {
  return quoteV2GraduatedPoolBuyExactIn(state, quoteIn);
}

/**
 * Solves the quote input that delivers a token target from the pair.
 *
 * @param state - Pair state before the buy.
 * @param targetTokenAmount - Tokens the buyer must receive after tax.
 * @returns The solved buy, or null when the pair cannot deliver the target.
 */
export function invertFlapGraduatedPoolBuy(
  state: FlapGraduatedPoolState,
  targetTokenAmount: bigint,
): FlapGraduatedPoolBuyQuote | null {
  return invertV2GraduatedPoolBuy(state, targetTokenAmount);
}

/**
 * Plans ordered post-graduation buys against one modelled pair.
 *
 * @param input.allocations - Ordered recipients and after-tax token targets.
 * @param input.initialState - Pair state right after migration.
 * @param input.minOutputToleranceBps - Slack below the target the on-chain
 *   minimum output allows.
 * @returns Per-wallet quote inputs, delivered tokens, floors, and the final pair state.
 * @throws When a target is not positive, a recipient repeats, or the pair cannot deliver a target.
 */
export function planFlapGraduatedPoolBuys(input: {
  allocations: readonly FlapGraduatedPoolAllocation[];
  initialState: FlapGraduatedPoolState;
  minOutputToleranceBps: bigint;
}): FlapGraduatedPoolPlan {
  return planV2GraduatedPoolBuys({ ...input, label: 'Flap' });
}
