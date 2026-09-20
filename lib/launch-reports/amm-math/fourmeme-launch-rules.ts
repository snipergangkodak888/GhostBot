/**
 * Four.meme launch rules shared by the API planner, the connector and the
 * browser estimator: minimum-output tolerances, the planner's BNB headroom on
 * Helper3 hop buys, and the per-quote-class wallet budget of one atomic BSC
 * bundle.
 *
 * Everything here is keyed on a quote class rather than a token so the
 * browser, which carries its own copy of the quote catalogue, applies the
 * same numbers the server signs.
 */

/** Minimum-output tolerance used by runtime planning and real-fork launch tests. */
export const FOURMEME_LAUNCH_MIN_OUTPUT_TOLERANCE_BPS = 50n;
/**
 * Minimum-output tolerance for launches quoted in a tokenized stock or ETF:
 * Helper3's BNB-to-quote hop for those routes crosses two PancakeSwap V3
 * pools (WBNB/USDT then USDT/quote) and moves more between the plan
 * simulation and landing than the single-hop stablecoin routes do.
 */
export const FOURMEME_LAUNCH_RWA_MIN_OUTPUT_TOLERANCE_BPS = 150n;

/**
 * Extra BNB the planner signs on a buy priced through Helper3's
 * `buyWithEth` hop, in bps: the first guess approaches the target from
 * above and stays where the hop's price impact keeps it inside tolerance.
 * Native BNB buys carry no headroom because they pay the curve directly.
 */
export const FOURMEME_PLANNER_HOP_HEADROOM_BPS = 100n;

/**
 * Wallets one atomic Four.meme bundle may carry by quote class. A bundle
 * lands in one BSC block, so the budget follows measured gas: a native
 * curve buy uses well under 300k, a Helper3 `buyWithEth` hop buy about
 * 1.03M at 0.5 BNB or less and about 1.23M at 2 BNB, and the create about
 * 1M. Stablecoin hops are the cheaper single-pool swaps and mostly small,
 * so 40 of them sit near 40M with the create; tokenized-stock hops route
 * through two pools and are larger, so 30 keeps that class near the same
 * ceiling. The native class is bounded by the builder's own transaction cap
 * rather than gas.
 */
export const FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS = {
  native: 48,
  rwa: 30,
  stable: 40,
} as const;

/** Quote class a Four.meme launch's gas and tolerance rules key on. */
export type FourMemeLaunchQuoteClass = keyof typeof FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS;

/**
 * Wallets one atomic Four.meme bundle may carry for a quote class.
 *
 * @param quoteClass - `native`, `stable` or `rwa`.
 * @returns The wallet budget.
 *
 * @example
 * resolveFourMemeSharedWalletBudgetForClass('rwa'); // 30
 */
export function resolveFourMemeSharedWalletBudgetForClass(
  quoteClass: FourMemeLaunchQuoteClass,
): number {
  return FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS[quoteClass];
}

/**
 * Minimum-output tolerance the planner applies for a quote class, in bps.
 *
 * @param quoteClass - `native`, `stable` or `rwa`.
 * @returns 150 for `rwa`, 50 otherwise.
 *
 * @example
 * resolveFourMemeMinOutputToleranceBpsForClass('stable'); // 50n
 */
export function resolveFourMemeMinOutputToleranceBpsForClass(
  quoteClass: FourMemeLaunchQuoteClass,
): bigint {
  return quoteClass === 'rwa'
    ? FOURMEME_LAUNCH_RWA_MIN_OUTPUT_TOLERANCE_BPS
    : FOURMEME_LAUNCH_MIN_OUTPUT_TOLERANCE_BPS;
}

/**
 * Extra BNB the planner signs on the curve-completing buy of a Graduation
 * Bundle, in bps. TokenManager2 fills a buy that exceeds the remaining offers
 * to the cap and refunds the excess in the same transaction (as BNB on the
 * native quote, as the ERC-20 quote through Helper3's `buyWithEth`), so the
 * headroom only has to be held, not spent; the browser funds it so the
 * wallet passes the launch-time balance check.
 */
export const FOURMEME_PLANNER_CROSSING_HEADROOM_BPS = 200n;

/**
 * Share of supply the Four.meme curve sells before it migrates, in percent:
 * every launch mints 1B tokens and offers 800M (`maxOffers`) on the curve; the
 * remaining 200M seed the PancakeSwap V2 pair at migration.
 */
export const FOURMEME_GRADUATION_CURVE_SUPPLY_PCT = 80;
/** Smallest share of supply any Four.meme launch wallet may hold, in percent. */
export const FOURMEME_MIN_WALLET_SUPPLY_PCT = 0.01;
/**
 * Largest total supply share a Graduation Bundle may target, in percent: the
 * 80% curve plus up to 19% bought back from the migrated pair. The pair seeds
 * 200M tokens (20%) and a constant-product pair can never release all of its
 * reserve, so 99% leaves the pool at least 1% of supply.
 */
export const FOURMEME_MAX_GRADUATION_BUNDLE_TARGET_PCT = 99;
/**
 * Share of the raised quote TokenManager2 keeps as its migration fee, in
 * bps; the remaining 98% seeds the PancakeSwap V2 pair together with the
 * 200M unsold tokens (BSC fork, 2026-09-09: `LiquidityAdded.funds` was
 * exactly 98% of the final curve `funds`).
 */
export const FOURMEME_MIGRATION_FEE_BPS = 200n;

/**
 * Smallest share of supply the crossing wallet of a Graduation Bundle may
 * hold, in percent. Every earlier curve leg may over-deliver by the tolerance
 * and each such token comes out of the crossing buy (it targets whatever
 * `offers` remain), so a crossing wallet at tolerance times the curve share
 * would carry a minimum of zero and the market could migrate one leg early;
 * the minimum-wallet margin on top keeps the minimum positive at the floor.
 *
 * @param quoteClass - `native`, `stable` or `rwa`.
 * @returns 0.41 for `native` and `stable`, 1.21 for `rwa`.
 *
 * @example
 * resolveFourMemeCrossingMinSupplyPctForClass('rwa'); // 1.21
 */
export function resolveFourMemeCrossingMinSupplyPctForClass(
  quoteClass: FourMemeLaunchQuoteClass,
): number {
  const toleranceShare =
    (Number(resolveFourMemeMinOutputToleranceBpsForClass(quoteClass)) *
      FOURMEME_GRADUATION_CURVE_SUPPLY_PCT) /
    10_000;
  return Math.round((toleranceShare + FOURMEME_MIN_WALLET_SUPPLY_PCT) * 10_000) / 10_000;
}

/**
 * Smallest total supply share a Graduation Bundle may target, in percent:
 * the whole 80% curve plus the minimum wallet share for every
 * Post-Graduation Wallet, since each of them must buy something from the
 * pair.
 *
 * @param poolWallets - Number of Post-Graduation Wallets.
 * @returns `80 + 0.01 × poolWallets`, rounded to four decimals.
 *
 * @example
 * resolveFourMemeMinGraduationTargetPct(3); // 80.03
 */
export function resolveFourMemeMinGraduationTargetPct(poolWallets: number): number {
  const wallets = Number.isFinite(poolWallets) && poolWallets > 0 ? Math.floor(poolWallets) : 0;
  return (
    Math.round(
      (FOURMEME_GRADUATION_CURVE_SUPPLY_PCT + FOURMEME_MIN_WALLET_SUPPLY_PCT * wallets) * 10_000,
    ) / 10_000
  );
}
