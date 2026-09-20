import { apportionHolderBuckets } from './destination-apportionment.ts';
import {
  applyLaunchLabBuy,
  buyLaunchLabExactIn,
  createLaunchLabCurve,
  type LaunchLabCurveTerms,
  sizeLaunchLabBuy,
} from './launchlab-quote-math.ts';
import { grossForNetTransfer, netOfTransferFee } from './token-2022-transfer-fee.ts';

/** Saved controls needed to fund LaunchLab launch buys and subsequent holder cleanup. */
export interface LaunchLabFundingPlanSettings {
  targetSupplyPct: number;
  holderCount: number;
  holderNative: bigint;
  holderQuote: bigint;
  injectionNative: bigint;
  injectionQuote: bigint;
  jitoTip: bigint;
  /** Browser sizing caps editable targets; authoritative server plans remain strict. */
  capDisplayTargets?: boolean;
}

/** One wallet's LaunchLab launch budget in quote atomic units and lamports. */
export interface LaunchLabFundingPlanRow {
  id: string;
  role: string;
  /** Gross curve buy (fees included) in quote atomic units. */
  quoteAtomic: bigint;
  tokenOutRaw: bigint;
  /** Effective supply share after last-buyer balancing. */
  supplyPct: number;
  /** Lamports kept for rent, fees, LUT, tip and native cleanup. */
  nativeReserve: bigint;
  /** Curve buy plus quote-side cleanup budget. */
  totalQuote: bigint;
  lutBudget: bigint;
  tip: bigint;
  cleanupNative: bigint;
  cleanupQuote: bigint;
}

/** Deployer reserve covering the Token-2022 mint, pool rent and create fees. */
export const LAUNCHLAB_DEPLOYER_RESERVE_LAMPORTS = 30_000_000n;
/** Buyer reserve covering two ATAs, priority fees and signature fees. */
export const LAUNCHLAB_BUYER_RESERVE_LAMPORTS = 10_000_000n;
/** Lookup-table budget charged once to the deployer. */
export const LAUNCHLAB_LUT_BUDGET_LAMPORTS = 60_000_000n;
/** Native allowance for a wallet that later redistributes to holder buckets. */
export const LAUNCHLAB_CLEANUP_BASE_LAMPORTS = 10_000_000n;

const max = (a: bigint, b: bigint) => (a > b ? a : b);

/**
 * Converts a supply percentage into raw base units of the given supply.
 * @param pct - Percentage of total supply (0-100)
 * @param supply - Total base supply in raw units
 * @returns Raw base amount, rounded to a millionth of a percent
 */
export function launchLabSupplyRaw(pct: number, supply: bigint): bigint {
  if (!Number.isFinite(pct) || pct <= 0) return 0n;
  return (supply * BigInt(Math.round(pct * 1_000_000))) / 100_000_000n;
}

/**
 * Derives ordered LaunchLab buy budgets and native reserves for both API and browser.
 *
 * Buys are replayed on one curve in row order (deployer first). The last bundle
 * row is balanced so the launch reaches `targetSupplyPct`; holder buckets and
 * injection allowances are budgeted exactly like the Pump custom plan.
 *
 * @param terms - Verified curve and fee terms
 * @param settings - Saved launch controls with amounts already in atomic units
 * @param rows - Ordered deployer, buyer and injection allocations
 * @returns Per-wallet buy, cleanup, LUT, tip and total funding amounts
 * @throws Error when a target exceeds curve supply or the quote budget exceeds u64
 * @example deriveLaunchLabFundingPlan(terms, settings, [{ id, role: 'dev', supplyPct: 1 }]);
 */
export function deriveLaunchLabFundingPlan(
  terms: LaunchLabCurveTerms,
  settings: LaunchLabFundingPlanSettings,
  rows: readonly { id: string; role: string; supplyPct: number }[],
): LaunchLabFundingPlanRow[] {
  const curve = createLaunchLabCurve(terms);
  const supply = BigInt(terms.supply);
  const lastByRole = new Map(rows.map((row, index) => [row.role, index]));
  const targetSupply = launchLabSupplyRaw(settings.targetSupplyPct, supply);
  // Size every buy against the shared curve first. The last bundle row is
  // balanced down to the target and can come out at zero, and a zero-buy row
  // signs nothing in the bundle, so the sized amounts - not the requested
  // percentages - decide who carries the tip and the holder buckets.
  // Targets are what wallets end up holding, so the balance is tracked net of
  // any transfer fee rather than from `realBase`, which counts the gross payout.
  let heldSupply = 0n;
  const sized = rows.map((row, index) => {
    if (row.role === 'injection') return null;
    const lastBundle = row.role === 'bundle' && index === lastByRole.get('bundle');
    const requested = launchLabSupplyRaw(row.supplyPct, supply);
    const buy = executeRowBuy({
      curve,
      role: row.role,
      target: lastBundle ? max(0n, targetSupply - heldSupply) : requested,
      cap: settings.capDisplayTargets === true,
    });
    heldSupply += buy.tokenOutRaw;
    return { buy, lastBundle, requested };
  });
  const tipIndex = resolveTipIndex(rows, sized, lastByRole);
  const buckets = buildHolderBuckets(settings.holderCount, rows, sized);
  return rows.map((row, index) => {
    const entry = sized[index];
    if (!entry) return injectionRow(row, settings);
    return budgetRow({
      row,
      buy: entry.buy,
      bucketCount: buckets.get(row.id),
      lutBudget: row.role === 'dev' ? LAUNCHLAB_LUT_BUDGET_LAMPORTS : 0n,
      tip: index === tipIndex ? settings.jitoTip : 0n,
      settings,
      supplyPct: effectiveSupplyPct(
        row.supplyPct,
        entry.requested,
        entry.buy.tokenOutRaw,
        supply,
        entry.lastBundle,
      ),
    });
  });
}

/** One row's sized buy, or null for an injection row that never buys. */
type SizedRow = {
  buy: { quoteAtomic: bigint; tokenOutRaw: bigint };
  lastBundle: boolean;
  requested: bigint;
} | null;

/**
 * Picks the row that funds the Jito tip: the last dev/bundle row that actually buys.
 *
 * A last bundle row balanced to zero is dropped from the bundle, so the tip has
 * to move back to the previous buying row. When nothing buys at all (a dev-only
 * launch with no dev buy) the deployer signs the create transaction and pays the
 * tip there, so the tip falls back to the dev row.
 *
 * @param rows - Ordered allocations
 * @param sized - Sized buys aligned with `rows`
 * @param lastByRole - Last index seen for each role
 * @returns Index of the tip-paying row, or -1 when there is none
 */
function resolveTipIndex(
  rows: readonly { role: string }[],
  sized: readonly SizedRow[],
  lastByRole: ReadonlyMap<string, number>,
): number {
  let tipIndex = -1;
  rows.forEach((row, index) => {
    if ((row.role === 'dev' || row.role === 'bundle') && (sized[index]?.buy.tokenOutRaw ?? 0n) > 0n)
      tipIndex = index;
  });
  return tipIndex >= 0 ? tipIndex : (lastByRole.get('dev') ?? -1);
}

function effectiveSupplyPct(
  requestedPct: number,
  requestedRaw: bigint,
  boughtRaw: bigint,
  supply: bigint,
  balanced: boolean,
): number {
  if (balanced && boughtRaw !== requestedRaw)
    return Number((boughtRaw * 100_000_000n + supply / 2n) / supply) / 1_000_000;
  return Math.max(0, requestedPct);
}

/** Sizes one dev/bundle buy against the shared curve and advances it. */
function executeRowBuy(input: {
  curve: ReturnType<typeof createLaunchLabCurve>;
  role: string;
  target: bigint;
  cap: boolean;
}): { quoteAtomic: bigint; tokenOutRaw: bigint } {
  if (input.role !== 'dev' && input.role !== 'bundle') return { quoteAtomic: 0n, tokenOutRaw: 0n };
  const remaining = input.curve.totalSellA - input.curve.realBase;
  // The sale cap is a gross figure; a net target needs the inverse fee on top.
  const grossTarget = grossForNetTransfer(input.target, input.curve.transferFee);
  const target =
    input.cap && grossTarget > remaining
      ? netOfTransferFee(remaining, input.curve.transferFee)
      : input.target;
  if (grossForNetTransfer(target, input.curve.transferFee) > remaining)
    throw new Error('LaunchLab launch target exceeds the curve supply');
  const buy = sizeLaunchLabBuy(input.curve, target);
  // The curve moves by what left the vault, even when the tax ate the whole payout.
  if (buy.curveBaseOutRaw > 0n) applyLaunchLabBuy(input.curve, buy);
  return buy;
}

/**
 * Spreads the holder-wallet buckets over the bundle rows that hold tokens.
 *
 * A bundle row whose sized buy is zero receives nothing: it has no tokens to
 * redistribute, so giving it buckets would strand that share of the holders.
 *
 * Buckets follow the same balance-proportional apportionment the post-launch
 * token cleanup uses (weighted by each row's sized token output), so the SOL and
 * quote reserved per source wallet match the holders it will actually feed.
 *
 * @param holderCount - Holder wallets to fill after the launch
 * @param rows - Ordered allocations
 * @param sized - Sized buys aligned with `rows`
 * @returns Bucket count per source wallet id
 */
function buildHolderBuckets(
  holderCount: number,
  rows: readonly { id: string; role: string; supplyPct: number }[],
  sized: readonly SizedRow[],
): Map<string, bigint> {
  const sourceRows = rows.flatMap((row, index) => {
    const tokenOutRaw = sized[index]?.buy.tokenOutRaw ?? 0n;
    return row.role === 'bundle' && tokenOutRaw > 0n ? [{ id: row.id, weight: tokenOutRaw }] : [];
  });
  return apportionHolderBuckets(holderCount, sourceRows);
}

function injectionRow(
  row: { id: string; role: string },
  settings: LaunchLabFundingPlanSettings,
): LaunchLabFundingPlanRow {
  return {
    id: row.id,
    role: row.role,
    quoteAtomic: 0n,
    tokenOutRaw: 0n,
    supplyPct: 0,
    nativeReserve: settings.injectionNative,
    totalQuote: settings.injectionQuote,
    lutBudget: 0n,
    tip: 0n,
    cleanupNative: 0n,
    cleanupQuote: 0n,
  };
}

function budgetRow(input: {
  row: { id: string; role: string };
  buy: { quoteAtomic: bigint; tokenOutRaw: bigint };
  bucketCount: bigint | undefined;
  lutBudget: bigint;
  tip: bigint;
  settings: LaunchLabFundingPlanSettings;
  supplyPct: number;
}): LaunchLabFundingPlanRow {
  const buckets = input.bucketCount;
  const cleanupNative =
    buckets === undefined
      ? 0n
      : LAUNCHLAB_CLEANUP_BASE_LAMPORTS + input.settings.holderNative * buckets;
  const cleanupQuote = buckets === undefined ? 0n : input.settings.holderQuote * buckets;
  const baseReserve =
    input.row.role === 'dev'
      ? LAUNCHLAB_DEPLOYER_RESERVE_LAMPORTS
      : LAUNCHLAB_BUYER_RESERVE_LAMPORTS;
  return {
    id: input.row.id,
    role: input.row.role,
    quoteAtomic: input.buy.quoteAtomic,
    tokenOutRaw: input.buy.tokenOutRaw,
    supplyPct: input.supplyPct,
    nativeReserve: baseReserve + input.lutBudget + input.tip + cleanupNative,
    totalQuote: input.buy.quoteAtomic + cleanupQuote,
    lutBudget: input.lutBudget,
    tip: input.tip,
    cleanupNative,
    cleanupQuote,
  };
}

/**
 * Largest base amount the curve can still sell for display capping.
 * @param terms - Verified curve terms
 * @param rowsBefore - Buys already replayed, in order
 * @returns Remaining sellable base after the given buys
 */
export function launchLabRemainingSupply(
  terms: LaunchLabCurveTerms,
  rowsBefore: readonly { quoteAtomic: bigint }[],
): bigint {
  const curve = createLaunchLabCurve(terms);
  for (const row of rowsBefore) {
    const buy = buyLaunchLabExactIn(curve, row.quoteAtomic);
    if (buy.curveBaseOutRaw > 0n) applyLaunchLabBuy(curve, buy);
  }
  return curve.totalSellA - curve.realBase;
}
