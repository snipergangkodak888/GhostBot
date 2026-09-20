import { apportionHolderBuckets } from './destination-apportionment.ts';
import {
  buyPumpQuoteAmmExactIn,
  buyPumpQuoteExactIn,
  buyPumpQuoteExactOut,
  createPumpQuoteCurve,
  migratePumpQuoteCurve,
  type PumpfunCustomQuoteTerms,
  type PumpQuoteAmm,
  sizePumpQuoteBuy,
} from './pumpfun-quote-math.ts';

/** Saved controls needed to fund Pump launch buys and subsequent holder cleanup. */
export interface PumpFundingPlanSettings {
  mode: 'bundle' | 'bundle_snipe';
  targetSupplyPct: number;
  slippagePct: number;
  holderCount: number;
  holderNative: bigint;
  holderQuote: bigint;
  injectionNative: bigint;
  injectionQuote: bigint;
  jitoTip: bigint;
  /** Browser sizing caps editable targets; authoritative server plans remain strict. */
  capDisplayTargets?: boolean;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const supplyRaw = (pct: number) =>
  Number.isFinite(pct) && pct > 0 ? BigInt(Math.round(pct * 1_000_000)) * 10_000_000n : 0n;

/** One row's sized buy plus the balancing flags, or null for an injection row. */
type SizedPumpRow = {
  buy: { quoteAtomic: bigint; tokenOutRaw: bigint };
  lastBundle: boolean;
  lastSniper: boolean;
  requested: bigint;
} | null;

/**
 * Derives ordered custom-quote buy budgets and native reserves for both API and browser.
 * Uses the same curve progression, final-buyer balancing and holder buckets as launch construction.
 * @param terms - Verified quote registry and fee terms
 * @param settings - Saved launch controls, with amounts already in atomic units
 * @param rows - Ordered deployer, buyer, sniper and injection allocations
 * @returns Per-wallet buy, cleanup, LUT, tip and total funding amounts in atomic units
 * @throws Error when a target exceeds curve supply or the quote budget exceeds u64
 * @example derivePumpFundingPlan(terms, settings, [{ id: walletId, role: 'dev', supplyPct: 1 }]);
 */
export function derivePumpFundingPlan(
  terms: PumpfunCustomQuoteTerms,
  settings: PumpFundingPlanSettings,
  rows: readonly { id: string; role: string; supplyPct: number }[],
) {
  const curve = createPumpQuoteCurve(terms);
  const initialReal = curve.realTokenReserves;
  let amm: PumpQuoteAmm | undefined;
  const lastByRole = new Map(rows.map((row, index) => [row.role, index]));
  const targetSupply = supplyRaw(settings.targetSupplyPct);
  // Size every buy against the shared curve first: a balanced final row can come
  // out at zero, and a zero-buy row signs nothing in the bundle, so the sized
  // amounts - not the requested percentages - decide the tip and bucket owners.
  const sized: SizedPumpRow[] = rows.map((row, index) => {
    if (row.role === 'injection') return null;
    const requested = supplyRaw(row.supplyPct);
    const lastBundle = row.role === 'bundle' && index === lastByRole.get('bundle');
    const lastSniper =
      row.role === 'sniper' &&
      index === lastByRole.get('sniper') &&
      settings.mode === 'bundle_snipe';
    const target =
      settings.mode === 'bundle' && lastBundle
        ? max(0n, targetSupply - (initialReal - curve.realTokenReserves))
        : lastSniper
          ? max(
              0n,
              targetSupply -
                initialReal -
                (206_900_000_000_000n - (amm?.baseReserve ?? 206_900_000_000_000n)),
            )
          : requested;
    let effective =
      settings.mode === 'bundle_snipe' && lastBundle ? curve.realTokenReserves : target;
    if (settings.mode === 'bundle_snipe' && row.role === 'sniper')
      amm ??= migratePumpQuoteCurve(curve);
    if (settings.capDisplayTargets) {
      const maxBudget = (1n << 64n) - 1n;
      const available = amm
        ? buyPumpQuoteAmmExactIn({ ...amm }, maxBudget)
        : buyPumpQuoteExactIn({ ...curve }, maxBudget);
      effective = effective > available ? available : effective;
    }
    const buy =
      settings.mode === 'bundle_snipe' && row.role === 'sniper'
        ? sizePumpQuoteBuy(
            (amm ??= migratePumpQuoteCurve(curve)),
            effective,
            buyPumpQuoteAmmExactIn,
          )
        : settings.mode === 'bundle_snipe' && row.role !== 'dev'
          ? {
              quoteAtomic:
                (buyPumpQuoteExactOut(curve, effective) *
                  (10_000n + BigInt(Math.ceil(settings.slippagePct * 100))) +
                  9_999n) /
                  10_000n +
                1n,
              tokenOutRaw: effective,
            }
          : sizePumpQuoteBuy(curve, effective, buyPumpQuoteExactIn);
    return { buy, lastBundle, lastSniper, requested };
  });
  const firstSniper = rows.findIndex((row) => row.role === 'sniper');
  const tipIndex =
    settings.mode === 'bundle_snipe' && firstSniper >= 0
      ? firstSniper
      : resolveTipIndex(rows, sized, lastByRole);
  const buckets = buildHolderBuckets(settings, rows, sized);
  return rows.map((row, index) => {
    const entry = sized[index];
    if (!entry)
      return {
        id: row.id,
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
    const buy = entry.buy;
    const bucketCount = buckets.get(row.id) ?? 0n;
    const cleanupSource = buckets.has(row.id);
    const cleanupNative = cleanupSource ? 10_000_000n + settings.holderNative * bucketCount : 0n;
    const cleanupQuote = cleanupSource ? settings.holderQuote * bucketCount : 0n;
    const lutBudget = row.role === 'dev' ? 60_000_000n : 0n;
    const tip = index === tipIndex ? settings.jitoTip : 0n;
    const nativeReserve =
      (row.role === 'dev' ? 30_000_000n : 10_000_000n) + lutBudget + tip + cleanupNative;
    const supplyPct =
      (entry.lastBundle || entry.lastSniper) && buy.tokenOutRaw !== entry.requested
        ? Number((buy.tokenOutRaw * 100_000_000n + 500_000_000_000_000n) / 1_000_000_000_000_000n) /
          1_000_000
        : Math.max(0, row.supplyPct);
    return {
      id: row.id,
      ...buy,
      supplyPct,
      nativeReserve,
      totalQuote: buy.quoteAtomic + cleanupQuote,
      lutBudget,
      tip,
      cleanupNative,
      cleanupQuote,
    };
  });
}

/**
 * Picks the row that funds the Jito tip: the last buying dev/bundle/sniper row.
 *
 * A final row balanced to zero is dropped from the bundle, so the tip moves back
 * to the previous buying row. When nothing buys at all the deployer still signs
 * the create transaction and pays the tip there, so the tip falls back to it.
 *
 * @param rows - Ordered allocations
 * @param sized - Sized buys aligned with `rows`
 * @param lastByRole - Last index seen for each role
 * @returns Index of the tip-paying row, or -1 when there is none
 */
function resolveTipIndex(
  rows: readonly { role: string }[],
  sized: readonly SizedPumpRow[],
  lastByRole: ReadonlyMap<string, number>,
): number {
  let tipIndex = -1;
  rows.forEach((row, index) => {
    if (
      ['dev', 'bundle', 'sniper'].includes(row.role) &&
      (sized[index]?.buy.tokenOutRaw ?? 0n) > 0n
    )
      tipIndex = index;
  });
  return tipIndex >= 0 ? tipIndex : (lastByRole.get('dev') ?? -1);
}

/**
 * Spreads the holder-wallet buckets over the rows that end up holding tokens.
 *
 * A row whose sized buy is zero receives nothing: it has no tokens to
 * redistribute, so giving it buckets would strand that share of the holders.
 *
 * Buckets follow the same balance-proportional apportionment the post-launch
 * token cleanup uses (weighted by each row's sized token output), so the SOL and
 * quote reserved per source wallet match the holders it will actually feed.
 *
 * @param settings - Saved launch controls
 * @param rows - Ordered allocations
 * @param sized - Sized buys aligned with `rows`
 * @returns Bucket count per source wallet id
 */
function buildHolderBuckets(
  settings: PumpFundingPlanSettings,
  rows: readonly { id: string; role: string }[],
  sized: readonly SizedPumpRow[],
): Map<string, bigint> {
  const sourceRows = rows.flatMap((row, index) => {
    const tokenOutRaw = sized[index]?.buy.tokenOutRaw ?? 0n;
    const cleanupSource =
      row.role === 'bundle' || (settings.mode === 'bundle_snipe' && row.role === 'sniper');
    return tokenOutRaw > 0n && cleanupSource ? [{ id: row.id, weight: tokenOutRaw }] : [];
  });
  return apportionHolderBuckets(settings.holderCount, sourceRows);
}
