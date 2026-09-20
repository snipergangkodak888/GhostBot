/**
 * Deterministic AMM math helpers shared by browser and backend launch flows.
 *
 * Amounts are represented as atomic bigint values. These helpers intentionally
 * avoid floating point arithmetic so route planning and signed bundle
 * construction use the same rounding behavior.
 */

const BPS_DENOMINATOR = 10_000n;

export * from './destination-apportionment.ts';
export * from './flap-curve.ts';
export * from './flap-launch-rules.ts';
export * from './flap-graduated-pool.ts';
export * from './fourmeme-launch-rules.ts';
export * from './letscash-v4.ts';
export * from './lunch-fun.ts';
export * from './plain-decimal.ts';
export * from './pons-v2-curve.ts';
export * from './pons-v2-graduated-pool.ts';
export * from './pools-trade-instant.ts';
export * from './sushi-launch-quote.ts';
export * from './uniswap-v2.ts';
export * from './uniswap-v3.ts';
export * from './v2-graduated-pool.ts';

/**
 * Adds a basis-point buffer using integer floor rounding.
 *
 * This matches launch funding semantics where `value + floor(value * bps / 10_000)`
 * is the funded cap shared by browser previews and backend transaction builders.
 * Non-positive values, non-finite basis points, and non-positive buffers are
 * returned unchanged.
 *
 * @param value - Atomic input amount to buffer.
 * @param bps - Buffer in basis points; fractional values are rounded to an integer.
 * @returns Buffered atomic amount rounded down at the basis-point multiplication.
 *
 * @example
 * ```ts
 * applyBpsBuffer(101n, 100); // 102n
 * ```
 */
export function applyBpsBuffer(value: bigint, bps: number): bigint {
  if (value <= 0n || !Number.isFinite(bps) || bps <= 0) {
    return value;
  }
  return value + (value * BigInt(Math.round(bps))) / BPS_DENOMINATOR;
}

/**
 * Parses a decimal UI amount into an atomic raw amount.
 *
 * Extra fractional digits are truncated to the target precision, matching
 * common token amount input behavior.
 *
 * @param value - Decimal UI amount such as `"1.25"`.
 * @param decimals - Token decimals for the raw amount.
 * @returns Atomic amount as bigint, or `0n` for invalid/negative input.
 *
 * @example
 * ```ts
 * parseDecimalToRaw('1.5', 18); // 1500000000000000000n
 * ```
 */
export function parseDecimalToRaw(value: string | number | undefined, decimals: number): bigint {
  const normalized = String(value ?? '').trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Invalid decimals');
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d*)?$/.test(normalized)) {
    return 0n;
  }
  const [whole = '0', fraction = ''] = normalized.split('.');
  const scale = 10n ** BigInt(decimals);
  const fractionRaw = fraction.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(whole || '0') * scale + BigInt(fractionRaw || '0');
}

/**
 * Formats a raw bigint amount into a trimmed decimal UI amount.
 *
 * @param raw - Atomic raw amount.
 * @param decimals - Token decimals for `raw`.
 * @param maxFractionDigits - Optional maximum fractional display digits.
 * @returns Trimmed decimal string.
 */
export function formatRawToDecimal(
  raw: bigint,
  decimals: number,
  maxFractionDigits?: number,
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Invalid decimals');
  }
  const sign = raw < 0n ? '-' : '';
  const value = raw < 0n ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n || decimals === 0) {
    return `${sign}${whole}`;
  }
  const fractionText = fraction.toString().padStart(decimals, '0');
  const truncated =
    typeof maxFractionDigits === 'number'
      ? fractionText.slice(0, Math.max(0, Math.min(decimals, maxFractionDigits)))
      : fractionText;
  const trimmed = truncated.replace(/0+$/, '');
  return trimmed.length > 0 ? `${sign}${whole}.${trimmed}` : `${sign}${whole}`;
}

export * from './pumpfun-quote-math.ts';
export * from './token-2022-transfer-fee.ts';
export * from './launch-quote-funding.ts';

export * from './pumpfun-funding-plan.ts';
export * from './launchlab-quote-math.ts';
export * from './launchlab-funding-plan.ts';
export * from './stonkfun-launch-terms.ts';
