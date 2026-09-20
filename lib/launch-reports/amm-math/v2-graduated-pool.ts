/**
 * Generic post-graduation pool math for launchpads that migrate into a
 * Uniswap-V2-style pair (PancakeSwap V2 on BSC for Flap and Four.meme).
 *
 * When a curve completes, the launchpad seeds a constant-product pair with
 * the unsold supply and (most of) the curve reserve. A Graduation Bundle keeps
 * buying from that pair in the same block. This module sizes those buys in
 * the pair's quote asset with the constant-product formula, the pair fee, and
 * the launched token's buy tax, which taxed tokens (Flap Tax V3, Four.meme
 * Token8) charge on transfers out of the pair so the buyer nets less than the
 * pair releases.
 *
 * All amounts are raw atomic bigints. API planners refine these numbers
 * against a full-bundle `eth_simulateV1` run; browsers use them directly for
 * the Buy Setup estimate.
 */

import { uniswapV2GetAmountIn, uniswapV2GetAmountOut } from './uniswap-v2.ts';

const BPS = 10_000n;

/** PancakeSwap V2 pair fee, in bps, applied to every pool buy on BSC. */
export const PANCAKESWAP_V2_GRADUATED_POOL_FEE_BPS = 25;

/** Constant-product pair a migration created, plus the tax on outgoing transfers. */
export interface V2GraduatedPoolState {
  /** Token buy tax charged on tokens leaving the pair, in bps; zero when untaxed. */
  buyTaxBps: bigint;
  /** Pair fee in bps (25 on PancakeSwap V2). */
  feeBps: number;
  /** Quote asset held by the pair (native or the ERC-20 quote). */
  reserveQuote: bigint;
  /** Launched tokens held by the pair. */
  reserveToken: bigint;
}

export interface V2GraduatedPoolBuyQuote {
  /** Tokens that reach the buyer after the transfer tax. */
  deliveredTokens: bigint;
  /** Tokens the pair releases before tax. */
  poolTokensOut: bigint;
  postState: V2GraduatedPoolState;
  quoteIn: bigint;
}

export interface V2GraduatedPoolAllocation {
  recipient: `0x${string}`;
  targetTokenAmount: bigint;
}

export interface V2GraduatedPoolBuyStep extends V2GraduatedPoolBuyQuote {
  /** Delivered-token floor the buy enforces on chain. */
  minDelivered: bigint;
  recipient: `0x${string}`;
  targetTokenAmount: bigint;
}

export interface V2GraduatedPoolPlan {
  finalState: V2GraduatedPoolState;
  steps: V2GraduatedPoolBuyStep[];
  totalQuoteIn: bigint;
}

/**
 * Tokens the buyer keeps from a pre-tax pair output.
 *
 * @param poolTokensOut - Tokens the pair releases.
 * @param buyTaxBps - Transfer tax on pair outflows, in bps.
 * @returns The after-tax delivery, rounded down like the token contract.
 */
export function applyV2PoolBuyTax(poolTokensOut: bigint, buyTaxBps: bigint): bigint {
  if (buyTaxBps <= 0n) return poolTokensOut;
  return (poolTokensOut * (BPS - buyTaxBps)) / BPS;
}

/**
 * Smallest pre-tax pair output whose after-tax delivery reaches a target.
 *
 * @param deliveredTokens - Tokens the buyer must receive after tax.
 * @param buyTaxBps - Transfer tax on pair outflows, in bps.
 * @returns The gross pair output; zero for a non-positive target.
 */
export function grossV2PoolOutputForDelivery(deliveredTokens: bigint, buyTaxBps: bigint): bigint {
  if (deliveredTokens <= 0n) return 0n;
  if (buyTaxBps <= 0n) return deliveredTokens;
  const denominator = BPS - buyTaxBps;
  let gross = (deliveredTokens * BPS + denominator - 1n) / denominator;
  while (applyV2PoolBuyTax(gross, buyTaxBps) < deliveredTokens) gross += 1n;
  return gross;
}

/**
 * Quotes an exact-input pool buy: pair output for the quote in, then the
 * transfer tax on the way to the buyer.
 *
 * @param state - Pair state before the buy.
 * @param quoteIn - Quote asset spent, raw units.
 * @returns Pair output, delivered tokens and the pair state after the buy.
 */
export function quoteV2GraduatedPoolBuyExactIn(
  state: V2GraduatedPoolState,
  quoteIn: bigint,
): V2GraduatedPoolBuyQuote {
  const poolTokensOut = uniswapV2GetAmountOut({
    amountIn: quoteIn,
    feeBps: state.feeBps,
    reserveIn: state.reserveQuote,
    reserveOut: state.reserveToken,
  });
  return {
    deliveredTokens: applyV2PoolBuyTax(poolTokensOut, state.buyTaxBps),
    poolTokensOut,
    postState: {
      ...state,
      reserveQuote: state.reserveQuote + quoteIn,
      reserveToken: state.reserveToken - poolTokensOut,
    },
    quoteIn,
  };
}

/**
 * Solves the quote input that delivers a token target from the pair.
 *
 * @param state - Pair state before the buy.
 * @param targetTokenAmount - Tokens the buyer must receive after tax.
 * @returns The solved buy, or null when the pair cannot deliver the target.
 */
export function invertV2GraduatedPoolBuy(
  state: V2GraduatedPoolState,
  targetTokenAmount: bigint,
): V2GraduatedPoolBuyQuote | null {
  if (targetTokenAmount <= 0n) return null;
  const poolTokensOut = grossV2PoolOutputForDelivery(targetTokenAmount, state.buyTaxBps);
  if (poolTokensOut >= state.reserveToken) return null;
  const quoteIn = uniswapV2GetAmountIn({
    amountOut: poolTokensOut,
    feeBps: state.feeBps,
    reserveIn: state.reserveQuote,
    reserveOut: state.reserveToken,
  });
  if (quoteIn <= 0n) return null;
  const quoted = quoteV2GraduatedPoolBuyExactIn(state, quoteIn);
  return quoted.deliveredTokens >= targetTokenAmount ? quoted : null;
}

/**
 * Plans ordered post-graduation buys against one modelled pair.
 *
 * @param input.allocations - Ordered recipients and after-tax token targets.
 * @param input.initialState - Pair state right after migration.
 * @param input.minOutputToleranceBps - Slack below the target the on-chain
 *   minimum output allows.
 * @param input.label - Launchpad name used in error messages; defaults to `V2`.
 * @returns Per-wallet quote inputs, delivered tokens, floors, and the final pair state.
 * @throws When a target is not positive, a recipient repeats, or the pair cannot deliver a target.
 *
 * @example
 * const plan = planV2GraduatedPoolBuys({
 *   allocations: [{ recipient, targetTokenAmount: 10_000_000n * 10n ** 18n }],
 *   initialState: { buyTaxBps: 300n, feeBps: 25, reserveQuote, reserveToken },
 *   minOutputToleranceBps: 50n,
 * });
 */
export function planV2GraduatedPoolBuys(input: {
  allocations: readonly V2GraduatedPoolAllocation[];
  initialState: V2GraduatedPoolState;
  label?: string;
  minOutputToleranceBps: bigint;
}): V2GraduatedPoolPlan {
  const label = input.label ?? 'V2';
  if (input.minOutputToleranceBps < 0n || input.minOutputToleranceBps >= BPS) {
    throw new Error(`${label} pool minimum-output tolerance must be between 0 and 9999 bps.`);
  }
  const recipients = new Set<string>();
  let state = input.initialState;
  let totalQuoteIn = 0n;
  const steps: V2GraduatedPoolBuyStep[] = [];
  input.allocations.forEach((allocation, index) => {
    if (allocation.targetTokenAmount <= 0n) {
      throw new Error(`${label} pool allocation ${index} must target a positive token amount.`);
    }
    const recipient = allocation.recipient.toLowerCase();
    if (recipients.has(recipient)) {
      throw new Error(`Duplicate ${label} pool recipient: ${allocation.recipient}.`);
    }
    recipients.add(recipient);
    const solved = invertV2GraduatedPoolBuy(state, allocation.targetTokenAmount);
    if (!solved) {
      throw new Error(`${label} graduated pool cannot deliver allocation ${index}.`);
    }
    state = solved.postState;
    totalQuoteIn += solved.quoteIn;
    steps.push({
      ...solved,
      minDelivered: (allocation.targetTokenAmount * (BPS - input.minOutputToleranceBps)) / BPS,
      recipient: allocation.recipient,
      targetTokenAmount: allocation.targetTokenAmount,
    });
  });
  return { finalState: state, steps, totalQuoteIn };
}
