/**
 * Deterministic Pons V2 bonding-curve math.
 *
 * This module mirrors the integer operation order documented by Pons V2 and
 * is shared by the browser and API. Amounts are raw units of the launch's
 * quote asset (wei for native launches, the pair token's base units for
 * ERC-20 launches); the arithmetic is decimal-agnostic. Percentages remain
 * the saved authority; callers convert each saved allocation to an exact
 * token amount before invoking the ordered planner.
 */

import {
  buildPonsV2GraduatedPoolFromCurve,
  type PonsV2GraduatedPoolState,
  type PonsV2GraduatedPoolTerms,
  type PonsV2PlannedPoolBuy,
  type PonsV2PoolAllocation,
  planPonsV2PoolBuys,
} from './pons-v2-graduated-pool.ts';

/** Pons factory exemption-list limit and SUMO curve-buyer cap. */
export const PONS_V2_MAX_BUNDLE_WALLETS = 32;

/** Current production launch-config id reviewed for native Pons launches. */
export const PONS_V2_NATIVE_LAUNCH_CONFIG_ID = 0n;

/** Fixed token decimals used by the current Pons native launch config. */
export const PONS_V2_TOKEN_DECIMALS = 18;

/** Current production supply, used for deterministic draft estimates. */
export const PONS_V2_ESTIMATE_TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/** Current production curve fee, used for deterministic draft estimates. */
export const PONS_V2_ESTIMATE_CURVE_FEE_BPS = 100;

/** Current production phantom native reserve, used for draft estimates. */
export const PONS_V2_ESTIMATE_PHANTOM_QUOTE_WEI = 1_680_000_000_000_000_000n;

/** Current production graduation threshold, used for draft estimates. */
export const PONS_V2_ESTIMATE_GRADUATION_THRESHOLD_WEI = 4_200_000_000_000_000_000n;

/** Current production token-launch fee, used for deterministic draft budgets. */
export const PONS_V2_ESTIMATE_LAUNCH_FEE_WEI = 500_000_000_000_000n;

/** Current production meme-hook fee on graduated-pool swaps, for draft estimates. */
export const PONS_V2_ESTIMATE_HOOK_FEE_BPS = 100;

/** Current production graduated-pool LP fee (the factory requires zero). */
export const PONS_V2_ESTIMATE_POOL_FEE_PIPS = 0;

/** Current production graduated-pool tick spacing, for draft estimates. */
export const PONS_V2_ESTIMATE_TICK_SPACING = 200;

/**
 * Maximum total creator-plus-bundle supply exposed by SUMO.
 *
 * The reviewed native config makes 71.428571% sellable. This value is the
 * highest four-decimal percentage that remains below that protocol limit.
 */
export const PONS_V2_MAX_SUPPLY_CONTROL_UNITS = 714_285n;

/** Fixed denominator for the four-decimal percentage cap above. */
export const PONS_V2_SUPPLY_PERCENT_SCALE = 1_000_000n;

/** Browser/API numeric form of the maximum supported supply control. */
export const PONS_V2_MAX_SUPPLY_CONTROL_PCT = Number(PONS_V2_MAX_SUPPLY_CONTROL_UNITS) / 10_000;

/** Post-graduation wallet cap, matching the executor's pool-buy limit. */
export const PONS_V2_MAX_POST_GRADUATION_WALLETS = 32;

/**
 * Smallest supply share one launch wallet may be assigned, in percent.
 *
 * Bounds the dev buy in a Graduation Bundle (every bundle wallet keeps at
 * least this much of the curve) and the post-graduation target (every
 * post-graduation wallet buys at least this much from the pool).
 */
export const PONS_V2_MIN_WALLET_SUPPLY_PCT = 0.01;

/**
 * Maximum Graduation Bundle supply control in four-decimal percentage units:
 * the sellable curve plus the tokens the factory seeds into the graduated
 * pool, under the reviewed native config (91.8367%). Buying the entire pool
 * inventory is impossible, so the planner rejects targets near this bound.
 */
export const PONS_V2_MAX_GRADUATION_BUNDLE_SUPPLY_CONTROL_UNITS =
  ((calculatePonsV2SellableTokens({
    graduationThresholdWei: PONS_V2_ESTIMATE_GRADUATION_THRESHOLD_WEI,
    phantomQuoteWei: PONS_V2_ESTIMATE_PHANTOM_QUOTE_WEI,
    supplyWei: PONS_V2_ESTIMATE_TOTAL_SUPPLY_WEI,
  }) +
    calculatePonsV2GraduatedPoolInventory({
      graduationThresholdWei: PONS_V2_ESTIMATE_GRADUATION_THRESHOLD_WEI,
      phantomQuoteWei: PONS_V2_ESTIMATE_PHANTOM_QUOTE_WEI,
      supplyWei: PONS_V2_ESTIMATE_TOTAL_SUPPLY_WEI,
    })) *
    PONS_V2_SUPPLY_PERCENT_SCALE) /
  PONS_V2_ESTIMATE_TOTAL_SUPPLY_WEI;

/** Browser/API numeric form of the Graduation Bundle supply-control ceiling. */
export const PONS_V2_MAX_GRADUATION_BUNDLE_SUPPLY_CONTROL_PCT =
  Number(PONS_V2_MAX_GRADUATION_BUNDLE_SUPPLY_CONTROL_UNITS) / 10_000;

const BPS_DENOMINATOR = 10_000n;

/** Curve state required to quote one ordered native buy. */
export interface PonsV2CurveState {
  /** Virtual native reserve: phantom quote plus net tracked quote. */
  quoteReserveWei: bigint;
  /** Tokens still physically held by the curve. */
  tokenReserveWei: bigint;
  /** Tokens that may still be sold before the reserved pool allocation. */
  sellableTokensWei: bigint;
  /** Base Pons curve fee. */
  curveFeeBps: number;
  /** Optional creator tax selected at launch. */
  creatorTaxBps: number;
  /** Recipient-specific opening buy tax; zero for launch-exempt wallets and sells. */
  snipeTaxBps?: number;
}

/** Settlement result for one exact-input Pons curve buy. */
export interface PonsV2BuyQuote {
  grossInputWei: bigint;
  spentInputWei: bigint;
  refundWei: bigint;
  curveFeeWei: bigint;
  creatorTaxWei: bigint;
  snipeTaxWei: bigint;
  netInputWei: bigint;
  tokensOutWei: bigint;
  nextState: PonsV2CurveState;
  reachesGraduation: boolean;
}

/** Settlement result for one exact-input Pons curve sell. */
export interface PonsV2SellQuote {
  tokensInWei: bigint;
  grossQuoteOutWei: bigint;
  curveFeeWei: bigint;
  creatorTaxWei: bigint;
  quoteOutWei: bigint;
  nextState: PonsV2CurveState;
}

/** One authoritative token allocation in launch execution order. */
export interface PonsV2LaunchAllocation {
  walletId: string;
  tokensOutWei: bigint;
}

/** One planned Pons launch buy derived from an authoritative allocation. */
export interface PonsV2PlannedBuy extends PonsV2BuyQuote {
  role: 'bundle' | 'dev';
  walletId: string;
  targetTokensOutWei: bigint;
  minTokensOutWei: bigint;
}

/** Complete sequential launch plan. */
export interface PonsV2LaunchPlan {
  buys: PonsV2PlannedBuy[];
  finalState: PonsV2CurveState;
  totalGrossInputWei: bigint;
  totalTokensOutWei: bigint;
}

/**
 * Derives the number of launch tokens reserved for curve buyers.
 *
 * Pons reserves `supply * phantom / (phantom + threshold)` for the eventual
 * pool, leaving the remainder sellable on the curve.
 *
 * @param input - Launch supply and native curve economics.
 * @returns Tokens available to curve buyers.
 * @throws {Error} If the supplied economics are not positive.
 */
export function calculatePonsV2SellableTokens(input: {
  supplyWei: bigint;
  phantomQuoteWei: bigint;
  graduationThresholdWei: bigint;
}): bigint {
  if (input.supplyWei <= 0n || input.phantomQuoteWei <= 0n || input.graduationThresholdWei <= 0n) {
    throw new Error('Pons V2 launch economics must be positive');
  }
  const reserved =
    (input.supplyWei * input.phantomQuoteWei) /
    (input.phantomQuoteWei + input.graduationThresholdWei);
  return input.supplyWei - reserved;
}

/**
 * Builds the initial curve state for one native Pons launch.
 *
 * @param input - Live or reviewed factory economics and creator tax.
 * @returns Fresh curve state before the first buy.
 * @throws {Error} If fee or reserve inputs are invalid.
 */
export function buildPonsV2InitialCurveState(input: {
  supplyWei: bigint;
  phantomQuoteWei: bigint;
  graduationThresholdWei: bigint;
  curveFeeBps: number;
  creatorTaxBps: number;
}): PonsV2CurveState {
  validateFeeBps(input.curveFeeBps, input.creatorTaxBps);
  return {
    creatorTaxBps: input.creatorTaxBps,
    curveFeeBps: input.curveFeeBps,
    quoteReserveWei: input.phantomQuoteWei,
    sellableTokensWei: calculatePonsV2SellableTokens(input),
    tokenReserveWei: input.supplyWei,
  };
}

/**
 * Quotes one native Pons buy in the exact contract arithmetic order.
 *
 * Fees are floored independently before constant-product pricing. If an
 * exact input crosses the reserved allocation, the quote is clamped and the
 * unused native input is returned, matching `CurveBuyRefunded` semantics.
 *
 * @param state - Curve state immediately before the buy.
 * @param grossInputWei - Native input supplied to `buy`.
 * @returns Settlement amounts and the next ordered curve state.
 * @throws {Error} If the state or input is invalid.
 */
export function quotePonsV2BuyExactIn(
  state: PonsV2CurveState,
  grossInputWei: bigint,
): PonsV2BuyQuote {
  validateState(state);
  if (grossInputWei <= 0n) {
    throw new Error('Pons V2 buy input must be positive');
  }

  const effectiveSnipeTaxBps = resolvePonsV2EffectiveSnipeTaxBps({
    creatorTaxBps: state.creatorTaxBps,
    curveFeeBps: state.curveFeeBps,
    rawSnipeTaxBps: state.snipeTaxBps ?? 0,
  });
  let spentInputWei = grossInputWei;
  let fees = calculatePonsV2Fees(
    spentInputWei,
    state.curveFeeBps,
    state.creatorTaxBps,
    effectiveSnipeTaxBps,
  );
  let tokensOutWei = amountOut(fees.netInputWei, state.quoteReserveWei, state.tokenReserveWei);

  if (tokensOutWei > state.sellableTokensWei) {
    tokensOutWei = state.sellableTokensWei;
    const netRequired = amountIn(tokensOutWei, state.quoteReserveWei, state.tokenReserveWei);
    spentInputWei = solveGrossInputForNet(
      netRequired,
      state.curveFeeBps,
      state.creatorTaxBps,
      effectiveSnipeTaxBps,
    );
    if (spentInputWei > grossInputWei) {
      spentInputWei = grossInputWei;
    }
    fees = calculatePonsV2Fees(
      spentInputWei,
      state.curveFeeBps,
      state.creatorTaxBps,
      effectiveSnipeTaxBps,
    );
  }

  const nextState: PonsV2CurveState = {
    ...state,
    quoteReserveWei: state.quoteReserveWei + fees.netInputWei,
    sellableTokensWei: state.sellableTokensWei - tokensOutWei,
    tokenReserveWei: state.tokenReserveWei - tokensOutWei,
  };

  return {
    creatorTaxWei: fees.creatorTaxWei,
    curveFeeWei: fees.curveFeeWei,
    grossInputWei,
    netInputWei: fees.netInputWei,
    nextState,
    reachesGraduation: nextState.sellableTokensWei === 0n,
    refundWei: grossInputWei - spentInputWei,
    spentInputWei,
    snipeTaxWei: fees.snipeTaxWei,
    tokensOutWei,
  };
}

/**
 * Quotes one Pons sell in the exact documented contract arithmetic order.
 *
 * Constant-product output is computed first; the curve fee and creator tax
 * are then floored independently from that gross quote output. Opening snipe
 * tax never applies to sells.
 *
 * @param state - Curve state immediately before the sell.
 * @param tokensInWei - Launch-token input.
 * @returns Settlement amounts and the next ordered curve state.
 * @throws {Error} If state or input is invalid.
 */
export function quotePonsV2SellExactIn(
  state: PonsV2CurveState,
  tokensInWei: bigint,
): PonsV2SellQuote {
  validateState(state);
  if (tokensInWei <= 0n) {
    throw new Error('Pons V2 sell input must be positive');
  }
  const grossQuoteOutWei = amountOut(tokensInWei, state.tokenReserveWei, state.quoteReserveWei);
  const curveFeeWei = (grossQuoteOutWei * BigInt(state.curveFeeBps)) / BPS_DENOMINATOR;
  const creatorTaxWei = (grossQuoteOutWei * BigInt(state.creatorTaxBps)) / BPS_DENOMINATOR;
  const quoteOutWei = grossQuoteOutWei - curveFeeWei - creatorTaxWei;
  return {
    creatorTaxWei,
    curveFeeWei,
    grossQuoteOutWei,
    nextState: {
      ...state,
      quoteReserveWei: state.quoteReserveWei - grossQuoteOutWei,
      sellableTokensWei: state.sellableTokensWei + tokensInWei,
      tokenReserveWei: state.tokenReserveWei + tokensInWei,
    },
    quoteOutWei,
    tokensInWei,
  };
}

/**
 * Calculates the marginal Pons curve price as quote raw units per token raw unit.
 * Accepts the terminal graduation state: sellable inventory is zero, but
 * positive virtual reserves still define the curve's terminal price.
 *
 * @param state - Current curve reserves.
 * @returns WAD-scaled marginal price.
 * @throws {Error} If reserves, inventory bounds, or fees are invalid.
 */
export function calculatePonsV2SpotPriceWad(state: PonsV2CurveState): bigint {
  validatePricingState(state);
  return (state.quoteReserveWei * 10n ** 18n) / state.tokenReserveWei;
}

/**
 * Applies Pons's opening-tax safety cap to the recipient-specific raw rate.
 *
 * The curve always leaves at least 100 bps of a buy after its base fee,
 * creator tax, and opening tax. `currentSnipeTaxBps` returns the uncapped
 * decaying rate, so every off-chain quote must apply this cap itself.
 *
 * @param input - Immutable launch fees and the live raw opening-tax rate.
 * @returns Effective opening-tax rate used by the curve for this recipient.
 */
export function resolvePonsV2EffectiveSnipeTaxBps(input: {
  creatorTaxBps: number;
  curveFeeBps: number;
  rawSnipeTaxBps: number;
}): number {
  validateBaseFees(input.curveFeeBps, input.creatorTaxBps);
  if (!Number.isInteger(input.rawSnipeTaxBps) || input.rawSnipeTaxBps < 0) {
    throw new Error('Invalid Pons V2 snipe tax');
  }
  if (input.rawSnipeTaxBps === 0) return 0;
  return Math.min(
    input.rawSnipeTaxBps,
    Math.max(0, 10_000 - input.curveFeeBps - input.creatorTaxBps - 100),
  );
}

/**
 * Solves the minimum gross quote input that returns an exact token target.
 *
 * A target equal to the remaining sellable allocation is the graduating buy:
 * the curve clamps it to that allocation, and the minimal input found here
 * is spent in full, so the buy lands with no refund and exhausts the curve.
 *
 * @param state - Curve state immediately before the buy.
 * @param targetTokensOutWei - Required token output.
 * @returns Minimal gross input and its exact forward quote.
 * @throws {Error} If the target is zero or exceeds the remaining sellable
 * allocation.
 */
export function solvePonsV2GrossBuyForTokens(
  state: PonsV2CurveState,
  targetTokensOutWei: bigint,
): PonsV2BuyQuote {
  validateState(state);
  if (targetTokensOutWei <= 0n) {
    throw new Error('Pons V2 token target must be positive');
  }
  if (targetTokensOutWei > state.sellableTokensWei) {
    throw new Error('Pons V2 token target exceeds the sellable curve allocation');
  }

  const netRequired = amountIn(targetTokensOutWei, state.quoteReserveWei, state.tokenReserveWei);
  const effectiveSnipeTaxBps = resolvePonsV2EffectiveSnipeTaxBps({
    creatorTaxBps: state.creatorTaxBps,
    curveFeeBps: state.curveFeeBps,
    rawSnipeTaxBps: state.snipeTaxBps ?? 0,
  });
  let grossInputWei = solveGrossInputForNet(
    netRequired,
    state.curveFeeBps,
    state.creatorTaxBps,
    effectiveSnipeTaxBps,
  );
  let quote = quotePonsV2BuyExactIn(state, grossInputWei);

  while (quote.tokensOutWei < targetTokensOutWei) {
    grossInputWei += 1n;
    quote = quotePonsV2BuyExactIn(state, grossInputWei);
  }
  while (grossInputWei > 1n) {
    const previous = tryQuote(() => quotePonsV2BuyExactIn(state, grossInputWei - 1n));
    if (!previous || previous.tokensOutWei < targetTokensOutWei) {
      break;
    }
    grossInputWei -= 1n;
    quote = previous;
  }
  return quote;
}

/** Treats a quote the curve would revert (dust input) as delivering nothing. */
function tryQuote<T>(quote: () => T): T | null {
  try {
    return quote();
  } catch {
    return null;
  }
}

/**
 * Solves the minimum launch-token input that returns a requested quote output.
 *
 * Pons exposes only an exact-input `sell`. This inverse first derives the
 * minimum pre-fee curve output, then proves minimality by forwarding the
 * selected token input and one atomic unit less through the exact contract
 * arithmetic.
 *
 * @param state - Curve state immediately before the sell.
 * @param targetQuoteOutWei - Required quote-token output after Pons fees.
 * @returns Minimal token input and its exact forward quote.
 * @throws {Error} If the target is zero or cannot be produced by the remaining
 * quote reserve.
 */
export function solvePonsV2TokensForQuoteOut(
  state: PonsV2CurveState,
  targetQuoteOutWei: bigint,
): PonsV2SellQuote {
  validateState(state);
  if (targetQuoteOutWei <= 0n) {
    throw new Error('Pons V2 quote target must be positive');
  }

  const feeDenominator = BPS_DENOMINATOR - BigInt(state.curveFeeBps + state.creatorTaxBps);
  let grossQuoteOutWei =
    (targetQuoteOutWei * BPS_DENOMINATOR + feeDenominator - 1n) / feeDenominator;
  while (netSellQuoteOut(grossQuoteOutWei, state) < targetQuoteOutWei) {
    grossQuoteOutWei += 1n;
  }
  while (
    grossQuoteOutWei > 1n &&
    netSellQuoteOut(grossQuoteOutWei - 1n, state) >= targetQuoteOutWei
  ) {
    grossQuoteOutWei -= 1n;
  }
  if (grossQuoteOutWei >= state.quoteReserveWei) {
    throw new Error('Pons V2 quote target exceeds available liquidity');
  }

  let tokensInWei = amountIn(grossQuoteOutWei, state.tokenReserveWei, state.quoteReserveWei);
  let quote = quotePonsV2SellExactIn(state, tokensInWei);
  while (quote.quoteOutWei < targetQuoteOutWei) {
    tokensInWei += 1n;
    quote = quotePonsV2SellExactIn(state, tokensInWei);
  }
  while (tokensInWei > 1n) {
    const previous = tryQuote(() => quotePonsV2SellExactIn(state, tokensInWei - 1n));
    if (!previous || previous.quoteOutWei < targetQuoteOutWei) break;
    tokensInWei -= 1n;
    quote = previous;
  }
  return quote;
}

/**
 * Plans every percentage-derived Pons curve buy in its saved execution order.
 *
 * In the default bundle mode the plan must leave the curve active. With
 * `exhaustCurve` the plan must instead spend the whole sellable allocation,
 * so the final buy graduates the curve inside the launch transaction.
 *
 * @param input - Initial state, authoritative token allocations, user
 * slippage applied to each exact target, and the graduation mode.
 * @returns Ordered per-wallet inputs and final curve state.
 * @throws {Error} If wallet count, allocation, slippage, or graduation safety
 * is invalid.
 */
export function planPonsV2LaunchBuys(input: {
  initialState: PonsV2CurveState;
  /** Optional creator allocation. Omit it when `devBuyPct` is zero. */
  devAllocation?: PonsV2LaunchAllocation;
  /** External bundle allocations; the creator does not consume this cap. */
  allocations: PonsV2LaunchAllocation[];
  slippageBps: number;
  /** Require the ordered buys to exhaust the curve exactly. */
  exhaustCurve?: boolean;
}): PonsV2LaunchPlan {
  if (input.allocations.length < 1 || input.allocations.length > PONS_V2_MAX_BUNDLE_WALLETS) {
    throw new Error(`Pons V2 launch requires 1-${PONS_V2_MAX_BUNDLE_WALLETS} buyers`);
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 5_000) {
    throw new Error('Pons V2 slippage must be between 0 and 5000 bps');
  }
  const orderedAllocations = [
    ...(input.devAllocation ? [{ ...input.devAllocation, role: 'dev' as const }] : []),
    ...input.allocations.map((allocation) => ({ ...allocation, role: 'bundle' as const })),
  ];
  if (
    new Set(orderedAllocations.map((allocation) => allocation.walletId)).size !==
    orderedAllocations.length
  ) {
    throw new Error('Pons V2 launch buyer wallet ids must be unique');
  }

  let state = input.initialState;
  let totalGrossInputWei = 0n;
  let totalTokensOutWei = 0n;
  const buys: PonsV2PlannedBuy[] = [];

  for (const [index, allocation] of orderedAllocations.entries()) {
    // Every solved input delivers at least its target and may overshoot by
    // rounding dust, so the graduating buy is sized to whatever the earlier
    // buys actually left rather than to its saved share.
    const isGraduatingBuy = input.exhaustCurve === true && index === orderedAllocations.length - 1;
    if (isGraduatingBuy && allocation.tokensOutWei < state.sellableTokensWei) {
      throw new Error('Pons V2 graduation bundle final allocation does not cover the curve');
    }
    const targetTokensOutWei = isGraduatingBuy ? state.sellableTokensWei : allocation.tokensOutWei;
    const quote = solvePonsV2GrossBuyForTokens(state, targetTokensOutWei);
    const minTokensOutWei =
      (targetTokensOutWei * BigInt(10_000 - input.slippageBps)) / BPS_DENOMINATOR;
    if (minTokensOutWei <= 0n) {
      throw new Error(`Pons V2 launch minimum output is zero for wallet ${allocation.walletId}`);
    }
    buys.push({
      ...quote,
      minTokensOutWei,
      role: allocation.role,
      targetTokensOutWei,
      walletId: allocation.walletId,
    });
    state = quote.nextState;
    totalGrossInputWei += quote.grossInputWei;
    totalTokensOutWei += quote.tokensOutWei;
  }

  if (input.exhaustCurve === true) {
    if (state.sellableTokensWei !== 0n) {
      throw new Error('Pons V2 graduation bundle must exhaust the sellable curve allocation');
    }
  } else if (state.sellableTokensWei === 0n) {
    throw new Error('Pons V2 plan exhausts the sellable curve supply');
  }

  return { buys, finalState: state, totalGrossInputWei, totalTokensOutWei };
}

/** One planned Graduation Bundle: exhausting curve buys, the pool, and pool buys. */
export interface PonsV2GraduationBundlePlan {
  curve: PonsV2LaunchPlan;
  /** Graduated pool per modelled currency ordering, before any pool buy. */
  poolStates: PonsV2GraduatedPoolState[];
  poolBuys: PonsV2PlannedPoolBuy[];
  /** Pool state per modelled ordering after every pool buy. */
  finalPoolStates: PonsV2GraduatedPoolState[];
  totalCurveInputWei: bigint;
  totalPoolInputWei: bigint;
}

/**
 * Plans a Graduation Bundle: ordered curve buys that exhaust the curve,
 * the deterministic graduated pool, and ordered post-graduation buys.
 *
 * Pass `tokenIsCurrency0` when the token address is known (a native launch
 * always has the token as currency1). Leave it undefined to plan the pool
 * phase conservatively across both orderings.
 *
 * @param input - Curve plan inputs, pool terms, post-graduation allocations.
 * @returns Curve plan, pool seed, and pool plan.
 * @throws {Error} If either phase is invalid or the curve is not exhausted.
 */
export function planPonsV2GraduationBundle(input: {
  initialState: PonsV2CurveState;
  devAllocation?: PonsV2LaunchAllocation;
  allocations: PonsV2LaunchAllocation[];
  poolAllocations: PonsV2PoolAllocation[];
  slippageBps: number;
  phantomQuoteWei: bigint;
  poolTerms: PonsV2GraduatedPoolTerms;
  tokenIsCurrency0?: boolean;
}): PonsV2GraduationBundlePlan {
  const curve = planPonsV2LaunchBuys({
    allocations: input.allocations,
    ...(input.devAllocation ? { devAllocation: input.devAllocation } : {}),
    exhaustCurve: true,
    initialState: input.initialState,
    slippageBps: input.slippageBps,
  });
  const orderings = input.tokenIsCurrency0 === undefined ? [false, true] : [input.tokenIsCurrency0];
  const poolStates = orderings.map((tokenIsCurrency0) =>
    buildPonsV2GraduatedPoolFromCurve({
      curveState: curve.finalState,
      phantomQuoteWei: input.phantomQuoteWei,
      terms: input.poolTerms,
      tokenIsCurrency0,
    }),
  );
  // The delegate seeds the pool only when it has post-graduation orders to
  // execute; an exhausting plan with none would land a swept, unseeded curve.
  if (input.poolAllocations.length === 0) {
    throw new Error('Pons V2 graduation bundle requires at least one post-graduation buy');
  }
  const curveWalletIds = new Set(curve.buys.map((buy) => buy.walletId));
  if (input.poolAllocations.some((allocation) => curveWalletIds.has(allocation.walletId))) {
    throw new Error('Pons V2 post-graduation wallets must be distinct from curve wallets');
  }
  const pool = planPonsV2PoolBuys({
    allocations: input.poolAllocations,
    poolStates,
    slippageBps: input.slippageBps,
  });
  return {
    curve,
    finalPoolStates: pool.finalStates,
    poolBuys: pool.buys,
    poolStates,
    totalCurveInputWei: curve.totalGrossInputWei,
    totalPoolInputWei: pool.totalQuoteInWei,
  };
}

/**
 * Returns the launch tokens the graduated pool will hold: the ceiling for
 * post-graduation buys and, with the sellable allocation, the ceiling for a
 * Graduation Bundle's total supply control.
 *
 * @param input - Launch supply and quote economics.
 * @returns Tokens seeded into the pool at graduation.
 */
export function calculatePonsV2GraduatedPoolInventory(input: {
  supplyWei: bigint;
  phantomQuoteWei: bigint;
  graduationThresholdWei: bigint;
}): bigint {
  const virtualQuote = input.phantomQuoteWei + input.graduationThresholdWei;
  const reserved = (input.supplyWei * input.phantomQuoteWei) / virtualQuote;
  return (reserved * input.graduationThresholdWei) / virtualQuote;
}

function amountOut(amountInWei: bigint, reserveInWei: bigint, reserveOutWei: bigint): bigint {
  const out = (amountInWei * reserveOutWei) / (reserveInWei + amountInWei);
  // `PonsV2BondingCurveMath.getAmountOut` reverts `InsufficientOutputAmount`
  // on a dust input; a quote that modelled it as a zero fill would not match.
  if (out === 0n) throw new Error('Pons V2 buy input is too small to return tokens');
  return out;
}

function amountIn(amountOutWei: bigint, reserveInWei: bigint, reserveOutWei: bigint): bigint {
  return (amountOutWei * reserveInWei) / (reserveOutWei - amountOutWei) + 1n;
}

function calculatePonsV2Fees(
  grossInputWei: bigint,
  curveFeeBps: number,
  creatorTaxBps: number,
  snipeTaxBps: number,
): { curveFeeWei: bigint; creatorTaxWei: bigint; snipeTaxWei: bigint; netInputWei: bigint } {
  const curveFeeWei = (grossInputWei * BigInt(curveFeeBps)) / BPS_DENOMINATOR;
  const creatorTaxWei = (grossInputWei * BigInt(creatorTaxBps)) / BPS_DENOMINATOR;
  const snipeTaxWei = (grossInputWei * BigInt(snipeTaxBps)) / BPS_DENOMINATOR;
  return {
    creatorTaxWei,
    curveFeeWei,
    netInputWei: grossInputWei - curveFeeWei - creatorTaxWei - snipeTaxWei,
    snipeTaxWei,
  };
}

function netSellQuoteOut(grossQuoteOutWei: bigint, state: PonsV2CurveState): bigint {
  const curveFeeWei = (grossQuoteOutWei * BigInt(state.curveFeeBps)) / BPS_DENOMINATOR;
  const creatorTaxWei = (grossQuoteOutWei * BigInt(state.creatorTaxBps)) / BPS_DENOMINATOR;
  return grossQuoteOutWei - curveFeeWei - creatorTaxWei;
}

function solveGrossInputForNet(
  netInputWei: bigint,
  curveFeeBps: number,
  creatorTaxBps: number,
  snipeTaxBps: number,
): bigint {
  const denominator = BPS_DENOMINATOR - BigInt(curveFeeBps + creatorTaxBps + snipeTaxBps);
  return (netInputWei * BPS_DENOMINATOR + denominator - 1n) / denominator;
}

function validateState(state: PonsV2CurveState): void {
  validatePricingState(state);
  if (state.sellableTokensWei === 0n) {
    throw new Error('Invalid Pons V2 curve state');
  }
}

function validatePricingState(state: PonsV2CurveState): void {
  validateBaseFees(state.curveFeeBps, state.creatorTaxBps);
  if (!Number.isInteger(state.snipeTaxBps ?? 0) || (state.snipeTaxBps ?? 0) < 0) {
    throw new Error('Invalid Pons V2 fee configuration');
  }
  if (
    state.quoteReserveWei <= 0n ||
    state.tokenReserveWei <= 0n ||
    state.sellableTokensWei < 0n ||
    state.sellableTokensWei > state.tokenReserveWei
  ) {
    throw new Error('Invalid Pons V2 curve state');
  }
}

function validateFeeBps(curveFeeBps: number, creatorTaxBps: number, snipeTaxBps = 0): void {
  validateBaseFees(curveFeeBps, creatorTaxBps);
  if (
    !Number.isInteger(snipeTaxBps) ||
    snipeTaxBps < 0 ||
    curveFeeBps + creatorTaxBps + snipeTaxBps >= 10_000
  ) {
    throw new Error('Invalid Pons V2 fee configuration');
  }
}

function validateBaseFees(curveFeeBps: number, creatorTaxBps: number): void {
  if (
    !Number.isInteger(curveFeeBps) ||
    !Number.isInteger(creatorTaxBps) ||
    curveFeeBps < 0 ||
    creatorTaxBps < 0 ||
    curveFeeBps + creatorTaxBps > 9_900
  ) {
    throw new Error('Invalid Pons V2 fee configuration');
  }
}
