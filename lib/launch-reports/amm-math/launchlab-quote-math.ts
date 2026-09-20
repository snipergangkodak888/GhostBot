/**
 * Raydium LaunchLab constant-product curve math shared by the API and the browser.
 *
 * Mirrors the SDK's `Curve.buyExactIn` / `Curve.buyExactOut` for `ConstantCurve`
 * pools: fees are charged on the quote side at a 1e6-denominated rate, rounded
 * up, and only the fee-exclusive quote amount enters the curve reserves.
 *
 * A base mint with a Token-2022 transfer fee (StonkFun reward mode) taxes the
 * base leg of every swap: the curve pays out a gross amount, the buyer keeps
 * gross minus the withheld fee. `tokenOutRaw` is always what the wallet keeps;
 * `curveBaseOutRaw` is what left the curve and advances `realBase`.
 */

import {
  calculateTransferFee,
  grossForNetTransfer,
  parseToken2022TransferFee,
  type Token2022TransferFee,
  type Token2022TransferFeeTerms,
} from './token-2022-transfer-fee.ts';

/** Serializable LaunchLab curve terms in raw units (decimal strings over HTTP). */
export interface LaunchLabCurveTerms {
  /** Total base supply minted at creation. */
  supply: string;
  /** Base amount sold on the curve before migration. */
  totalSellA: string;
  /** Base amount locked for vesting (zero when unused). */
  totalLockedAmount: string;
  /** Quote amount raised at graduation, in the quote mint's atomic units. */
  totalFundRaisingB: string;
  /** Quote amount deducted at migration (from the global config). */
  migrateFee: string;
  /** Protocol trade fee rate from the global config, denominated in 1e6. */
  tradeFeeRate: string;
  /** Platform fee rate from the platform config, denominated in 1e6. */
  platformFeeRate: string;
  /** Creator fee rate from the platform config, denominated in 1e6. */
  creatorFeeRate: string;
  /** Token-2022 transfer fee on the base mint (reward mode); absent for an untaxed mint. */
  transferFee?: Token2022TransferFeeTerms;
}

/** Mutable curve state advanced by ordered launch buys. */
export interface LaunchLabCurve {
  virtualBase: bigint;
  virtualQuote: bigint;
  realBase: bigint;
  realQuote: bigint;
  totalSellA: bigint;
  /** Combined protocol + platform + creator fee rate, denominated in 1e6. */
  feeRate: bigint;
  /** Base-mint transfer fee withheld on every base transfer; undefined when untaxed. */
  transferFee?: Token2022TransferFee;
}

/** Result of one exact-input or exact-output buy against the curve. */
export interface LaunchLabBuyResult {
  /** Gross quote debited from the buyer, fees included. */
  quoteAtomic: bigint;
  /** Base tokens the buyer keeps, net of any transfer fee. */
  tokenOutRaw: bigint;
  /** Portion of `quoteAtomic` kept as protocol, platform and creator fees. */
  feeAtomic: bigint;
  /** Base tokens that left the curve (advances `realBase`); equals `tokenOutRaw` when untaxed. */
  curveBaseOutRaw: bigint;
  /** Base withheld by the transfer-fee extension on the way to the buyer. */
  transferFeeRaw: bigint;
}

const EMPTY_BUY: LaunchLabBuyResult = {
  quoteAtomic: 0n,
  tokenOutRaw: 0n,
  feeAtomic: 0n,
  curveBaseOutRaw: 0n,
  transferFeeRaw: 0n,
};

/** Fee and rate denominator used by LaunchLab's global and platform configs. */
export const LAUNCHLAB_FEE_RATE_DENOMINATOR = 1_000_000n;

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

/**
 * Derives the virtual reserves LaunchLab computes for a constant-product pool.
 *
 * Mirrors the SDK's `LaunchConstantProductCurve.getInitParam`.
 *
 * @param terms - Supply, sale allocation, lock, fund-raising target and migrate fee
 * @returns Virtual base/quote reserves
 * @throws Error when the terms cannot form a valid curve
 */
export function calculateLaunchLabInitParams(
  terms: Pick<
    LaunchLabCurveTerms,
    'supply' | 'totalSellA' | 'totalLockedAmount' | 'totalFundRaisingB' | 'migrateFee'
  >,
): { virtualBase: bigint; virtualQuote: bigint } {
  const supply = BigInt(terms.supply);
  const totalSell = BigInt(terms.totalSellA);
  const totalLocked = BigInt(terms.totalLockedAmount);
  const totalFundRaising = BigInt(terms.totalFundRaisingB);
  const migrateFee = BigInt(terms.migrateFee);
  if (supply <= totalSell) throw new Error('LaunchLab supply must exceed total sell');
  const supplyMinusSellLocked = supply - totalSell - totalLocked;
  if (supplyMinusSellLocked <= 0n) throw new Error('LaunchLab migration allocation is empty');
  const tfMinusMf = totalFundRaising - migrateFee;
  if (tfMinusMf <= 0n) throw new Error('LaunchLab fund raising must exceed the migrate fee');
  const numerator = (tfMinusMf * totalSell * totalSell) / supplyMinusSellLocked;
  const denominator = (tfMinusMf * totalSell) / supplyMinusSellLocked - totalFundRaising;
  if (denominator <= 0n) throw new Error('LaunchLab curve terms are invalid');
  const virtualBase = numerator / denominator;
  const virtualQuote = (totalFundRaising * totalFundRaising) / denominator;
  if (virtualBase < 0n || virtualQuote < 0n) throw new Error('LaunchLab curve terms are invalid');
  return { virtualBase, virtualQuote };
}

/**
 * Creates an untouched curve from verified terms.
 *
 * @param terms - Serializable curve and fee terms
 * @returns Mutable curve state with zero real reserves
 * @throws Error when fee rates or curve terms are invalid
 */
export function createLaunchLabCurve(terms: LaunchLabCurveTerms): LaunchLabCurve {
  const feeRate =
    BigInt(terms.tradeFeeRate) + BigInt(terms.platformFeeRate) + BigInt(terms.creatorFeeRate);
  if (feeRate < 0n || feeRate >= LAUNCHLAB_FEE_RATE_DENOMINATOR)
    throw new Error('Invalid LaunchLab fee rate');
  const { virtualBase, virtualQuote } = calculateLaunchLabInitParams(terms);
  const transferFee = parseToken2022TransferFee(terms.transferFee);
  return {
    virtualBase,
    virtualQuote,
    realBase: 0n,
    realQuote: 0n,
    totalSellA: BigInt(terms.totalSellA),
    feeRate,
    ...(transferFee ? { transferFee } : {}),
  };
}

/** Packages a curve payout as a buy result, splitting off the base transfer fee. */
function toBuyResult(
  curve: LaunchLabCurve,
  quoteAtomic: bigint,
  feeAtomic: bigint,
  curveBaseOutRaw: bigint,
): LaunchLabBuyResult {
  const transferFeeRaw = calculateTransferFee(curveBaseOutRaw, curve.transferFee);
  return {
    quoteAtomic,
    tokenOutRaw: curveBaseOutRaw - transferFeeRaw,
    feeAtomic,
    curveBaseOutRaw,
    transferFeeRaw,
  };
}

/**
 * Fee charged on a gross quote input, rounded up like the program.
 * @param amount - Gross quote amount
 * @param feeRate - Combined 1e6-denominated fee rate
 * @returns Fee in quote atomic units
 */
export function calculateLaunchLabFee(amount: bigint, feeRate: bigint): bigint {
  return feeRate <= 0n ? 0n : ceilDiv(amount * feeRate, LAUNCHLAB_FEE_RATE_DENOMINATOR);
}

/**
 * Gross quote required so that the fee-exclusive remainder equals `postFeeAmount`.
 * Mirrors the SDK's `Curve.calculatePreFee`.
 * @param postFeeAmount - Quote that must reach the curve
 * @param feeRate - Combined 1e6-denominated fee rate
 * @returns Gross quote including fees
 */
export function calculateLaunchLabPreFee(postFeeAmount: bigint, feeRate: bigint): bigint {
  if (feeRate <= 0n) return postFeeAmount;
  return ceilDiv(
    postFeeAmount * LAUNCHLAB_FEE_RATE_DENOMINATOR,
    LAUNCHLAB_FEE_RATE_DENOMINATOR - feeRate,
  );
}

/**
 * Quotes an exact-input buy without mutating the curve.
 *
 * Applies the program's remaining-supply cap: when the input would buy more base
 * than is left on the curve, the buyer pays only the gross cost of the remainder.
 *
 * @param curve - Current curve state
 * @param quoteIn - Gross quote budget
 * @returns Gross debit, base received and fee share
 */
export function buyLaunchLabExactIn(curve: LaunchLabCurve, quoteIn: bigint): LaunchLabBuyResult {
  if (quoteIn <= 0n) return { ...EMPTY_BUY };
  const fee = calculateLaunchLabFee(quoteIn, curve.feeRate);
  const amountLessFee = quoteIn - fee;
  const inputReserve = curve.virtualQuote + curve.realQuote;
  const outputReserve = curve.virtualBase - curve.realBase;
  if (outputReserve <= 0n || inputReserve + amountLessFee <= 0n) return { ...EMPTY_BUY };
  const rawOut = (amountLessFee * outputReserve) / (inputReserve + amountLessFee);
  const remaining = curve.totalSellA - curve.realBase;
  // The program caps the payout at the remaining sale and charges only for
  // it; the cap is a gross figure, so it is priced with the gross solver.
  if (rawOut > remaining) return buyLaunchLabForCurveOut(curve, remaining);
  return toBuyResult(curve, quoteIn, fee, rawOut);
}

/**
 * Quotes the gross quote needed to receive exactly `tokenOut` base tokens.
 *
 * @param curve - Current curve state
 * @param tokenOut - Base tokens wanted; capped at the remaining curve supply
 * @returns Gross debit (fee included), base received and fee share
 */
export function buyLaunchLabExactOut(curve: LaunchLabCurve, tokenOut: bigint): LaunchLabBuyResult {
  if (tokenOut <= 0n) return { ...EMPTY_BUY };
  // `tokenOut` is what the buyer must keep; the curve has to pay out the gross
  // amount the transfer fee is taken from, exactly as `buy_exact_out` adds the
  // inverse fee on top of the requested amount.
  const remaining = curve.totalSellA - curve.realBase;
  const gross = grossForNetTransfer(tokenOut, curve.transferFee);
  return buyLaunchLabForCurveOut(curve, gross > remaining ? remaining : gross);
}

/** Prices a gross curve payout (before any transfer fee), capped at the remaining sale. */
function buyLaunchLabForCurveOut(curve: LaunchLabCurve, curveOut: bigint): LaunchLabBuyResult {
  const remaining = curve.totalSellA - curve.realBase;
  const out = curveOut > remaining ? remaining : curveOut;
  if (out <= 0n) return { ...EMPTY_BUY };
  const inputReserve = curve.virtualQuote + curve.realQuote;
  const outputReserve = curve.virtualBase - curve.realBase;
  if (outputReserve <= out) throw new Error('LaunchLab buy exceeds curve reserves');
  const amountLessFee = ceilDiv(inputReserve * out, outputReserve - out);
  const gross = calculateLaunchLabPreFee(amountLessFee, curve.feeRate);
  return toBuyResult(curve, gross, gross - amountLessFee, out);
}

/**
 * Advances the curve by a completed buy, crediting only the fee-exclusive quote.
 *
 * @param curve - Curve state to mutate
 * @param buy - Result of `buyLaunchLabExactIn` / `buyLaunchLabExactOut`
 * @returns The same curve for chaining
 * @throws Error when the buy would overdraw the curve or a u64 field
 */
export function applyLaunchLabBuy(curve: LaunchLabCurve, buy: LaunchLabBuyResult): LaunchLabCurve {
  const maxU64 = (1n << 64n) - 1n;
  // The vault pays out the gross amount; the withheld fee never returns to the curve.
  const nextBase = curve.realBase + buy.curveBaseOutRaw;
  const nextQuote = curve.realQuote + (buy.quoteAtomic - buy.feeAtomic);
  if (nextBase > curve.totalSellA || nextQuote > maxU64 || buy.quoteAtomic > maxU64)
    throw new Error('LaunchLab buy exceeds curve supply or u64 range');
  curve.realBase = nextBase;
  curve.realQuote = nextQuote;
  return curve;
}

/**
 * Sizes a buy for a base target and verifies the gross input reproduces it.
 *
 * The exact-output solve gives the minimum gross input; the exact-input replay
 * reports what the program will actually deliver for that input, which can
 * exceed the target by rounding. `target` and the returned `tokenOutRaw` are
 * net of any transfer fee, since that is what the wallet ends up holding.
 *
 * @param curve - Current curve state (not mutated)
 * @param target - Base tokens the wallet must keep
 * @returns Gross input and the base the program delivers for it
 */
export function sizeLaunchLabBuy(curve: LaunchLabCurve, target: bigint): LaunchLabBuyResult {
  const sized = buyLaunchLabExactOut(curve, target);
  if (sized.quoteAtomic === 0n) return sized;
  const replay = buyLaunchLabExactIn(curve, sized.quoteAtomic);
  if (replay.tokenOutRaw < sized.tokenOutRaw)
    throw new Error('LaunchLab exact-in replay undershoots the sized target');
  return replay;
}

/**
 * Spot price of one whole base token in whole quote units, for display.
 * @param curve - Curve state
 * @param baseDecimals - Base mint decimals
 * @param quoteDecimals - Quote mint decimals
 * @returns Quote per base, or null when the curve is degenerate
 */
export function launchLabSpotPrice(
  curve: LaunchLabCurve,
  baseDecimals: number,
  quoteDecimals: number,
): number | null {
  const base = curve.virtualBase - curve.realBase;
  const quote = curve.virtualQuote + curve.realQuote;
  if (base <= 0n || quote <= 0n) return null;
  return (Number(quote) / Number(base)) * 10 ** (baseDecimals - quoteDecimals);
}
