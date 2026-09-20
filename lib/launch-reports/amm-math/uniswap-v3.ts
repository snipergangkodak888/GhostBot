/**
 * Deterministic Uniswap V3 math used by launch planning in the API and browser.
 *
 * The implementation mirrors the integer rounding of the canonical Uniswap V3
 * TickMath, LiquidityAmounts, SqrtPriceMath, and SwapMath libraries. All token
 * amounts are atomic bigint values; JavaScript floating point is never used.
 */

export const UNISWAP_V3_Q96 = 1n << 96n;
export const UNISWAP_V3_MIN_TICK = -887_272;
export const UNISWAP_V3_MAX_TICK = 887_272;
export const UNISWAP_V3_MIN_SQRT_RATIO = 4_295_128_739n;
export const UNISWAP_V3_MAX_SQRT_RATIO =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const FEE_DENOMINATOR = 1_000_000n;
const MAX_UINT_256 = (1n << 256n) - 1n;
const TICK_RATIO_FACTORS = [
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x09aa508b5b7a84e1c677de54f3e99bc9n,
  0x005d6af8dedb81196699c329225ee604n,
  0x0002216e584f5fa1ea926041bedfe98n,
  0x000048a170391f7dc42444e8fa2n,
] as const;

export const UNISWAP_V3_FEE_TIERS = [100, 500, 3_000, 10_000] as const;
export type UniswapV3FeeTier = (typeof UNISWAP_V3_FEE_TIERS)[number];

export interface UniswapV3FullRangePosition {
  actualAmount0: bigint;
  actualAmount1: bigint;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
}

export interface UniswapV3SingleRangeState {
  liquidity: bigint;
  sqrtPriceX96: bigint;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
}

export interface UniswapV3SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  insufficientLiquidity: boolean;
  nextState: UniswapV3SingleRangeState;
}

/**
 * Quotes an exact-input swap inside one canonical concentrated-liquidity range.
 *
 * Unlike the V3 wrapper, this primitive accepts any static fee in pips and
 * permits a swap to enter a one-sided range from its active boundary. This is
 * the arithmetic shared by hookless Uniswap V3 and V4 pools.
 *
 * @param state - Current square-root price, liquidity, and range boundaries
 * @param amountIn - Gross input including the pool fee
 * @param feePips - Pool fee in millionths
 * @param zeroForOne - Whether currency0 is supplied for currency1
 * @returns Protocol-rounded swap result and next range state
 * @throws {Error} When the state, amount, fee, or direction is invalid
 */
export function quoteConcentratedLiquiditySingleRangeExactInput(
  state: UniswapV3SingleRangeState,
  amountIn: bigint,
  feePips: number,
  zeroForOne: boolean,
): UniswapV3SwapQuote {
  validateConcentratedLiquiditySwapState(state, amountIn, feePips, zeroForOne);
  const target = zeroForOne ? state.sqrtPriceLowerX96 : state.sqrtPriceUpperX96;
  const step = computeSwapStep({
    amountRemaining: amountIn,
    exactIn: true,
    feePips,
    liquidity: state.liquidity,
    sqrtPriceCurrentX96: state.sqrtPriceX96,
    sqrtPriceTargetX96: target,
  });
  const consumed = step.amountIn + step.feeAmount;
  return {
    amountIn: consumed,
    amountOut: step.amountOut,
    feeAmount: step.feeAmount,
    insufficientLiquidity: consumed < amountIn,
    nextState: { ...state, sqrtPriceX96: step.sqrtPriceNextX96 },
  };
}

/**
 * Quotes an exact-output swap inside one canonical concentrated-liquidity range.
 *
 * @param state - Current square-root price, liquidity, and range boundaries
 * @param amountOut - Requested output amount
 * @param feePips - Pool fee in millionths
 * @param zeroForOne - Whether currency0 is supplied for currency1
 * @returns Required input, delivered output, and next range state
 * @throws {Error} When the state, amount, fee, or direction is invalid
 */
export function quoteConcentratedLiquiditySingleRangeExactOutput(
  state: UniswapV3SingleRangeState,
  amountOut: bigint,
  feePips: number,
  zeroForOne: boolean,
): UniswapV3SwapQuote {
  validateConcentratedLiquiditySwapState(state, amountOut, feePips, zeroForOne);
  const target = zeroForOne ? state.sqrtPriceLowerX96 : state.sqrtPriceUpperX96;
  const step = computeSwapStep({
    amountRemaining: amountOut,
    exactIn: false,
    feePips,
    liquidity: state.liquidity,
    sqrtPriceCurrentX96: state.sqrtPriceX96,
    sqrtPriceTargetX96: target,
  });
  return {
    amountIn: step.amountIn + step.feeAmount,
    amountOut: step.amountOut,
    feeAmount: step.feeAmount,
    insufficientLiquidity: step.amountOut < amountOut,
    nextState: { ...state, sqrtPriceX96: step.sqrtPriceNextX96 },
  };
}

export interface UniswapV3LaunchAllocation {
  order: number;
  tokenAmount: bigint;
  walletId: string;
}

export interface UniswapV3LaunchBuyPlanItem extends UniswapV3LaunchAllocation {
  ethAmount: bigint;
  expectedTokenAmount: bigint;
}

export interface BuildUniswapV3LaunchBuyPlanInput {
  allocations: readonly UniswapV3LaunchAllocation[];
  feeTier: UniswapV3FeeTier;
  initialState: UniswapV3SingleRangeState;
  tokenIsToken0: boolean;
}

/**
 * Returns the integer square root rounded down.
 *
 * @param value - Non-negative integer.
 * @returns Largest integer whose square does not exceed `value`.
 * @throws {Error} When `value` is negative.
 */
export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('Square root input must be non-negative');
  if (value < 2n) return value;

  let current = 1n << BigInt((value.toString(2).length + 1) >> 1);
  while (true) {
    const next = (current + value / current) >> 1n;
    if (next >= current) return current;
    current = next;
  }
}

/**
 * Encodes a raw token1/token0 price as canonical Q64.96 square-root price.
 *
 * @param amount1 - Raw token1 amount representing the desired ratio.
 * @param amount0 - Raw token0 amount representing the desired ratio.
 * @returns `floor(sqrt(amount1 / amount0) * 2^96)`.
 * @throws {Error} When either amount is non-positive or the result is outside TickMath bounds.
 */
export function encodeSqrtRatioX96(amount1: bigint, amount0: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) {
    throw new Error('Uniswap V3 price amounts must be positive');
  }
  const result = integerSqrt((amount1 << 192n) / amount0);
  if (result < UNISWAP_V3_MIN_SQRT_RATIO || result >= UNISWAP_V3_MAX_SQRT_RATIO) {
    throw new Error('Uniswap V3 price is outside TickMath bounds');
  }
  return result;
}

/**
 * Resolves the canonical tick spacing for a supported Uniswap V3 fee tier.
 *
 * @param feeTier - Fee in hundredths of a basis point.
 * @returns Canonical tick spacing.
 * @throws {Error} When the fee tier is unsupported by the launch product.
 */
export function uniswapV3TickSpacing(feeTier: number): number {
  if (feeTier === 100) return 1;
  if (feeTier === 500) return 10;
  if (feeTier === 3_000) return 60;
  if (feeTier === 10_000) return 200;
  throw new Error(`Unsupported Uniswap V3 fee tier: ${feeTier}`);
}

/**
 * Resolves usable full-range ticks using Solidity's truncation-toward-zero behavior.
 *
 * @param feeTier - Supported Uniswap V3 fee tier.
 * @returns Lower and upper ticks divisible by the tier's spacing.
 */
export function resolveUniswapV3FullRangeTicks(feeTier: UniswapV3FeeTier): {
  tickLower: number;
  tickUpper: number;
} {
  const spacing = uniswapV3TickSpacing(feeTier);
  return {
    tickLower: Math.trunc(UNISWAP_V3_MIN_TICK / spacing) * spacing,
    tickUpper: Math.trunc(UNISWAP_V3_MAX_TICK / spacing) * spacing,
  };
}

/**
 * Mirrors canonical Uniswap V3 TickMath.getSqrtRatioAtTick.
 *
 * @param tick - Tick in the inclusive TickMath range.
 * @returns Q64.96 square-root ratio rounded up exactly as the Solidity library.
 * @throws {Error} When the tick is outside the supported range.
 */
export function getUniswapV3SqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) throw new Error('Uniswap V3 tick must be an integer');
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > UNISWAP_V3_MAX_TICK) throw new Error(`Tick ${tick} out of bounds`);

  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  for (const [index, factor] of TICK_RATIO_FACTORS.entries()) {
    if ((absTick & (1 << (index + 1))) !== 0) {
      ratio = (ratio * factor) >> 128n;
    }
  }
  if (tick > 0) ratio = MAX_UINT_256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/**
 * Calculates liquidity supported by desired token0/token1 amounts at a price.
 *
 * @param sqrtPriceX96 - Current Q64.96 square-root price.
 * @param sqrtPriceAX96 - First range boundary.
 * @param sqrtPriceBX96 - Second range boundary.
 * @param amount0 - Available token0 amount.
 * @param amount1 - Available token1 amount.
 * @returns Maximum liquidity that can be minted using both desired amounts.
 */
export function getUniswapV3LiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  if (sqrtPriceX96 <= sqrtLower) {
    return getLiquidityForAmount0(sqrtLower, sqrtUpper, amount0);
  }
  if (sqrtPriceX96 < sqrtUpper) {
    const liquidity0 = getLiquidityForAmount0(sqrtPriceX96, sqrtUpper, amount0);
    const liquidity1 = getLiquidityForAmount1(sqrtLower, sqrtPriceX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }
  return getLiquidityForAmount1(sqrtLower, sqrtUpper, amount1);
}

/**
 * Calculates the token amounts represented by liquidity at a current price.
 *
 * @param sqrtPriceX96 - Current Q64.96 square-root price.
 * @param sqrtPriceAX96 - First range boundary.
 * @param sqrtPriceBX96 - Second range boundary.
 * @param liquidity - Position liquidity.
 * @returns Token0 and token1 amounts rounded down like LiquidityAmounts.
 */
export function getUniswapV3AmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  if (sqrtPriceX96 <= sqrtLower) {
    return { amount0: getAmount0Delta(sqrtLower, sqrtUpper, liquidity, false), amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtUpper) {
    return {
      amount0: getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidity, false),
      amount1: getAmount1Delta(sqrtLower, sqrtPriceX96, liquidity, false),
    };
  }
  return { amount0: 0n, amount1: getAmount1Delta(sqrtLower, sqrtUpper, liquidity, false) };
}

/**
 * Builds the deterministic state of a newly minted full-range position.
 *
 * @param input - Fee tier and raw token0/token1 desired amounts.
 * @returns Initial price, full-range ticks, liquidity, and actual deposited amounts.
 */
export function buildUniswapV3FullRangePosition(input: {
  amount0Desired: bigint;
  amount1Desired: bigint;
  feeTier: UniswapV3FeeTier;
}): UniswapV3FullRangePosition {
  const sqrtPriceX96 = encodeSqrtRatioX96(input.amount1Desired, input.amount0Desired);
  const { tickLower, tickUpper } = resolveUniswapV3FullRangeTicks(input.feeTier);
  const sqrtPriceLowerX96 = getUniswapV3SqrtRatioAtTick(tickLower);
  const sqrtPriceUpperX96 = getUniswapV3SqrtRatioAtTick(tickUpper);
  const liquidity = getUniswapV3LiquidityForAmounts(
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    input.amount0Desired,
    input.amount1Desired,
  );
  if (liquidity <= 0n || liquidity > (1n << 128n) - 1n) {
    throw new Error('Uniswap V3 initial liquidity is outside uint128 bounds');
  }
  // NonfungiblePositionManager derives liquidity with LiquidityAmounts (rounding down),
  // while the pool's mint callback charges token deltas rounded up.
  const amounts = {
    amount0: getAmount0Delta(sqrtPriceX96, sqrtPriceUpperX96, liquidity, true),
    amount1: getAmount1Delta(sqrtPriceLowerX96, sqrtPriceX96, liquidity, true),
  };
  return {
    actualAmount0: amounts.amount0,
    actualAmount1: amounts.amount1,
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper,
  };
}

/**
 * Quotes an exact-input swap against one active constant-liquidity range.
 *
 * @param state - Current square-root price, active liquidity, and range boundaries.
 * @param amountIn - Total input including the pool fee.
 * @param feeTier - Pool fee in hundredths of a basis point.
 * @param zeroForOne - Whether token0 is supplied for token1.
 * @returns Protocol-rounded output, fee, next state, and boundary status.
 */
export function quoteUniswapV3ExactInput(
  state: UniswapV3SingleRangeState,
  amountIn: bigint,
  feeTier: UniswapV3FeeTier,
  zeroForOne: boolean,
): UniswapV3SwapQuote {
  uniswapV3TickSpacing(feeTier);
  return quoteConcentratedLiquiditySingleRangeExactInput(state, amountIn, feeTier, zeroForOne);
}

/**
 * Quotes the required input for an exact output against one active range.
 *
 * @param state - Current square-root price, active liquidity, and range boundaries.
 * @param amountOut - Requested output amount.
 * @param feeTier - Pool fee in hundredths of a basis point.
 * @param zeroForOne - Whether token0 is supplied for token1.
 * @returns Protocol-rounded input, delivered output, fee, next state, and boundary status.
 */
export function quoteUniswapV3ExactOutput(
  state: UniswapV3SingleRangeState,
  amountOut: bigint,
  feeTier: UniswapV3FeeTier,
  zeroForOne: boolean,
): UniswapV3SwapQuote {
  uniswapV3TickSpacing(feeTier);
  return quoteConcentratedLiquiditySingleRangeExactOutput(state, amountOut, feeTier, zeroForOne);
}

/**
 * Builds exact-input launch buys for a controlled pre-trading sequence.
 *
 * Each target allocation is first converted to the exact native input required
 * in deterministic order. The transaction layer intentionally uses a zero
 * output minimum, matching Base/Robinhood V2; post-buy balance deltas reconcile
 * whether each exempt launch wallet actually received tokens.
 *
 * @param input - Initial full-range state, allocations, fee, and token orientation.
 * @returns One plan item per allocation in ascending order.
 * @throws {Error} When an allocation cannot be satisfied.
 */
export function buildUniswapV3LaunchBuyPlan(
  input: BuildUniswapV3LaunchBuyPlanInput,
): UniswapV3LaunchBuyPlanItem[] {
  const sorted = [...input.allocations].sort((a, b) => a.order - b.order);
  const orders = new Set<number>();
  const walletIds = new Set<string>();
  let state = input.initialState;
  const zeroForOne = !input.tokenIsToken0;
  const plan: UniswapV3LaunchBuyPlanItem[] = [];

  for (const allocation of sorted) {
    if (!Number.isSafeInteger(allocation.order) || allocation.order < 0) {
      throw new Error('Uniswap V3 launch allocation order must be a non-negative integer');
    }
    if (
      !allocation.walletId ||
      walletIds.has(allocation.walletId) ||
      orders.has(allocation.order)
    ) {
      throw new Error('Uniswap V3 launch allocations require unique wallets and orders');
    }
    if (allocation.tokenAmount <= 0n) throw new Error('Launch token allocation must be positive');
    walletIds.add(allocation.walletId);
    orders.add(allocation.order);

    const quote = quoteUniswapV3ExactOutput(
      state,
      allocation.tokenAmount,
      input.feeTier,
      zeroForOne,
    );
    if (quote.insufficientLiquidity || quote.amountOut !== allocation.tokenAmount) {
      throw new Error(`Insufficient V3 liquidity for launch wallet ${allocation.walletId}`);
    }
    plan.push({
      ...allocation,
      ethAmount: quote.amountIn,
      expectedTokenAmount: allocation.tokenAmount,
    });
    state = quote.nextState;
  }
  return plan;
}

function getLiquidityForAmount0(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount0: bigint,
): bigint {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  const intermediate = mulDiv(sqrtLower, sqrtUpper, UNISWAP_V3_Q96);
  return mulDiv(amount0, intermediate, sqrtUpper - sqrtLower);
}

function getLiquidityForAmount1(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount1: bigint,
): bigint {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  return mulDiv(amount1, UNISWAP_V3_Q96, sqrtUpper - sqrtLower);
}

/**
 * Computes one canonical `SwapMath.computeSwapStep` toward a target price.
 *
 * Exposed for planners that must walk a pool the way V4 core does, one tick
 * word at a time, rather than in a single step to the range boundary.
 *
 * @param input - Current price, target price, active liquidity, remaining
 * amount, fee, and whether the remaining amount is input or output.
 * @returns Next price and the protocol-rounded amounts of this step.
 */
export function computeConcentratedLiquiditySwapStep(input: {
  amountRemaining: bigint;
  exactIn: boolean;
  feePips: number;
  liquidity: bigint;
  sqrtPriceCurrentX96: bigint;
  sqrtPriceTargetX96: bigint;
}): { amountIn: bigint; amountOut: bigint; feeAmount: bigint; sqrtPriceNextX96: bigint } {
  return computeSwapStep(input);
}

function computeSwapStep(input: {
  amountRemaining: bigint;
  exactIn: boolean;
  feePips: number;
  liquidity: bigint;
  sqrtPriceCurrentX96: bigint;
  sqrtPriceTargetX96: bigint;
}): { amountIn: bigint; amountOut: bigint; feeAmount: bigint; sqrtPriceNextX96: bigint } {
  const zeroForOne = input.sqrtPriceCurrentX96 >= input.sqrtPriceTargetX96;
  const feeComplement = FEE_DENOMINATOR - BigInt(input.feePips);
  let sqrtPriceNextX96: bigint;
  let amountOut: bigint;

  if (input.exactIn) {
    const amountRemainingLessFee = mulDiv(input.amountRemaining, feeComplement, FEE_DENOMINATOR);
    const maximumInput = zeroForOne
      ? getAmount0Delta(input.sqrtPriceTargetX96, input.sqrtPriceCurrentX96, input.liquidity, true)
      : getAmount1Delta(input.sqrtPriceCurrentX96, input.sqrtPriceTargetX96, input.liquidity, true);
    sqrtPriceNextX96 =
      amountRemainingLessFee >= maximumInput
        ? input.sqrtPriceTargetX96
        : getNextSqrtPriceFromInput(
            input.sqrtPriceCurrentX96,
            input.liquidity,
            amountRemainingLessFee,
            zeroForOne,
          );
  } else {
    const maximumOutput = zeroForOne
      ? getAmount1Delta(input.sqrtPriceTargetX96, input.sqrtPriceCurrentX96, input.liquidity, false)
      : getAmount0Delta(
          input.sqrtPriceCurrentX96,
          input.sqrtPriceTargetX96,
          input.liquidity,
          false,
        );
    sqrtPriceNextX96 =
      input.amountRemaining >= maximumOutput
        ? input.sqrtPriceTargetX96
        : getNextSqrtPriceFromOutput(
            input.sqrtPriceCurrentX96,
            input.liquidity,
            input.amountRemaining,
            zeroForOne,
          );
  }

  const reachedTarget = sqrtPriceNextX96 === input.sqrtPriceTargetX96;
  const amountIn = zeroForOne
    ? getAmount0Delta(sqrtPriceNextX96, input.sqrtPriceCurrentX96, input.liquidity, true)
    : getAmount1Delta(input.sqrtPriceCurrentX96, sqrtPriceNextX96, input.liquidity, true);
  amountOut = zeroForOne
    ? getAmount1Delta(sqrtPriceNextX96, input.sqrtPriceCurrentX96, input.liquidity, false)
    : getAmount0Delta(input.sqrtPriceCurrentX96, sqrtPriceNextX96, input.liquidity, false);
  if (!input.exactIn && amountOut > input.amountRemaining) amountOut = input.amountRemaining;

  const feeAmount =
    input.exactIn && !reachedTarget
      ? input.amountRemaining - amountIn
      : mulDivRoundingUp(amountIn, BigInt(input.feePips), feeComplement);
  return { amountIn, amountOut, feeAmount, sqrtPriceNextX96 };
}

function getNextSqrtPriceFromInput(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (amountIn === 0n) return sqrtPriceX96;
  return zeroForOne
    ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPriceX96, liquidity, amountIn, true)
    : getNextSqrtPriceFromAmount1RoundingDown(sqrtPriceX96, liquidity, amountIn, true);
}

function getNextSqrtPriceFromOutput(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean,
): bigint {
  if (amountOut === 0n) return sqrtPriceX96;
  return zeroForOne
    ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPriceX96, liquidity, amountOut, false)
    : getNextSqrtPriceFromAmount0RoundingUp(sqrtPriceX96, liquidity, amountOut, false);
}

function getNextSqrtPriceFromAmount0RoundingUp(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  const numerator1 = liquidity << 96n;
  const product = amount * sqrtPriceX96;
  const denominator = add ? numerator1 + product : numerator1 - product;
  if (denominator <= 0n) throw new Error('Uniswap V3 swap exceeds price range');
  return mulDivRoundingUp(numerator1, sqrtPriceX96, denominator);
}

function getNextSqrtPriceFromAmount1RoundingDown(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (add) return sqrtPriceX96 + mulDiv(amount, UNISWAP_V3_Q96, liquidity);
  const quotient = divRoundingUp(amount * UNISWAP_V3_Q96, liquidity);
  if (quotient >= sqrtPriceX96) throw new Error('Uniswap V3 swap exceeds price range');
  return sqrtPriceX96 - quotient;
}

function getAmount0Delta(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtUpper - sqrtLower;
  return roundUp
    ? divRoundingUp(mulDivRoundingUp(numerator1, numerator2, sqrtUpper), sqrtLower)
    : mulDiv(numerator1, numerator2, sqrtUpper) / sqrtLower;
}

function getAmount1Delta(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [sqrtLower, sqrtUpper] = sortRatios(sqrtPriceAX96, sqrtPriceBX96);
  const difference = sqrtUpper - sqrtLower;
  return roundUp
    ? mulDivRoundingUp(liquidity, difference, UNISWAP_V3_Q96)
    : mulDiv(liquidity, difference, UNISWAP_V3_Q96);
}

function sortRatios(a: bigint, b: bigint): [bigint, bigint] {
  if (a <= 0n || b <= 0n || a === b) throw new Error('Invalid Uniswap V3 price range');
  return a < b ? [a, b] : [b, a];
}

function validateConcentratedLiquiditySwapState(
  state: UniswapV3SingleRangeState,
  amount: bigint,
  feePips: number,
  zeroForOne: boolean,
): void {
  if (!Number.isInteger(feePips) || feePips < 0 || feePips >= Number(FEE_DENOMINATOR)) {
    throw new Error('Concentrated-liquidity fee must be between 0 and 999999 pips');
  }
  if (amount < 0n) throw new Error('Concentrated-liquidity swap amount must be non-negative');
  const priceInsideDirectionalRange = zeroForOne
    ? state.sqrtPriceX96 > state.sqrtPriceLowerX96 && state.sqrtPriceX96 <= state.sqrtPriceUpperX96
    : state.sqrtPriceX96 >= state.sqrtPriceLowerX96 && state.sqrtPriceX96 < state.sqrtPriceUpperX96;
  if (
    state.liquidity <= 0n ||
    state.sqrtPriceLowerX96 <= 0n ||
    state.sqrtPriceUpperX96 <= state.sqrtPriceLowerX96 ||
    !priceInsideDirectionalRange
  ) {
    throw new Error('Invalid active concentrated-liquidity range state');
  }
}

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Uniswap V3 division by zero');
  return (a * b) / denominator;
}

function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  return divRoundingUp(a * b, denominator);
}

function divRoundingUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Uniswap V3 division by zero');
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}
