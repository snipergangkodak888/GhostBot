/** Maximum request length for snipe-burst app-unit price strings. */
export const SNIPE_BURST_PRICE_MAX_LENGTH = 64;

const FIXED_DECIMAL = /^\d+(?:\.\d+)?$/;
const SCIENTIFIC_DECIMAL = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

/**
 * Normalizes a positive decimal string to fixed-point notation.
 *
 * Scientific notation is expanded using the source digits without parsing
 * and re-rounding them. A finite-number check rejects values JavaScript cannot
 * safely use in the UI, while `maxLength` lets callers enforce an HTTP schema
 * bound before constructing a request.
 *
 * @param value - Positive fixed-point or scientific decimal string
 * @param maxLength - Optional maximum length of the normalized result
 * @returns Fixed-point decimal string, or null when invalid/out of bounds
 *
 * @example
 * normalizePositiveDecimalString('1.685857429e-9', 64);
 * // "0.000000001685857429"
 */
export function normalizePositiveDecimalString(
  value: string,
  maxLength = Number.POSITIVE_INFINITY,
): string | null {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  let normalized: string;
  if (FIXED_DECIMAL.test(trimmed)) {
    normalized = trimmed;
  } else {
    const match = SCIENTIFIC_DECIMAL.exec(trimmed);
    if (!match) {
      return null;
    }
    const whole = match[1] ?? '';
    const fraction = match[2] ?? '';
    const exponent = Number(match[3]);
    const digits = whole + fraction;
    const decimalIndex = whole.length + exponent;
    if (decimalIndex <= 0) {
      normalized = `0.${'0'.repeat(-decimalIndex)}${digits}`;
    } else if (decimalIndex >= digits.length) {
      normalized = digits + '0'.repeat(decimalIndex - digits.length);
    } else {
      normalized = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
    }
  }

  return normalized.length <= maxLength ? normalized : null;
}

/**
 * Serializes a positive finite number as a bounded fixed-point decimal.
 *
 * @param value - Positive finite number
 * @param maxLength - Optional maximum length of the fixed-point result
 * @returns Fixed-point decimal string, or null when invalid/out of bounds
 */
export function formatPositiveNumberAsPlainDecimal(
  value: number,
  maxLength = Number.POSITIVE_INFINITY,
): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return normalizePositiveDecimalString(value.toString(), maxLength);
}
