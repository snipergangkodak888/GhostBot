/**
 * Report-side native Four.meme curve adapter.
 * K/T are read from TokenManager2, and this integer formula is checked against
 * Helper3.tryBuy at every refresh. It does not change the supplied AMM package.
 */
export const FOUR_CURVE_SCALE = 10n ** 18n

export function fourCurveCost(k: bigint, virtualTokens: bigint, tokenAmount: bigint): bigint {
  if (k <= 0n || virtualTokens <= 0n || tokenAmount < 0n || tokenAmount >= virtualTokens) throw new Error('Invalid Four.meme native curve amount')
  // Preserve the contract's two separate division floors: algebraically combining
  // the fractions loses a wei on many inputs.
  return k * FOUR_CURVE_SCALE / (virtualTokens - tokenAmount) - k * FOUR_CURVE_SCALE / virtualTokens
}

export function fourProtocolFee(cost: bigint, feeBps: bigint, minimumFee: bigint): bigint {
  if (cost < 0n || feeBps < 0n || feeBps >= 10000n || minimumFee < 0n) throw new Error('Invalid Four.meme protocol fee')
  const proportional = cost * feeBps / 10000n
  return proportional > minimumFee ? proportional : minimumFee
}

export function fourCurveFdv(k: bigint, virtualTokens: bigint, supply: bigint): number {
  // Quote and base both have 18 decimals. Keep atomic rounding in the funding
  // calculation; FDV is a display-only real-valued marginal price.
  return Number(k) * Number(supply) / (Number(virtualTokens) ** 2)
}
