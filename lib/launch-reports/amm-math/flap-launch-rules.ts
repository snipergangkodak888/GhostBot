/**
 * Flap launch rules shared by the API planner, the connector solver and the
 * browser estimator: minimum-output tolerances, the planner's BNB headroom,
 * and the per-quote-class wallet budget of one atomic BSC bundle.
 *
 * Everything here is keyed on a quote class rather than a token so the
 * browser, which carries its own copy of the quote catalogue, applies the
 * same numbers the server signs.
 */

/** Minimum-output tolerance used by runtime planning and real-fork launch tests. */
export const FLAP_LAUNCH_MIN_OUTPUT_TOLERANCE_BPS = 50n;
/**
 * Minimum-output tolerance for launches quoted in a tokenized stock, ETF or
 * XAUT: the Portal's native-to-quote hop for those routes moves more between
 * the plan simulation and landing than the stablecoin and BTCB routes do.
 */
export const FLAP_LAUNCH_RWA_MIN_OUTPUT_TOLERANCE_BPS = 150n;

/**
 * Extra BNB the planner signs on the threshold-crossing buy of a Graduation
 * Bundle, in bps. The Portal fills exactly to the threshold and refunds the
 * rest, so the headroom only has to be held, not spent; the browser funds it
 * so the wallet passes the launch-time balance check.
 */
export const FLAP_PLANNER_CROSSING_HEADROOM_BPS = 200n;
/**
 * Extra BNB the planner signs on a buy priced through the Portal's
 * native-to-quote hop, in bps: the first guess approaches the target from
 * above and stays where the hop's price impact keeps it inside tolerance.
 */
export const FLAP_PLANNER_HOP_HEADROOM_BPS = 100n;

/** Share of supply the Flap curve sells before it migrates, in percent. */
export const FLAP_GRADUATION_CURVE_SUPPLY_PCT = 80;
/** Smallest share of supply any Flap launch wallet may hold, in percent. */
export const FLAP_MIN_WALLET_SUPPLY_PCT = 0.01;

/**
 * Wallets one atomic Flap bundle may carry (bundle plus Post-Graduation
 * Wallets) by quote class. BSC blocks admit 55M gas and a bundle lands in one
 * block, so the budget follows measured gas: a native curve buy uses about
 * 440k, a hop buy into a stablecoin or BTCB 600k to 650k, a hop buy into a
 * tokenized stock or XAUT 740k to 894k, the create 5.5M and the crossing buy
 * about 2M. The caps keep every class near 40M so the rest of the block stays
 * free; the builder's own 50-transaction cap bounds the native class.
 */
export const FLAP_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS = {
  native: 48,
  rwa: 30,
  stable: 40,
} as const;

/** Quote class a Flap launch's gas and tolerance rules key on. */
export type FlapQuoteClass = keyof typeof FLAP_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS;

/**
 * Wallets one atomic Flap bundle may carry for a quote class.
 *
 * @example
 * resolveFlapSharedWalletBudgetForClass('rwa'); // 30
 */
export function resolveFlapSharedWalletBudgetForClass(quoteClass: FlapQuoteClass): number {
  return FLAP_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS[quoteClass];
}

/** Minimum-output tolerance the planner applies for a quote class, in bps. */
export function resolveFlapMinOutputToleranceBpsForClass(quoteClass: FlapQuoteClass): bigint {
  return quoteClass === 'rwa'
    ? FLAP_LAUNCH_RWA_MIN_OUTPUT_TOLERANCE_BPS
    : FLAP_LAUNCH_MIN_OUTPUT_TOLERANCE_BPS;
}

/**
 * Smallest share of supply the crossing wallet of a Graduation Bundle may
 * hold, in percent. Every earlier curve leg may over-deliver by the tolerance
 * and each such token comes out of the crossing buy, so a crossing wallet at
 * tolerance times the curve share would carry a minimum of zero and the
 * market could migrate one leg early; the minimum-wallet margin on top keeps
 * the minimum positive at the floor itself.
 *
 * @example
 * resolveFlapCrossingMinSupplyPctForClass('native'); // 0.41
 */
export function resolveFlapCrossingMinSupplyPctForClass(quoteClass: FlapQuoteClass): number {
  const toleranceShare =
    (Number(resolveFlapMinOutputToleranceBpsForClass(quoteClass)) *
      FLAP_GRADUATION_CURVE_SUPPLY_PCT) /
    10_000;
  return Math.round((toleranceShare + FLAP_MIN_WALLET_SUPPLY_PCT) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Robinhood Chain: one EIP-7702 transaction instead of a builder bundle
// ---------------------------------------------------------------------------

/**
 * Effective per-transaction gas ceiling on Robinhood Chain (Arbitrum Nitro).
 * The block reports 2^50 but `eth_estimateGas` and `eth_simulateV1` saturate
 * just above 31M, and a 32M hint is the largest one the sequencer accepts.
 */
export const FLAP_ROBINHOOD_TX_GAS_LIMIT = 32_000_000n;

/**
 * Quote class a Robinhood Flap launch keys its rules on. Every buy is paid in
 * the quote itself (native ETH or an ERC-20 the wallet acquired through the
 * funding swap), so there is no hop route to distinguish; only the input kind
 * changes the gas of a buy.
 */
export type FlapRobinhoodQuoteClass = 'erc20' | 'native';

/** Launch modes a Robinhood Flap draft can take. */
export type FlapRobinhoodLaunchMode = 'bundle' | 'graduation_bundle';

/**
 * Wallets one Robinhood Flap transaction may carry (bundle plus
 * Post-Graduation Wallets, the create and dev buy excluded), by mode and
 * quote class.
 *
 * Derived from the delegate's Robinhood fork rehearsal (block 60,750,000):
 * the marginal cost of one delegated buyer is about 241k gas inside
 * `launchAndBuy` (native curve buy; an ERC-20 approve + swap is within a few
 * thousand of it) plus about 25k for its authorization tuple and calldata, so
 * 270k all-in; a pool buy is about 244k; a Tax V3 create 2.0M native / 2.3M
 * ERC-20; the crossing buy with its migration 3.06M, reserved at the 5.55M
 * historical worst case. The executor submits `estimateGas × 1.2` against
 * the 32M ceiling, so about 26.6M is usable. Budgets sit at roughly
 * two-thirds of what that arithmetic admits, leaving room for the L1 data
 * component Robinhood's `eth_estimateGas` folds into the figure and for
 * dividend-heavy Tax V3 creates: 56 native / 52 ERC-20 buyers in Bundle
 * mode (about 17M / 16M before the buffer) and 48 / 44 shared wallets in
 * Graduation Bundle mode (about 21M / 20M). Admission still rejects any plan
 * whose live estimate exceeds the ceiling.
 */
export const FLAP_ROBINHOOD_WALLET_BUDGET = {
  bundle: { erc20: 52, native: 56 },
  graduation_bundle: { erc20: 44, native: 48 },
} as const satisfies Record<FlapRobinhoodLaunchMode, Record<FlapRobinhoodQuoteClass, number>>;

/**
 * Largest share of supply one wallet may buy on the curve of a standard
 * (non-tax) Flap token, in percent: the Portal caps every `msg.sender` at
 * 200 bps of supply on those markets, the creator included, and clips any
 * larger buy to the cap. Tax V3 markets carry no cap. The cap is not
 * enforced after migration, so it binds dev and bundle allocations only.
 */
export const FLAP_STANDARD_MAX_WALLET_SUPPLY_PCT = 2;

/**
 * Wallets one Robinhood Flap transaction may carry for a mode and quote class.
 *
 * @example
 * resolveFlapRobinhoodWalletBudget('graduation_bundle', 'erc20'); // 44
 */
export function resolveFlapRobinhoodWalletBudget(
  mode: FlapRobinhoodLaunchMode,
  quoteClass: FlapRobinhoodQuoteClass,
): number {
  return FLAP_ROBINHOOD_WALLET_BUDGET[mode][quoteClass];
}

/**
 * Minimum-output tolerance for a Robinhood Flap launch, in bps. Inputs are
 * exact in the quote, so the only drift is an outside buy on the fresh curve
 * between admission and inclusion; the native tolerance covers every quote.
 */
export function resolveFlapRobinhoodMinOutputToleranceBps(): bigint {
  return FLAP_LAUNCH_MIN_OUTPUT_TOLERANCE_BPS;
}

/**
 * Smallest share of supply the crossing wallet of a Robinhood Graduation
 * Bundle may hold, in percent; the same derivation as the BSC native class.
 *
 * @example
 * resolveFlapRobinhoodCrossingMinSupplyPct(); // 0.41
 */
export function resolveFlapRobinhoodCrossingMinSupplyPct(): number {
  return resolveFlapCrossingMinSupplyPctForClass('native');
}
