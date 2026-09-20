/**
 * Smallest creator fee override `create_v2` accepts for a custom-quote curve.
 * Zero is not an override: it leaves the curve on the global fee schedule.
 */
export const PUMPFUN_MIN_CREATOR_FEE_OVERRIDE_BPS = 1;

/**
 * Creator fee cap observed in the Pump global account (100 bps = 1%) when the
 * override was verified. The program reads the live value, so callers validate
 * against the on-chain maximum and use this only as the display/fallback bound.
 */
export const PUMPFUN_DEFAULT_MAX_CREATOR_FEE_OVERRIDE_BPS = 100;

/** Creator fee a migrated custom-quote PumpSwap pool charges without an override. */
export const PUMPSWAP_CUSTOM_QUOTE_DEFAULT_CREATOR_FEE_BPS = 5;

/**
 * Serializable launch terms resolved from current Pump registry, mint and fee accounts.
 *
 * `creatorFeeBps` is the global schedule's creator fee at resolution time.
 * `creatorFeeOverrideBps` is the per-launch value written into `create_v2`;
 * when present it replaces the global creator fee on the curve and is inherited
 * by the migrated PumpSwap pool. Use {@link resolvePumpCreatorFeeBps} for the
 * effective curve fee rather than reading either field directly.
 */
export interface PumpfunCustomQuoteTerms {
  mint: string;
  tokenProgramId: string;
  decimals: number;
  symbol: string;
  initialVirtualQuoteReserves: string;
  registry: string;
  protocolFeeBps: number;
  creatorFeeBps: number;
  creatorFeeOverrideBps?: number;
  /**
   * Picker metadata read from Jupiter's token list when the terms were
   * resolved. Absent on drafts saved before it existed; never used to build
   * or verify a transaction.
   */
  display?: PumpfunQuoteDisplay;
}

/**
 * Display facts about a registered Pump quote mint, sourced from Jupiter Tokens V2.
 *
 * The Pump registry only carries mints and reserves, and SPL mints have no
 * on-chain symbol, so without this a quote shows as a bare address. Jupiter's
 * tags (`rwa`, `stocks`, `xstocks`, `verified`, ...) drive the picker's
 * grouping; `verified` is tri-state because a mint Jupiter never listed, or a
 * Jupiter outage, is "unchecked", not "unverified".
 *
 * @property name - Jupiter's token name, or null when Jupiter does not list the mint
 * @property logoUrl - Jupiter's icon URL, or null when absent
 * @property tags - Jupiter tags, lower-cased; empty when Jupiter gave none
 * @property verified - Jupiter's verdict, or null when Jupiter had no opinion
 */
export interface PumpfunQuoteDisplay {
  name: string | null;
  logoUrl: string | null;
  tags: string[];
  verified: boolean | null;
}

/** Synthetic reserves shared by server construction and browser funding previews. */
export interface PumpQuoteCurve {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  protocolFeeBps: number;
  /** Effective curve creator fee: the launch override when set, else the global schedule. */
  creatorFeeBps: number;
  /** Launch override carried forward so migration can apply it to the pool. */
  creatorFeeOverrideBps?: number;
}

/** Effective quote reserve (including the separately recorded virtual portion) after migration. */
export interface PumpQuoteAmm {
  baseReserve: bigint;
  quoteReserve: bigint;
  virtualQuoteReserves: bigint;
  /** Pool creator fee: the inherited launch override, else the deployed 5-bps default. */
  creatorFeeBps: number;
}

const BPS = 10_000n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Creates independent initial reserves from verified terms.
 * @param terms - Authoritative registry reserves and fee basis points
 * @returns Mutable curve state in raw token units
 * @throws Error when reserves or fees are invalid
 */
export function createPumpQuoteCurve(terms: PumpfunCustomQuoteTerms): PumpQuoteCurve {
  const initial = BigInt(terms.initialVirtualQuoteReserves);
  const creatorFeeBps = resolvePumpCreatorFeeBps(terms);
  if (
    initial <= 0n ||
    !Number.isInteger(terms.protocolFeeBps) ||
    !Number.isInteger(terms.creatorFeeBps) ||
    terms.protocolFeeBps < 0 ||
    terms.creatorFeeBps < 0 ||
    (terms.creatorFeeOverrideBps !== undefined &&
      (!Number.isInteger(terms.creatorFeeOverrideBps) ||
        terms.creatorFeeOverrideBps < PUMPFUN_MIN_CREATOR_FEE_OVERRIDE_BPS)) ||
    terms.protocolFeeBps + creatorFeeBps >= 10_000
  )
    throw new Error('Invalid Pump quote launch terms');
  return {
    virtualTokenReserves: 1_073_000_000_000_000n,
    virtualQuoteReserves: initial,
    realTokenReserves: 793_100_000_000_000n,
    realQuoteReserves: 0n,
    protocolFeeBps: terms.protocolFeeBps,
    creatorFeeBps,
    ...(terms.creatorFeeOverrideBps !== undefined
      ? { creatorFeeOverrideBps: terms.creatorFeeOverrideBps }
      : {}),
  };
}

/**
 * Resolves the creator fee the bonding curve will charge for these terms.
 * @param terms - Resolved quote terms, optionally carrying a launch override
 * @returns Override basis points when set, otherwise the global schedule value
 * @example resolvePumpCreatorFeeBps({ ...terms, creatorFeeOverrideBps: 50 }); // 50
 */
export function resolvePumpCreatorFeeBps(
  terms: Pick<PumpfunCustomQuoteTerms, 'creatorFeeBps' | 'creatorFeeOverrideBps'>,
): number {
  return terms.creatorFeeOverrideBps ?? terms.creatorFeeBps;
}

/**
 * Calculates gross payment with independently rounded protocol/creator fees.
 * @param delta - Positive raw quote amount entering the reserve
 * @param state - Verified protocol and creator fee basis points
 * @returns Total quote debit including both fees
 */
export function pumpQuoteGross(
  delta: bigint,
  state: Pick<PumpQuoteCurve, 'protocolFeeBps' | 'creatorFeeBps'>,
): bigint {
  return (
    delta +
    ceil(delta * BigInt(state.protocolFeeBps), BPS) +
    ceil(delta * BigInt(state.creatorFeeBps), BPS)
  );
}

/**
 * Applies an exact-token-output buy to the supplied curve.
 * @param state - Mutable curve reserves, advanced in place
 * @param amount - Requested raw token output, capped at remaining supply
 * @returns Actual raw quote debit before caller slippage
 */
export function buyPumpQuoteExactOut(state: PumpQuoteCurve, amount: bigint): bigint {
  const tokens = min(amount, state.realTokenReserves);
  if (tokens <= 0n) return 0n;
  const delta = ceil(state.virtualQuoteReserves * tokens, state.virtualTokenReserves - tokens);
  state.virtualTokenReserves -= tokens;
  state.realTokenReserves -= tokens;
  state.virtualQuoteReserves += delta;
  state.realQuoteReserves += delta;
  return pumpQuoteGross(delta, state);
}

/**
 * Applies an exact-quote-input buy using the deployed one-atom output margin.
 * @param state - Mutable curve reserves, advanced in place
 * @param budget - Maximum raw quote debit including fees
 * @returns Raw token output
 */
export function buyPumpQuoteExactIn(state: PumpQuoteCurve, budget: bigint): bigint {
  if (budget <= 1n || state.realTokenReserves === 0n) return 0n;
  let delta = (budget * BPS) / (BPS + BigInt(state.protocolFeeBps + state.creatorFeeBps));
  while (delta > 0n && pumpQuoteGross(delta, state) > budget) delta--;
  while (pumpQuoteGross(delta + 1n, state) <= budget) delta++;
  if (delta <= 1n) return 0n;
  const tokens = min(
    ((delta - 1n) * state.virtualTokenReserves) / (state.virtualQuoteReserves + delta - 1n),
    state.realTokenReserves,
  );
  if (tokens === state.realTokenReserves) {
    buyPumpQuoteExactOut(state, tokens);
    return tokens;
  }
  state.virtualTokenReserves -= tokens;
  state.realTokenReserves -= tokens;
  state.virtualQuoteReserves += delta;
  state.realQuoteReserves += delta;
  return tokens;
}

/**
 * Creates a custom AMM from a completed curve.
 * @param state - Fully drained curve, left unchanged
 * @returns Effective AMM reserves including the virtual quote portion
 * @throws Error when the curve still has saleable tokens
 */
export function migratePumpQuoteCurve(state: PumpQuoteCurve): PumpQuoteAmm {
  if (state.realTokenReserves !== 0n) throw new Error('Pump curve is not complete');
  return {
    baseReserve: 206_900_000_000_000n,
    quoteReserve: state.realQuoteReserves,
    virtualQuoteReserves: (state.realQuoteReserves * 2069n) / BPS,
    creatorFeeBps: state.creatorFeeOverrideBps ?? PUMPSWAP_CUSTOM_QUOTE_DEFAULT_CREATOR_FEE_BPS,
  };
}

/**
 * Applies a custom canonical AMM buy with the deployed 20-bps LP and 5-bps
 * protocol fees plus the pool's creator fee (5 bps, or the inherited override).
 * @param state - Mutable effective AMM reserves, advanced in place
 * @param budget - Maximum raw quote debit including fees
 * @returns Actual raw token output
 */
export function buyPumpQuoteAmmExactIn(state: PumpQuoteAmm, budget: bigint): bigint {
  if (budget <= 0n) return 0n;
  const creatorFee = BigInt(state.creatorFeeBps);
  const cost = (delta: bigint) =>
    delta + ceil(delta * 20n, BPS) + ceil(delta * 5n, BPS) + ceil(delta * creatorFee, BPS);
  let delta = (budget * BPS) / (BPS + 25n + creatorFee);
  const excess = cost(delta) - budget;
  if (excess > 0n) delta -= excess;
  if (delta <= 1n) return 0n;
  const tokens = ((delta - 1n) * state.baseReserve) / (state.quoteReserve + delta - 1n);
  state.baseReserve -= tokens;
  state.quoteReserve += delta + ceil(delta * 20n, BPS);
  return tokens;
}

/**
 * Finds the smallest exact-input budget reaching a token target.
 * @param state - Mutable reserves, advanced once after sizing succeeds
 * @param target - Desired raw token output
 * @param buy - Deterministic exact-input function that mutates its state argument
 * @returns Minimum quote budget and resulting raw token output
 * @throws Error when the target exceeds supply or the budget exceeds u64
 * @example sizePumpQuoteBuy(curve, 1_000_000n, buyPumpQuoteExactIn)
 */
export function sizePumpQuoteBuy<T extends PumpQuoteCurve | PumpQuoteAmm>(
  state: T,
  target: bigint,
  buy: (state: T, budget: bigint) => bigint,
): { quoteAtomic: bigint; tokenOutRaw: bigint } {
  if (target <= 0n) return { quoteAtomic: 0n, tokenOutRaw: 0n };
  const available = 'realTokenReserves' in state ? state.realTokenReserves : state.baseReserve - 1n;
  if (target > available) throw new Error('Pump quote target exceeds remaining supply');
  let low = 0n,
    high = 1n;
  const max = (1n << 64n) - 1n;
  while (buy({ ...state }, high) < target) {
    if (high === max) throw new Error('Pump quote budget exceeds u64');
    high = min(high * 2n, max);
  }
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (buy({ ...state }, middle) >= target) high = middle;
    else low = middle;
  }
  return { quoteAtomic: high, tokenOutRaw: buy(state, high) };
}
