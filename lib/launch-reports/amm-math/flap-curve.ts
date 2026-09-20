/** Flap token total supply in raw 18-decimal units. */
export const FLAP_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const WAD = 10n ** 18n;
const BPS = 10_000n;

/**
 * Current native-BNB curve profile used for pre-draft Flap estimates.
 *
 * Launch execution must still read the newly created token's immutable values
 * through `getTokenV9Safe`; Portal governance can change the profile applied to
 * future tokens. The BNB fork pins these values so drift fails visibly.
 */
export const FLAP_BSC_ESTIMATE_CURVE_PROFILE = Object.freeze({
  bondingCurveFeeBps: 125n,
  circulatingSupply: 0n,
  dexSupplyThreshold: 800_000_000n * WAD,
  h: 107_036_752n * WAD,
  k: 6_797_205_657_280_000_000_000_000_000n,
  protocolBuyFeeBps: 100n,
  r: 6_140_000_000_000_000_000n,
  reserve: 0n,
  reserveDecimals: 18,
});

export interface FlapCurveState {
  circulatingSupply: bigint;
  dexSupplyThreshold: bigint;
  h: bigint;
  k: bigint;
  r: bigint;
  reserve: bigint;
  reserveDecimals: number;
  /**
   * Tokens one buy may still deliver under the Portal's per-origin holding
   * cap: the market's full `maxBuyPerOrigin` for a wallet-agnostic snapshot,
   * or the wallet's remaining `buyQuotaOf` for a plan-time snapshot fetched
   * for a specific trader. Absent means the market has no cap; zero means the
   * cap exists and nothing is left, so a buy quotes as insufficient. The cap
   * bounds a fill exactly like the DEX threshold: the Portal fills to it and
   * refunds the rest of the input.
   */
  maxBuyAmount?: bigint;
}

export interface FlapExactInResult {
  fee: bigint;
  inAmount: bigint;
  outAmount: bigint;
  postReserve: bigint;
  postSupply: bigint;
}

/** Divides `x * 1e18` by `y`, rounding upward like Solady `divWadUp`. */
export function flapDivWadUp(x: bigint, y: bigint): bigint {
  if (y <= 0n) throw new Error('Flap curve division denominator must be positive');
  const numerator = x * WAD;
  return numerator === 0n ? 0n : (numerator - 1n) / y + 1n;
}

/** Estimates circulating supply for a raw quote-token reserve. */
export function estimateFlapSupply(state: FlapCurveState, reserve: bigint): bigint {
  const scaledReserve = scaleReserveToWad(reserve, state.reserveDecimals);
  const virtualTokenReserve = flapDivWadUp(state.k, state.r + scaledReserve);
  const maximum = FLAP_TOTAL_SUPPLY + state.h;
  return maximum > virtualTokenReserve ? maximum - virtualTokenReserve : 0n;
}

/** Estimates the raw quote-token reserve for a circulating supply. */
export function estimateFlapReserve(state: FlapCurveState, supply: bigint): bigint {
  if (supply > FLAP_TOTAL_SUPPLY) throw new Error('Flap supply exceeds total supply');
  const scaled = flapDivWadUp(state.k, FLAP_TOTAL_SUPPLY + state.h - supply);
  const reserveWad = scaled > state.r ? scaled - state.r : 0n;
  return scaleReserveFromWadUp(reserveWad, state.reserveDecimals);
}

/** Highest circulating supply one buy may reach: the DEX threshold or the origin cap. */
export function flapBuySupplyCap(state: FlapCurveState): bigint {
  const cap = state.maxBuyAmount;
  if (cap !== undefined && state.circulatingSupply + cap < state.dexSupplyThreshold) {
    return state.circulatingSupply + cap;
  }
  return state.dexSupplyThreshold;
}

/**
 * Quotes a gross exact-input Flap curve buy. A buy that would carry the supply
 * past the DEX threshold or the per-origin holding cap is a partial fill: the
 * output stops at the cap and only the input that reaches it is consumed.
 */
export function quoteFlapBuyExactIn(
  state: FlapCurveState,
  grossInput: bigint,
  effectiveFeeBps: bigint,
): FlapExactInResult {
  if (grossInput <= 0n) return emptyResult(grossInput, state);
  let consumedInput = grossInput;
  let fee = calculateFee(consumedInput, effectiveFeeBps);
  const curveInput = grossInput > fee ? grossInput - fee : 0n;
  let postReserve = state.reserve + curveInput;
  let postSupply = estimateFlapSupply(state, postReserve);
  const supplyCap = flapBuySupplyCap(state);
  if (postSupply > supplyCap) {
    postSupply = supplyCap;
    postReserve = estimateFlapReserve(state, postSupply);
    const consumedCurveInput = postReserve > state.reserve ? postReserve - state.reserve : 0n;
    consumedInput = grossInputForCurveInput(consumedCurveInput, effectiveFeeBps);
    fee = calculateFee(consumedInput, effectiveFeeBps);
  }
  const outAmount =
    postSupply > state.circulatingSupply ? postSupply - state.circulatingSupply : 0n;
  return { fee, inAmount: consumedInput, outAmount, postReserve, postSupply };
}

/** Quotes a gross exact-input Flap curve sell. */
export function quoteFlapSellExactIn(
  state: FlapCurveState,
  tokenInput: bigint,
  effectiveFeeBps: bigint,
): FlapExactInResult {
  if (tokenInput <= 0n) return emptyResult(tokenInput, state);
  const postSupply =
    tokenInput < state.circulatingSupply ? state.circulatingSupply - tokenInput : 0n;
  const postReserve = estimateFlapReserve(state, postSupply);
  const grossOutput = state.reserve > postReserve ? state.reserve - postReserve : 0n;
  const fee = calculateFee(grossOutput, effectiveFeeBps);
  const outAmount = grossOutput > fee ? grossOutput - fee : 0n;
  return { fee, inAmount: tokenInput, outAmount, postReserve, postSupply };
}

/** Finds the smallest exact input whose output reaches a requested target. */
export function invertFlapExactIn(
  targetOutput: bigint,
  maximumInput: bigint,
  quote: (input: bigint) => FlapExactInResult,
): FlapExactInResult | null {
  if (targetOutput <= 0n) return quote(0n);
  if (maximumInput <= 0n || quote(maximumInput).outAmount < targetOutput) return null;

  let low = 1n;
  let high = 1n;
  while (high < maximumInput && quote(high).outAmount < targetOutput) {
    high = high > maximumInput / 2n ? maximumInput : high * 2n;
  }
  while (low < high) {
    const mid = (low + high) / 2n;
    if (quote(mid).outAmount >= targetOutput) high = mid;
    else low = mid + 1n;
  }
  return quote(low);
}

/** Returns the WAD-normalized marginal quote price at a supply point. */
export function calculateFlapPriceWad(state: FlapCurveState, supply: bigint): bigint {
  const denominator = FLAP_TOTAL_SUPPLY + state.h - supply;
  if (denominator <= 0n) return 0n;
  const denominatorSquaredWad = (denominator * denominator) / WAD;
  return denominatorSquaredWad > 0n ? (state.k * WAD) / denominatorSquaredWad : 0n;
}

function calculateFee(amount: bigint, feeBps: bigint): bigint {
  if (amount <= 0n || feeBps <= 0n) return 0n;
  return (amount * feeBps) / BPS;
}

function grossInputForCurveInput(curveInput: bigint, feeBps: bigint): bigint {
  if (curveInput <= 0n) return 0n;
  if (feeBps <= 0n) return curveInput;
  if (feeBps >= BPS) return 0n;

  const denominator = BPS - feeBps;
  let grossInput = (curveInput * BPS + denominator - 1n) / denominator;
  while (grossInput - calculateFee(grossInput, feeBps) < curveInput) grossInput += 1n;
  return grossInput;
}

function scaleReserveToWad(reserve: bigint, decimals: number): bigint {
  if (decimals < 0 || decimals > 18)
    throw new Error('Flap quote decimals must be between 0 and 18');
  return reserve * 10n ** BigInt(18 - decimals);
}

function scaleReserveFromWadUp(reserve: bigint, decimals: number): bigint {
  if (decimals < 0 || decimals > 18)
    throw new Error('Flap quote decimals must be between 0 and 18');
  const scale = 10n ** BigInt(18 - decimals);
  return reserve === 0n ? 0n : (reserve - 1n) / scale + 1n;
}

function emptyResult(input: bigint, state: FlapCurveState): FlapExactInResult {
  return {
    fee: 0n,
    inAmount: input,
    outAmount: 0n,
    postReserve: state.reserve,
    postSupply: state.circulatingSupply,
  };
}
