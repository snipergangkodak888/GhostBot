/**
 * Uniswap V2 constant-product helpers shared by browser and backend planners.
 *
 * Mirrors `UniswapV2Library` rounding; the fee is configurable so PancakeSwap
 * V2 pairs (25 bps) and other forks reuse the same code.
 */

export const UNISWAP_V2_FEE_NUMERATOR = 997n;
export const UNISWAP_V2_FEE_DENOMINATOR = 1000n;
const BPS_DENOMINATOR = 10_000n;

/**
 * Returns Uniswap V2's exact required input for a desired output amount.
 *
 * Mirrors `UniswapV2Library.getAmountIn` for valid inputs:
 * `((reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997)) + 1`.
 *
 * @param input - Desired output and pair reserves, all raw atomic amounts.
 * @param input.feeBps - Optional pool fee in basis points. Defaults to Uniswap V2's 30 bps.
 * @returns Required raw input amount, or `0n` when the quote is impossible.
 */
export function uniswapV2GetAmountIn(input: {
  amountOut: bigint;
  feeBps?: number;
  reserveIn: bigint;
  reserveOut: bigint;
}): bigint {
  if (
    input.amountOut <= 0n ||
    input.reserveIn <= 0n ||
    input.reserveOut <= 0n ||
    input.amountOut >= input.reserveOut
  ) {
    return 0n;
  }
  const feeBps = input.feeBps ?? 30;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new Error(`Invalid Uniswap V2 feeBps: ${feeBps}`);
  }
  const feeNumerator = BPS_DENOMINATOR - BigInt(feeBps);
  const numerator = input.reserveIn * input.amountOut * BPS_DENOMINATOR;
  const denominator = (input.reserveOut - input.amountOut) * feeNumerator;
  return numerator / denominator + 1n;
}

/**
 * Returns Uniswap V2's exact output for an input amount.
 *
 * Mirrors `UniswapV2Library.getAmountOut` for valid inputs.
 *
 * @param input - Input amount and pair reserves, all raw atomic amounts.
 * @param input.feeBps - Optional pool fee in basis points. Defaults to Uniswap V2's 30 bps.
 * @returns Raw output amount, or `0n` when the quote is impossible.
 */
export function uniswapV2GetAmountOut(input: {
  amountIn: bigint;
  feeBps?: number;
  reserveIn: bigint;
  reserveOut: bigint;
}): bigint {
  if (input.amountIn <= 0n || input.reserveIn <= 0n || input.reserveOut <= 0n) {
    return 0n;
  }
  const feeBps = input.feeBps ?? 30;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new Error(`Invalid Uniswap V2 feeBps: ${feeBps}`);
  }
  const amountInWithFee = input.amountIn * (BPS_DENOMINATOR - BigInt(feeBps));
  const numerator = amountInWithFee * input.reserveOut;
  const denominator = input.reserveIn * BPS_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}
