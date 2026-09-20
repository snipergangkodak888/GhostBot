export function ceilDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new Error('Cannot divide negative amounts or a zero denominator')
  return (n + d - 1n) / d
}

export function parseAmount(value: unknown, decimals: number, label = 'Amount'): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error(`${label}: invalid decimals`)
  const text = String(value ?? '').trim()
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text) || text.length > 120) throw new Error(`${label} must be a nonnegative plain decimal`)
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error(`${label} has more than ${decimals} decimal places`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
}

export function formatAmount(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const fraction = (raw % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${raw / unit}${fraction ? `.${fraction}` : ''}`
}

export function splitRaw(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Buyer count must be between 1 and 500')
  if (total < 0n) throw new Error('Purchase target must not be negative')
  return Array.from({ length: count }, (_, i) => total / BigInt(count) + (BigInt(i) < total % BigInt(count) ? 1n : 0n))
}

export const sumRaw = (items: bigint[]): bigint => items.reduce((sum, item) => sum + item, 0n)

export function termBigInt(terms: Record<string, unknown>, key: string, fallback?: bigint): bigint {
  const value = terms[key]
  if (value === undefined && fallback !== undefined) return fallback
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || String(value).length > 120) throw new Error(`${key} must be a nonnegative atomic integer string`)
  return BigInt(String(value))
}

export function termNumber(terms: Record<string, unknown>, key: string, fallback?: number): number {
  const value = terms[key] === undefined ? fallback : Number(terms[key])
  if (value === undefined || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`)
  return value
}

export function integerTerm(terms: Record<string, unknown>, key: string, fallback?: number, max = 1_000_000): number {
  const value = termNumber(terms, key, fallback)
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${key} must be an integer between 0 and ${max}`)
  return value
}

export function percentRaw(supply: bigint, percent: number): bigint {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Supply percentage must be between 0 and 100')
  return supply * BigInt(Math.round(percent * 1_000_000)) / 100_000_000n
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry)) as T
}
