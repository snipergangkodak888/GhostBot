import { runInNewContext } from 'node:vm'
import { createDefaultRequest } from './launch-reports/catalog'
import { calculateLaunchReport } from './launch-reports/engine'
import { prepareLaunchReport } from './launch-reports/prepare'
import { launchReportCautions } from './launch-reports/client-summary'
import { launchVenue } from './launch-reports/venues'
import { applyLaunchTax, launchTaxLabel, launchTaxTargets, validateLaunchTax } from './launch-reports/tax'
import { formatAmount, parseAmount } from './launch-reports/utils'
import type { LaunchReport, LaunchReportRequest } from './launch-reports/types'

export type LaunchTargetMetric = 'supply' | 'market_cap'
export type LaunchQuoteInput = {
  venueId: string
  metric: LaunchTargetMetric
  target: number
  initialLp?: number
  mmLiquidity?: number
  taxPercent?: number
}
export type LaunchQuoteLine = { key: string; amount: string; raw: string; label: string }
export type LaunchQuote = {
  venue: NonNullable<ReturnType<typeof launchVenue>>
  metric: LaunchTargetMetric
  requestedTarget: number
  supplyControlPct: number
  launchMarketCapUsd: number
  initialLp?: number
  lines: LaunchQuoteLine[]
  capitalTotal: string
  capitalTotalRaw: string
  report: LaunchReport
  customMm: boolean
}

function validateInput(input: LaunchQuoteInput) {
  const venue = launchVenue(input.venueId)
  if (!venue) throw new Error('Choose a venue from the updated Launch Calc menu.')
  if (!['supply', 'market_cap'].includes(input.metric)) throw new Error('Choose supply control or launch market cap.')
  if (!Number.isFinite(input.target) || input.target <= 0) throw new Error('The target must be greater than zero.')
  if (input.metric === 'supply' && input.target >= 100) throw new Error('Supply control must be below 100%.')
  if (input.metric === 'supply' && Math.abs(input.target * 1e6 - Math.round(input.target * 1e6)) > 1e-6) throw new Error('Use at most 6 decimal places for supply control.')
  if (venue.requiresLiquidity && (!Number.isFinite(input.initialLp) || Number(input.initialLp) <= 0)) throw new Error('Initial LP must be greater than zero.')
  if (input.mmLiquidity != null && (!Number.isFinite(input.mmLiquidity) || input.mmLiquidity < 0)) throw new Error('MM liquidity must be a nonnegative amount.')
  if (input.taxPercent != null) validateLaunchTax(input.venueId, input.taxPercent)
  return venue
}

/** Each quote refreshes the exact same FX and protocol settings as Launch Math once. */
export async function prepareLaunchQuote(input: LaunchQuoteInput): Promise<LaunchQuote> {
  const venue = validateInput(input)
  const base = createDefaultRequest(venue.id)
  const request = input.taxPercent == null ? base : applyLaunchTax(base, input.taxPercent)
  if (venue.requiresLiquidity) request.liquidityAmounts = [plainAmount(input.initialLp!)]
  if (input.metric === 'supply') request.targetsPct = [input.target]
  const prepared = await prepareLaunchReport(request)
  return calculateLaunchQuote(input, prepared)
}

function plainAmount(value: number) {
  const plain = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 18 })
  if (Number(plain) !== value) throw new Error('Amount precision exceeds the supported currency units.')
  return plain
}

function requireQuote(report: LaunchReport) {
  const row = report.rows[0]
  if (row.status !== 'ok') throw new Error(row.error || 'This target cannot be quoted with the current launch settings.')
  if (row.fdvUsd == null || !Number.isFinite(row.fdvUsd) || row.fdvUsd <= 0) throw new Error('A valid current USD price is required to quote launch MC.')
  return report
}

// The supplied exact-integer solvers can take very long near exhausted pool
// ranges. Interrupt computation, including synchronous library calls, before a
// difficult target can stall the Telegram server. No user code is evaluated.
function boundedReport(request: LaunchReportRequest, deadline = Date.now() + 3000): LaunchReport {
  const timeout = Math.min(1500, deadline - Date.now())
  if (timeout < 1) throw new Error('This target is too close to the model’s limit. Try a lower supply-control or MC target.')
  try {
    return runInNewContext('calculate()', { calculate: () => calculateLaunchReport(request) }, { timeout })
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error('This target is too close to the model’s limit. Try a lower supply-control or MC target.')
    throw error
  }
}

/** Search on the engine's six-decimal supply grid using one frozen snapshot.
 * Unavailable boundaries are never returned as quotes. Migration price gaps fail
 * explicitly rather than labelling an unattainable MC as the requested target.
 */
function solveMarketCap(request: LaunchReportRequest, target: number): LaunchReport {
  const scale = 1_000_000, tolerance = Math.max(0.01, target * 0.000001), deadline = Date.now() + 3000
  const cache = new Map<number, LaunchReport>()
  const evaluate = (control: number) => {
    let report = cache.get(control)
    if (!report) {
      report = boundedReport({ ...request, targetsPct: [control / scale] }, deadline)
      cache.set(control, report)
    }
    return report
  }
  const valid = (report: LaunchReport) => report.rows[0].status === 'ok' && Number(report.rows[0].fdvUsd) > 0
  const mc = (report: LaunchReport) => report.rows[0].fdvUsd!
  const close = (report: LaunchReport) => Math.abs(mc(report) - target) <= tolerance
  const samples = launchTaxTargets(request, createDefaultRequest(request.modelId).targetsPct).map(pct => {
    const control = Math.round(pct * scale)
    return { control, report: evaluate(control) }
  }).filter(sample => valid(sample.report)).sort((a, b) => a.control - b.control)
  if (!samples.length) throw new Error('No scenarios are available for this tax and launch configuration.')
  for (const sample of samples) if (close(sample.report)) return sample.report
  // Extend only when necessary. Near-empty pools can be expensive to quote;
  // normal client targets never need a speculative purchase of almost 100%.
  if (target < mc(samples[0].report)) {
    let bound = Math.max(1, Math.ceil(request.operations.retainedPct * scale)), edge = samples[0].control
    while (edge > bound) {
      const control = Math.floor((bound + edge) / 2), report = evaluate(control)
      if (!valid(report)) { bound = control + 1; continue }
      if (close(report)) return report
      samples.unshift({ control, report }); edge = control
      if (mc(report) <= target) break
    }
    if (target < mc(samples[0].report) - tolerance) throw new Error(`This setup starts at approximately ${compactUsd(mc(samples[0].report))} MC. Choose a higher MC or a supply-control target.`)
  }
  if (target > mc(samples[samples.length - 1].report)) {
    let edge = samples[samples.length - 1].control, bound = 100 * scale - 1
    while (edge < bound) {
      const control = Math.ceil((edge + bound) / 2), report = evaluate(control)
      if (!valid(report)) { bound = control - 1; continue }
      if (close(report)) return report
      samples.push({ control, report }); edge = control
      if (mc(report) >= target) break
    }
    const maximum = mc(samples[samples.length - 1].report)
    if (target > maximum + tolerance) throw new Error(`This setup supports approximately ${compactUsd(maximum)} MC at its upper limit. Choose a lower MC or a supply-control target.`)
  }
  // Search brackets separately because migration can reset the price downwards.
  for (let i = 1; i < samples.length; i++) {
    let low = samples[i - 1].control, high = samples[i].control
    let a = samples[i - 1].report, b = samples[i].report
    if (mc(a) > target || mc(b) < target) continue
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2), report = requireQuote(evaluate(middle))
      if (close(report)) return report
      if (mc(report) < target) { low = middle; a = report } else { high = middle; b = report }
    }
    for (const report of [a, b]) if (close(report)) return report
  }
  throw new Error('That exact MC falls between supported modeled prices, which can happen at migration. Try a nearby MC or choose a supply-control target.')
}

/** Pure text projection of a shared report snapshot; no alternate venue formulas. */
export function calculateLaunchQuote(input: LaunchQuoteInput, prepared: LaunchReportRequest): LaunchQuote {
  const venue = validateInput(input)
  if (prepared.modelId !== venue.id || !prepared.injectionLiquidity) throw new Error('Refresh the venue settings before calculating a quote.')
  const request = input.taxPercent == null ? structuredClone(prepared) : applyLaunchTax(prepared, input.taxPercent)
  if (['stonkfun', 'launchlab'].includes(venue.id) && JSON.stringify(request.terms.transferFee) !== JSON.stringify(prepared.terms.transferFee)) throw new Error('Refresh Stonkfun settings after changing the holder tax.')
  request.liquidityAmounts = venue.requiresLiquidity ? [plainAmount(input.initialLp!)] : undefined
  const report = input.metric === 'supply'
    ? requireQuote(boundedReport({ ...request, targetsPct: [input.target] }))
    : solveMarketCap(request, input.target)
  const row = report.rows[0], raw = row.raw!, decimals = request.quote.decimals
  const wallet = request.fundingConversion?.nativeOperations || request.operations
  const lines: LaunchQuoteLine[] = []
  const add = (key: string, amount: bigint, label: string) => lines.push({ key, amount: formatAmount(amount, decimals), raw: amount.toString(), label })
  add('accumulation', BigInt(raw.funding) - BigInt(raw.initialLiquidity), 'for supply accumulation')
  if (BigInt(raw.initialLiquidity)) add('lp', BigInt(raw.initialLiquidity), 'for initial LP')
  add('aged', BigInt(raw.agedWallets), `for ${request.operations.agedWalletCount} aged wallets × ${wallet.agedWalletUnitAmount} ${wallet.currencySymbol}${request.fundingConversion ? ` (converted to ${request.quote.symbol})` : ''}`)
  const mm = input.mmLiquidity == null ? BigInt(raw.injectionLiquidity!) : parseAmount(plainAmount(input.mmLiquidity), decimals, 'MM liquidity')
  add('mm', mm, `designated for initial MM trading liquidity${input.mmLiquidity == null ? '' : ' (custom)'}`)
  const capitalTotalRaw = BigInt(raw.funding) + BigInt(raw.agedWallets) + mm
  return { venue, metric: input.metric, requestedTarget: input.target, supplyControlPct: row.actualPct!, launchMarketCapUsd: row.fdvUsd!,
    ...(venue.requiresLiquidity ? { initialLp: input.initialLp } : {}), lines, capitalTotal: formatAmount(capitalTotalRaw, decimals), capitalTotalRaw: capitalTotalRaw.toString(), report, customMm: input.mmLiquidity != null }
}

export function parseLaunchNumber(text: string) {
  const match = String(text || '').trim().toLowerCase().replace(/[$,%\s]/g, '').match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/)
  if (!match) return null
  const multipliers: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }
  const value = Number(match[1]) * (match[2] ? multipliers[match[2]] : 1)
  return Number.isFinite(value) ? value : null
}
function compactUsd(value: number) {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2).replace(/\.?0+$/, '')}K`
  return `$${value.toFixed(2).replace(/\.?0+$/, '')}`
}
function display(value: number | string, digits = 4) {
  return Number(value).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: digits })
}
export function formatLaunchQuote(quote: LaunchQuote) {
  const symbol = quote.venue.symbol, request = quote.report.request
  return [
    `<b>${quote.venue.name}</b>`,
    ...(launchTaxLabel(request) ? [launchTaxLabel(request)!] : []),
    ...(quote.initialLp ? [`Assuming a ${display(quote.initialLp)} ${symbol} initial LP:`] : []),
    `Capital requirement: <b>${display(quote.capitalTotal)} ${symbol} total</b> — targeting <b>${display(quote.supplyControlPct, 2)}% supply control</b> with an estimated <b>~${compactUsd(quote.launchMarketCapUsd)} launch MC</b>.`,
    '', 'Breakdown:',
    ...quote.lines.map(line => `• ~${display(line.amount)} ${symbol} ${line.label}`),
    '',
    request.operations.retainedPct ? `Control includes ${request.operations.retainedPct}% team allocation. MM is held separately.` : 'MM is held separately from launch purchases.',
    ...launchReportCautions(quote.report),
  ].join('\n')
}
