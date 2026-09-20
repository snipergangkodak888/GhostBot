/**
 * Sushi Launchpad dual-ordering quote model.
 *
 * Derives each ordered buyer's conservative `minTokensOut` BEFORE the launch
 * pool exists, entirely locally (no quoter calls, no per-buyer eth_call).
 *
 * Why dual ordering: the Launchpad mints the token with a CREATE2 salt that
 * includes `block.prevrandao`, the block number, and an internal launch
 * nonce, so the token address — and therefore the V3 token0/token1
 * assignment against WETH — is unknowable at planning time. That single bit
 * flips the swap direction and which side of the curve the ordered buys
 * walk. The model therefore simulates the ordered buy list under BOTH
 * orderings for EVERY accepted start tick (planned ± one tick spacing, per
 * the signed start-tick range decision) and takes the lowest output per
 * buyer before applying user slippage: `O(2TN)` local arithmetic, `T = 3`
 * normally.
 *
 * Pool model (verified Launchpad source): a single one-sided position of
 * `totalSupply × (1 − reserveBps)` launch tokens spanning from the start
 * tick to the last usable tick on the token side, 1% fee, tick spacing 200.
 * Ordering B (token = token1) is modeled at the mirrored tick `−t` — the
 * same starting price expressed in the flipped pair orientation; Phase-3
 * fork tests verify this mirror against the live Launchpad.
 */

import {
  getUniswapV3LiquidityForAmounts,
  getUniswapV3SqrtRatioAtTick,
  quoteUniswapV3ExactInput,
  quoteUniswapV3ExactOutput,
  type UniswapV3FeeTier,
  UNISWAP_V3_MAX_TICK,
  type UniswapV3SingleRangeState,
} from './uniswap-v3.ts';
import { keccak256, toHex } from 'viem';

/**
 * PRODUCT cap on ordered buys, shared by every externally reachable route
 * (draft schema and the plan endpoint). The quote model and executor keep a
 * higher generic RESOURCE ceiling on purpose — product caps live at the API
 * layer only.
 */
export const SUSHI_LAUNCHPAD_MAX_BUNDLE_WALLETS = 100;
/**
 * Supply-control ceiling. Beyond this the one-sided launch position cannot
 * fill the buys under every accepted start tick, so the derivation throws;
 * capping here lets the client and the draft schema agree on one number.
 */
export const SUSHI_LAUNCHPAD_MAX_SUPPLY_CONTROL_PCT = 90;

/** Minimum slippage: zero makes a wei of model/pool rounding revert a launch. */
export const SUSHI_LAUNCHPAD_MIN_SLIPPAGE_BPS = 10;

/** Sushi Launchpad pool constants (verified against the launch source). */
export const SUSHI_LAUNCHPAD_FEE_TIER: UniswapV3FeeTier = 10_000;
export const SUSHI_LAUNCHPAD_TICK_SPACING = 200;
export const SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/** One ordered buy to quote. `quoteInWei` is the exact native input. */
export interface SushiLaunchQuoteBuy {
  walletId: string;
  quoteInWei: bigint;
}

export interface SushiLaunchQuoteInput {
  /** Ordered buys; execution order is exactly this order */
  buys: SushiLaunchQuoteBuy[];
  /**
   * The Launchpad's currently computed start tick for WETH, which MUST be a
   * multiple of the tick spacing.
   */
  plannedStartTick: number;
  /** Protocol reserve taken from total supply, basis points */
  reserveBps: number;
  /** User slippage applied AFTER the conservative cross-evaluation minimum */
  slippageBps: number;
  /**
   * Accepted drift around the planned tick in whole tick spacings (default
   * 1, i.e. three accepted ticks). Wider ranges are rejected by policy.
   */
  tickRangeSpacings?: number;
}

/** One simulated (startTick × ordering) evaluation, for diagnostics. */
export interface SushiLaunchQuoteEvaluation {
  startTick: number;
  tokenIsToken0: boolean;
  /** Token output per buyer, aligned with the input buy order */
  outputs: bigint[];
}

export interface SushiLaunchBuyQuote {
  walletId: string;
  quoteInWei: bigint;
  /** Lowest simulated output across every accepted tick and both orderings */
  conservativeTokensOut: bigint;
  /** `conservativeTokensOut` after user slippage; the signed order minimum */
  minTokensOut: bigint;
}

export interface SushiLaunchQuoteResult {
  buys: SushiLaunchBuyQuote[];
  evaluations: SushiLaunchQuoteEvaluation[];
  /** Inclusive signed start-tick bounds for the LaunchRequest */
  maxStartTick: number;
  minStartTick: number;
}

/** Last tick usable at the Launchpad spacing (±887_200 at spacing 200). */
const MAX_USABLE_TICK =
  Math.floor(UNISWAP_V3_MAX_TICK / SUSHI_LAUNCHPAD_TICK_SPACING) * SUSHI_LAUNCHPAD_TICK_SPACING;

/**
 * Simulates the ordered buys under every accepted start tick and both token
 * orderings, returning conservative per-buyer minimums.
 *
 * @param input - Ordered buys, planned tick, reserve bps, and slippage
 * @returns Per-buyer conservative quotes plus every evaluation's outputs
 * @throws {Error} When inputs violate policy bounds or the position cannot
 * satisfy a buy (insufficient one-sided liquidity or partial consumption —
 * the on-chain buy would revert, so the plan must be rejected here)
 */
export function quoteSushiLaunchBuys(input: SushiLaunchQuoteInput): SushiLaunchQuoteResult {
  const tickRangeSpacings = input.tickRangeSpacings ?? 1;
  validateInput(input, tickRangeSpacings);

  const acceptedTicks: number[] = [];
  for (let offset = -tickRangeSpacings; offset <= tickRangeSpacings; offset += 1) {
    acceptedTicks.push(input.plannedStartTick + offset * SUSHI_LAUNCHPAD_TICK_SPACING);
  }
  const positionTokens =
    (SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI * BigInt(10_000 - input.reserveBps)) / 10_000n;

  const evaluations: SushiLaunchQuoteEvaluation[] = [];
  for (const startTick of acceptedTicks) {
    for (const tokenIsToken0 of [true, false]) {
      evaluations.push({
        outputs: simulateOrderedBuys(input.buys, startTick, tokenIsToken0, positionTokens),
        startTick,
        tokenIsToken0,
      });
    }
  }

  const buys: SushiLaunchBuyQuote[] = input.buys.map((buy, index) => {
    let conservative = evaluations[0]?.outputs[index] as bigint;
    for (const evaluation of evaluations) {
      const output = evaluation.outputs[index] as bigint;
      if (output < conservative) {
        conservative = output;
      }
    }
    const minTokensOut = (conservative * BigInt(10_000 - input.slippageBps)) / 10_000n;
    if (minTokensOut <= 0n) {
      throw new Error(
        `Sushi launch quote for wallet ${buy.walletId} collapses to zero after slippage`,
      );
    }
    return {
      conservativeTokensOut: conservative,
      minTokensOut,
      quoteInWei: buy.quoteInWei,
      walletId: buy.walletId,
    };
  });

  return {
    buys,
    evaluations,
    maxStartTick: input.plannedStartTick + tickRangeSpacings * SUSHI_LAUNCHPAD_TICK_SPACING,
    minStartTick: input.plannedStartTick - tickRangeSpacings * SUSHI_LAUNCHPAD_TICK_SPACING,
  };
}

/**
 * Builds the freshly initialized one-sided pool state for one planning
 * state (start tick x ordering).
 *
 * Ordering A (token = token0): the position spans `[startTick, maxUsable]`
 * in token0; WETH (token1) buys move the price UP (`zeroForOne = false`).
 * Ordering B (token = token1): modeled at the mirrored tick `−startTick`;
 * the position spans `[−maxUsable, −startTick]` in token1; WETH (token0)
 * buys move the price DOWN (`zeroForOne = true`). The pool sits EXACTLY on the position
 * boundary (the protocol's in-range check is `tickLower <= currentTick`),
 * but the shared math validates a strictly-inside price: liquidity is
 * computed at the true boundary, and the walk starts one Q96 unit inside
 * the range in the direction of travel — a ~2^-96 relative error,
 * conservative.
 */
function buildPoolState(
  startTick: number,
  tokenIsToken0: boolean,
  positionTokens: bigint,
): UniswapV3SingleRangeState {
  const poolTick = tokenIsToken0 ? startTick : -startTick;
  const sqrtStart = getUniswapV3SqrtRatioAtTick(poolTick);
  const sqrtLower = tokenIsToken0 ? sqrtStart : getUniswapV3SqrtRatioAtTick(-MAX_USABLE_TICK);
  const sqrtUpper = tokenIsToken0 ? getUniswapV3SqrtRatioAtTick(MAX_USABLE_TICK) : sqrtStart;
  const liquidity = getUniswapV3LiquidityForAmounts(
    sqrtStart,
    sqrtLower,
    sqrtUpper,
    tokenIsToken0 ? positionTokens : 0n,
    tokenIsToken0 ? 0n : positionTokens,
  );
  if (liquidity <= 0n) {
    throw new Error('Sushi launch position resolves to zero liquidity');
  }
  return {
    liquidity,
    sqrtPriceLowerX96: sqrtLower,
    sqrtPriceUpperX96: sqrtUpper,
    sqrtPriceX96: tokenIsToken0 ? sqrtStart + 1n : sqrtStart - 1n,
  };
}

function simulateOrderedBuys(
  buys: SushiLaunchQuoteBuy[],
  startTick: number,
  tokenIsToken0: boolean,
  positionTokens: bigint,
): bigint[] {
  let state = buildPoolState(startTick, tokenIsToken0, positionTokens);
  const zeroForOne = !tokenIsToken0;
  const outputs: bigint[] = [];
  for (const buy of buys) {
    const quote = quoteUniswapV3ExactInput(
      state,
      buy.quoteInWei,
      SUSHI_LAUNCHPAD_FEE_TIER,
      zeroForOne,
    );
    if (quote.insufficientLiquidity || quote.amountIn !== buy.quoteInWei) {
      // The delegate requires full input consumption on-chain; a partial
      // fill would revert the entire launch, so reject the plan up front.
      throw new Error(
        `Sushi launch position cannot absorb the ordered buys (wallet ${buy.walletId})`,
      );
    }
    if (quote.amountOut <= 0n) {
      throw new Error(`Sushi launch buy for wallet ${buy.walletId} produces zero output`);
    }
    outputs.push(quote.amountOut);
    state = quote.nextState;
  }
  return outputs;
}

export interface DeriveSushiBuysInput {
  /** Ordered bundle wallet ids; execution order is exactly this order */
  bundleWalletIds: string[];
  /** Percent of total supply the bundle must capture (aggregate floor) */
  targetSupplyPct: number;
  /** Per-wallet jitter percent on the equal split (0 disables) */
  supplyJitterPct: number;
  /** Deterministic jitter seed; freezing the plan freezes the amounts */
  jitterSeed: string;
  plannedStartTick: number;
  reserveBps: number;
  tickRangeSpacings?: number;
}

export interface DerivedSushiBuy {
  walletId: string;
  /** Frozen exact input: the LARGEST required input across all six states */
  quoteInWei: bigint;
  /** This wallet's token allocation the derivation targeted */
  targetTokens: bigint;
}

/**
 * Derives frozen per-wallet buy amounts from a supply target — the
 * Balloon-style freezing layer over the dual-ordering model.
 *
 * The aggregate target is split equally across the ordered wallets, jittered
 * deterministically from `jitterSeed`, renormalized, and then each wallet's
 * REQUIRED INPUT is computed via sequential exact-output quotes under every
 * accepted start tick and both token orderings. The frozen input per wallet
 * is the largest requirement across those six states.
 *
 * Floor semantics (deliberate, documented in token-launch-budgets.md): the
 * AGGREGATE fill is a strict floor — total tokens bought with the frozen
 * inputs meet or exceed the supply target in every state, because the
 * cumulative-input → cumulative-output curve is monotone. Individual wallet
 * fills vary slightly around their targets in mixed states (the same
 * variance class as jitter); per-wallet minimums come from
 * `quoteSushiLaunchBuys` over the frozen amounts, which models execution
 * exactly.
 *
 * @throws {Error} When the target exceeds the one-sided position's capacity
 * in any state, or inputs violate policy bounds
 */
export function deriveSushiBuysFromSupplyTarget(input: DeriveSushiBuysInput): DerivedSushiBuy[] {
  const tickRangeSpacings = input.tickRangeSpacings ?? 1;
  if (input.bundleWalletIds.length === 0 || input.bundleWalletIds.length > 255) {
    throw new Error('Sushi launch derivation requires 1-255 ordered wallets');
  }
  if (
    !Number.isFinite(input.targetSupplyPct) ||
    input.targetSupplyPct <= 0 ||
    input.targetSupplyPct >= 100
  ) {
    throw new Error('Sushi launch targetSupplyPct must be in (0, 100)');
  }
  if (
    !Number.isFinite(input.supplyJitterPct) ||
    input.supplyJitterPct < 0 ||
    input.supplyJitterPct > 50
  ) {
    throw new Error('Sushi launch supplyJitterPct must be in [0, 50]');
  }

  // Equal split with deterministic jitter, renormalized to the exact total.
  const totalTargetTokens =
    (SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI * BigInt(Math.round(input.targetSupplyPct * 100))) / 10_000n;
  const weights = input.bundleWalletIds.map((walletId, index) => {
    const digest = keccak256(toHex(`${input.jitterSeed}:${walletId}:${index}`));
    // Uniform in [-1, 1] from the top 8 hash bytes.
    const unit = Number(BigInt(digest.slice(0, 18)) % 2_000_001n) / 1_000_000 - 1;
    return 1 + (input.supplyJitterPct / 100) * unit;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const allocations = weights.map(
    (weight) =>
      (totalTargetTokens * BigInt(Math.round((weight / weightSum) * 1_000_000_000))) /
      (1_000_000_000n * 1n),
  );
  // Renormalization dust goes to the last wallet so the sum is exact.
  const allocated = allocations.reduce((a, b) => a + b, 0n);
  const lastIndex = allocations.length - 1;
  allocations[lastIndex] = (allocations[lastIndex] as bigint) + (totalTargetTokens - allocated);

  const positionTokens =
    (SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI * BigInt(10_000 - input.reserveBps)) / 10_000n;
  if (totalTargetTokens >= positionTokens) {
    throw new Error('Sushi launch supply target exceeds the launch position');
  }

  return deriveSushiBuysFromAllocations({
    allocations,
    bundleWalletIds: input.bundleWalletIds,
    plannedStartTick: input.plannedStartTick,
    reserveBps: input.reserveBps,
    tickRangeSpacings,
  });
}

/**
 * Derives frozen per-wallet inputs from EXPLICIT token allocations.
 *
 * The split-and-jitter step in {@link deriveSushiBuysFromSupplyTarget} exists
 * only to produce these allocations; callers that already know each wallet's
 * intended share (a hand-edited funding table, a rehydrated plan) come here
 * directly. Freezing semantics are identical: each wallet's input is the
 * LARGEST requirement across every accepted start tick and both token
 * orderings, so the aggregate fill is a floor in all of them.
 *
 * @param input.allocations - Target tokens per wallet, positionally aligned to `bundleWalletIds`
 * @param input.bundleWalletIds - Ordered bundle wallet ids; execution order is exactly this order
 * @param input.plannedStartTick - Center of the accepted start-tick band
 * @param input.reserveBps - Basis points of supply withheld from the launch position
 * @param input.tickRangeSpacings - Accepted tick band half-width, in spacings (0 or 1)
 *
 * @returns One frozen buy per wallet, in the given order
 *
 * @throws {Error} When the position cannot supply an allocation in any accepted state
 */
export function deriveSushiBuysFromAllocations(input: {
  allocations: readonly bigint[];
  bundleWalletIds: readonly string[];
  plannedStartTick: number;
  reserveBps: number;
  tickRangeSpacings?: number;
}): DerivedSushiBuy[] {
  const tickRangeSpacings = input.tickRangeSpacings ?? 1;
  const { allocations } = input;
  if (allocations.length !== input.bundleWalletIds.length) {
    throw new Error('Sushi launch derivation needs one allocation per wallet');
  }
  const positionTokens =
    (SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI * BigInt(10_000 - input.reserveBps)) / 10_000n;
  const requiredInputs: bigint[] = input.bundleWalletIds.map(() => 0n);
  for (let offset = -tickRangeSpacings; offset <= tickRangeSpacings; offset += 1) {
    const startTick = input.plannedStartTick + offset * SUSHI_LAUNCHPAD_TICK_SPACING;
    for (const tokenIsToken0 of [true, false]) {
      let state = buildPoolState(startTick, tokenIsToken0, positionTokens);
      const zeroForOne = !tokenIsToken0;
      for (const [index, allocation] of allocations.entries()) {
        const quote = quoteUniswapV3ExactOutput(
          state,
          allocation,
          SUSHI_LAUNCHPAD_FEE_TIER,
          zeroForOne,
        );
        if (quote.insufficientLiquidity || quote.amountOut !== allocation) {
          throw new Error(
            `Sushi launch position cannot supply the target allocation for wallet ${
              input.bundleWalletIds[index]
            }`,
          );
        }
        if (quote.amountIn > (requiredInputs[index] as bigint)) {
          requiredInputs[index] = quote.amountIn;
        }
        state = quote.nextState;
      }
    }
  }

  return input.bundleWalletIds.map((walletId, index) => ({
    quoteInWei: requiredInputs[index] as bigint,
    targetTokens: allocations[index] as bigint,
    walletId,
  }));
}

function validateInput(input: SushiLaunchQuoteInput, tickRangeSpacings: number): void {
  if (input.buys.length === 0 || input.buys.length > 255) {
    throw new Error('Sushi launch quote requires 1-255 ordered buys');
  }
  const walletIds = new Set<string>();
  for (const buy of input.buys) {
    if (!buy.walletId || walletIds.has(buy.walletId)) {
      throw new Error('Sushi launch buys require unique wallet ids');
    }
    walletIds.add(buy.walletId);
    if (buy.quoteInWei <= 0n) {
      throw new Error(`Sushi launch buy for wallet ${buy.walletId} must have positive input`);
    }
  }
  if (input.plannedStartTick % SUSHI_LAUNCHPAD_TICK_SPACING !== 0) {
    throw new Error('Sushi launch planned start tick must align to the tick spacing');
  }
  if (!Number.isInteger(tickRangeSpacings) || tickRangeSpacings < 0 || tickRangeSpacings > 1) {
    throw new Error('Sushi launch tick range wider than one spacing is rejected by policy');
  }
  if (
    Math.abs(input.plannedStartTick) + tickRangeSpacings * SUSHI_LAUNCHPAD_TICK_SPACING >=
    MAX_USABLE_TICK
  ) {
    throw new Error('Sushi launch start tick range exceeds usable tick bounds');
  }
  if (!Number.isInteger(input.reserveBps) || input.reserveBps < 0 || input.reserveBps >= 10_000) {
    throw new Error('Sushi launch reserveBps must be in [0, 10000)');
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('Sushi launch slippageBps must be in [0, 5000]');
  }
}

/** One frozen buy and the supply it is projected to capture. */
export interface SushiLaunchAmountProjection {
  /** Frozen wei this wallet spends. */
  quoteInWei: bigint;
  /** Tokens the buy is projected to receive at the evaluated tick. */
  tokensOut: bigint;
  /** Share of total supply, as a percentage. */
  supplyPct: number;
  walletId: string;
}

/**
 * Projects what a set of FROZEN ETH amounts buys at a given start tick.
 *
 * The inverse of `deriveSushiBuysFromSupplyTarget`, and the direction the
 * product actually commits to: the user funds an amount, and the supply that
 * amount captures is an outcome of the tick the Launchpad picks at launch.
 * Because the tick moves with the quote-token price feed, freezing a
 * percentage would silently change the ETH required; freezing the amount
 * cannot go stale.
 *
 * Evaluated at the CONSERVATIVE end of the accepted tick band — the same six
 * tick x ordering states the derivation freezes against — so a displayed
 * percentage understates rather than overstates what a launch will capture,
 * and so converting a percentage to ETH and back returns the percentage the
 * user actually typed.
 *
 * @param input.buys - Frozen amounts in execution order
 * @param input.plannedStartTick - Centre of the accepted start-tick band
 * @param input.reserveBps - Protocol reserve withheld from the position
 * @param input.tickRangeSpacings - Band half-width in spacings (0 or 1)
 * @returns Per-buy projections plus the aggregate supply percentage
 */
export function projectSushiSupplyForAmounts(input: {
  buys: readonly SushiLaunchQuoteBuy[];
  plannedStartTick: number;
  reserveBps: number;
  tickRangeSpacings?: number;
}): { buys: SushiLaunchAmountProjection[]; totalSupplyPct: number } {
  const tickRangeSpacings = input.tickRangeSpacings ?? 1;
  const positionTokens =
    (SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI * BigInt(10_000 - input.reserveBps)) / 10_000n;

  // Every accepted start tick AND both orderings — the same six states
  // `deriveSushiBuysFromAllocations` freezes against, and the smallest fill
  // across them is what we report.
  //
  // Scanning the whole band is what makes the two directions agree. The
  // derivation takes the LARGEST input needed across all six states, so a user
  // who asks for 1.8% gets an amount that buys at least 1.8% in the worst one.
  // Evaluating only the centre tick here would report what that amount buys at
  // the EXPECTED tick — around 2% more — and hand the user back a percentage
  // they never typed.
  let worst: { fills: bigint[]; total: bigint } | undefined;
  for (let offset = -tickRangeSpacings; offset <= tickRangeSpacings; offset += 1) {
    const startTick = input.plannedStartTick + offset * SUSHI_LAUNCHPAD_TICK_SPACING;
    for (const tokenIsToken0 of [true, false]) {
      const fills = simulateOrderedBuys([...input.buys], startTick, tokenIsToken0, positionTokens);
      const total = fills.reduce((sum, fill) => sum + fill, 0n);
      if (!worst || total < worst.total) {
        worst = { fills, total };
      }
    }
  }
  const resolved = worst ?? { fills: input.buys.map(() => 0n), total: 0n };
  const toPct = (tokens: bigint): number =>
    Number((tokens * 1_000_000n) / SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI) / 10_000;
  return {
    buys: input.buys.map((buy, index) => {
      const tokensOut = (resolved.fills[index] ?? 0n) as bigint;
      return {
        quoteInWei: buy.quoteInWei,
        supplyPct: toPct(tokensOut),
        tokensOut,
        walletId: buy.walletId,
      };
    }),
    totalSupplyPct: toPct(resolved.total),
  };
}
