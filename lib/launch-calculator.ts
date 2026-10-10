import { fundStockReport, stockSwapQuote } from './launch-reports/stock-funding'
import { applyStockFunding } from './launch-reports/stock-funding-math'
import { nativeDecimals } from './launch-reports/funding'
import { runInNewContext } from 'node:vm'
import { createDefaultRequest } from './launch-reports/catalog'
import { calculateLaunchReport } from './launch-reports/engine'
import { prepareLaunchReport } from './launch-reports/prepare'
import { launchReportCautions } from './launch-reports/client-summary'
import { launchVenue } from './launch-reports/venues'
import { applyLaunchTax, launchTaxLabel, launchTaxTargets, validateLaunchTax } from './launch-reports/tax'
import { ceilDiv, formatAmount, parseAmount } from './launch-reports/utils'
import { applyAgedWalletCount, validateAgedWalletCount } from './launch-reports/pricing'
import type { LaunchReport, LaunchReportRequest } from './launch-reports/types'

export type LaunchTargetMetric = 'supply' | 'market_cap' | 'budget'
export type LaunchQuoteInput = {
  venueId: string
  stockQuoteId?: string
  metric: LaunchTargetMetric
  target: number
  initialLp?: number
  mmLiquidity?: number
  taxPercent?: number
  agedWalletCount?: number
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
  budget?: { usd: number; currencyRaw: string; unusedRaw: string; unusedUsd: number }
}

function validateInput(input: LaunchQuoteInput) {
  const venue = launchVenue(input.venueId)
  if (!venue) throw new Error('Choose a venue from the updated Launch Calc menu.')
  if (!['supply', 'market_cap', 'budget'].includes(input.metric)) throw new Error('Choose supply control, launch market cap or total budget.')
  if (!Number.isFinite(input.target) || input.target <= 0) throw new Error('The target must be greater than zero.')
  if (input.metric === 'supply' && input.target >= 100) throw new Error('Supply control must be below 100%.')
  if (input.metric === 'supply' && Math.abs(input.target * 1e6 - Math.round(input.target * 1e6)) > 1e-6) throw new Error('Use at most 6 decimal places for supply control.')
  if (venue.requiresLiquidity && (!Number.isFinite(input.initialLp) || Number(input.initialLp) <= 0)) throw new Error('Initial LP must be greater than zero.')
  if (input.mmLiquidity != null && (!Number.isFinite(input.mmLiquidity) || input.mmLiquidity < 0)) throw new Error('MM liquidity must be a nonnegative amount.')
  if (input.taxPercent != null) validateLaunchTax(input.venueId, input.taxPercent, input.stockQuoteId)
  if (input.agedWalletCount != null) validateAgedWalletCount(input.agedWalletCount)
  return venue
}

/** Each quote refreshes the exact same FX and protocol settings as Launch Math once. */
export async function prepareLaunchQuote(input: LaunchQuoteInput): Promise<LaunchQuote> {
  const venue = validateInput(input)
  const base = createDefaultRequest(venue.id)
  if (input.stockQuoteId) base.stockQuoteId = input.stockQuoteId
  let request = input.taxPercent == null ? base : applyLaunchTax(base, input.taxPercent)
  if (input.agedWalletCount != null) request = applyAgedWalletCount(request, input.agedWalletCount)
  if (venue.requiresLiquidity) request.liquidityAmounts = [plainAmount(input.initialLp!)]
  if (input.metric === 'supply') request.targetsPct = [input.target]
  const prepared = await prepareLaunchReport(request)
  if (input.metric === 'budget' && input.stockQuoteId) return calculateStockBudgetQuote(input, prepared)
  const quote = calculateLaunchQuote(input, prepared)
  return input.stockQuoteId ? projectLaunchQuote(input, await fundStockReport(quote.report)) : quote
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

/** USD is the budget input, while the existing breakdown keeps its funding currency.
 * Floor the conversion so the plan can never consume more than the USD ceiling. */
function budgetFunds(input: LaunchQuoteInput, request: LaunchReportRequest) {
  const stock = !!request.stockQuoteId
  const decimals = stock ? nativeDecimals(request.fundingConversion!.nativeOperations.currencySymbol) : request.quote.decimals
  const price = stock ? request.fundingConversion?.nativeUsdPrice : request.quote.usdPrice
  const fx = parseAmount(price, 30, 'Budget exchange rate')
  if (fx <= 0n) throw new Error('A current exchange rate is required for the total budget.')
  const raw = parseAmount(plainAmount(input.target), 30, 'USD budget') * 10n ** BigInt(decimals) / fx
  return { raw, decimals, usdPrice: Number(price) }
}

function quoteTotal(input: LaunchQuoteInput, report: LaunchReport): bigint {
  const raw = report.rows[0].raw!
  const decimals = report.fundingCurrency?.decimals ?? report.request.quote.decimals
  return BigInt(raw.funding) + BigInt(raw.agedWallets) + (input.mmLiquidity == null ? BigInt(raw.injectionLiquidity!) : parseAmount(plainAmount(input.mmLiquidity), decimals, 'MM liquidity'))
}

/** Search the same six-decimal supply grid as MC targeting. Every comparison
 * includes operations, wallets, initial LP and the MM reserve at the resulting MC.
 * Separate curve/pool brackets account for a reserve falling at migration. */
function solveBudget(input: LaunchQuoteInput, request: LaunchReportRequest, project: (report: LaunchReport) => LaunchReport = r => r, maxControl = 99_999_999): LaunchReport {
  const scale = 1_000_000, deadline = Date.now() + 4000, funds = budgetFunds(input, request)
  const minimum = Math.max(1, Math.ceil(request.operations.retainedPct * scale))
  const cache = new Map<number, LaunchReport>()
  const evaluate = (control: number) => {
    if (!cache.has(control)) {
      const report = boundedReport({ ...request, stockFundingQuotes: undefined, targetsPct: [control / scale] }, deadline)
      cache.set(control, report.rows[0].status === 'ok' ? project(report) : report)
    }
    return cache.get(control)!
  }
  const valid = (r: LaunchReport) => r.rows[0].status === 'ok' && Number(r.rows[0].fdvUsd) > 0
  const fits = (r: LaunchReport) => valid(r) && quoteTotal(input, r) <= funds.raw
  let best: LaunchReport | undefined
  const keep = (r: LaunchReport) => { if (fits(r) && (!best || r.rows[0].targetPct > best.rows[0].targetPct)) best = r }
  const points = new Set([minimum, ...launchTaxTargets(request, createDefaultRequest(request.modelId).targetsPct).map(p => Math.round(p * scale))])
  // Probe immediately on each side of migrations, where MC/MM may reset.
  let migration: number | undefined
  if (request.modelId.startsWith('pumpfun')) migration = 79.31
  if (request.modelId === 'pons') {
    const phantom = BigInt(String(request.terms.phantomQuoteWei)), raised = BigInt(String(request.terms.graduationThresholdWei))
    migration = Number(raised * 100_000_000n / (phantom + raised)) / scale
    const reservedFraction = Number(phantom * 1_000_000_000n / (phantom + raised)) / 1_000_000_000
    maxControl = Math.min(maxControl, Math.floor((1 - reservedFraction ** 2) * 100 * scale) - 1)
  }
  if (migration) for (const delta of [-1, 1]) points.add(Math.floor(migration * scale) + delta)
  const samples = [...points].filter(p => p >= minimum && p <= maxControl).sort((a, b) => a - b)
  const first = evaluate(minimum)
  keep(first)
  // Walk coarse samples first; low budgets do not require speculative near-empty pools.
  for (let i = 1; i < samples.length; i++) {
    const low = samples[i - 1], high = samples[i], a = evaluate(low), b = evaluate(high)
    keep(b)
    if (!fits(a) || fits(b)) continue
    let left = low, right = high
    while (right - left > 1) {
      const middle = Math.floor((left + right) / 2), r = evaluate(middle)
      if (fits(r)) { left = middle; keep(r) } else right = middle
    }
  }
  let left = samples.at(-1) ?? minimum, right = maxControl + 1
  if (fits(evaluate(left))) while (right - left > 1) {
    const middle = Math.floor((left + right) / 2), r = evaluate(middle)
    if (fits(r)) { left = middle; keep(r) } else right = middle
  }
  if (!best) {
    const minimumUsd = valid(first) ? Number(formatAmount(quoteTotal(input, first), funds.decimals)) * funds.usdPrice : null
    throw new Error(minimumUsd == null ? 'No supply purchase fits this budget and launch configuration.' : `This budget is too low. Approximately ${compactUsd(minimumUsd)} is needed for aged wallets, MM, launch costs${input.initialLp ? ' and initial LP' : ''} before supply accumulation. Increase the budget or reduce the wallet count or MM reserve.`)
  }
  return requireQuote(best)
}

/** Stock sizing uses an indicative rate only to find a candidate. Only an actual,
 * funded route below the budget can be returned. No estimated route is delivered. */
export async function calculateStockBudgetQuote(input: LaunchQuoteInput, prepared: LaunchReportRequest): Promise<LaunchQuote> {
  if (input.metric !== 'budget' || !input.stockQuoteId) throw new Error('Choose a stock-pair budget.')
  const request = quoteRequest(input, prepared), funds = budgetFunds(input, request)
  const indicative = await stockSwapQuote(request, funds.raw)
  let nativeRaw = funds.raw, quoteRaw = indicative.outputRaw * 9800n * 9950n / 100_000_000n, gasRaw = indicative.gasRaw
  let best: LaunchReport | undefined, maxControl = 99_999_999
  for (let attempt = 0; attempt < 8; attempt++) {
    const projected = solveBudget(input, request, report => {
      const required = report.rows[0].raw!.buys
      return applyStockFunding(report, [{ quoteId: input.stockQuoteId!, quoteRaw: required, nativeRaw: ceilDiv(BigInt(required) * nativeRaw, quoteRaw).toString(), minimumOutputRaw: required, gasRaw: gasRaw.toString(), provider: 'Internal budget sizing only', asOf: new Date().toISOString(), slippageBps: 200, treasuryFeeBps: 50 }])
    }, maxControl)
    const control = Math.round(projected.rows[0].targetPct * 1_000_000)
    if (best && control <= Math.round(best.rows[0].targetPct * 1_000_000)) break
    const candidate = requireQuote(await fundStockReport(boundedReport({ ...request, stockFundingQuotes: undefined, targetsPct: [control / 1_000_000] })))
    const total = quoteTotal(input, candidate)
    if (total <= funds.raw) {
      best = candidate
      if (Number(formatAmount(funds.raw - total, funds.decimals)) * funds.usdPrice <= Math.max(0.5, input.target / 10000)) break
    } else maxControl = control - 1
    const route = candidate.request.stockFundingQuotes![0]
    nativeRaw = BigInt(route.nativeRaw); quoteRaw = BigInt(route.quoteRaw); gasRaw = BigInt(route.gasRaw)
  }
  if (!best) throw new Error('A stock funding route could not fit this budget at current prices. Try again or increase the budget.')
  return projectLaunchQuote(input, best)
}

function quoteRequest(input: LaunchQuoteInput, prepared: LaunchReportRequest) {
  const venue = validateInput(input)
  if (prepared.modelId !== venue.id || prepared.stockQuoteId !== input.stockQuoteId || !prepared.injectionLiquidity) throw new Error('Refresh the venue settings before calculating a quote.')
  let request = input.taxPercent == null ? structuredClone(prepared) : applyLaunchTax(prepared, input.taxPercent)
  if (input.agedWalletCount != null) request = applyAgedWalletCount(request, input.agedWalletCount)
  if (['stonkfun', 'launchlab'].includes(venue.id) && JSON.stringify(request.terms.transferFee) !== JSON.stringify(prepared.terms.transferFee)) throw new Error('Refresh Stonkfun settings after changing the holder tax.')
  request.liquidityAmounts = venue.requiresLiquidity ? [plainAmount(input.initialLp!)] : undefined
  return request
}

/** Pure text projection of a shared report snapshot; no alternate venue formulas. */
export function calculateLaunchQuote(input: LaunchQuoteInput, prepared: LaunchReportRequest): LaunchQuote {
  const request = quoteRequest(input, prepared)
  if (input.metric === 'budget' && input.stockQuoteId) throw new Error('Stock budgets require a live funding quote.')
  const report = input.metric === 'supply'
    ? requireQuote(boundedReport({ ...request, targetsPct: [input.target] }))
    : input.metric === 'budget' ? solveBudget(input, request) : solveMarketCap(request, input.target)
  return projectLaunchQuote(input, report)
}

function projectLaunchQuote(input: LaunchQuoteInput, report: LaunchReport): LaunchQuote {
  const venue = validateInput(input), request = report.request
  const row = requireQuote(report).rows[0], raw = row.raw!, decimals = report.fundingCurrency?.decimals ?? request.quote.decimals
  const lines: LaunchQuoteLine[] = []
  const add = (key: string, amount: bigint, label: string) => lines.push({ key, amount: formatAmount(amount, decimals), raw: amount.toString(), label })
  add('accumulation', BigInt(raw.funding) - BigInt(raw.initialLiquidity), 'for supply accumulation')
  if (BigInt(raw.initialLiquidity)) add('lp', BigInt(raw.initialLiquidity), 'for initial LP')
  add('aged', BigInt(raw.agedWallets), 'for aged wallets + Husher funding')
  const mm = input.mmLiquidity == null ? BigInt(raw.injectionLiquidity!) : parseAmount(plainAmount(input.mmLiquidity), decimals, 'MM liquidity')
  add('mm', mm, `designated for initial MM trading liquidity${input.mmLiquidity == null ? '' : ' (custom)'}`)
  const capitalTotalRaw = BigInt(raw.funding) + BigInt(raw.agedWallets) + mm
  const funds = input.metric === 'budget' ? budgetFunds(input, request) : undefined
  if (funds && capitalTotalRaw > funds.raw) throw new Error('The calculated launch exceeds the total budget.')
  return { venue, metric: input.metric, requestedTarget: input.target, supplyControlPct: row.actualPct!, launchMarketCapUsd: row.fdvUsd!,
    ...(funds ? { budget: { usd: input.target, currencyRaw: funds.raw.toString(), unusedRaw: (funds.raw - capitalTotalRaw).toString(), unusedUsd: Number(formatAmount(funds.raw - capitalTotalRaw, decimals)) * funds.usdPrice } } : {}),
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
  const symbol = quote.report.fundingCurrency?.symbol || quote.venue.symbol, request = quote.report.request
  const notes = [
    ...(request.operations.retainedPct ? [`Control includes ${request.operations.retainedPct}% team allocation.`] : []),
    ...(request.stockQuoteId && Number((request.terms.stockQuoteTax as { basisPoints?: number } | undefined)?.basisPoints) > 0 ? [`Quote tax: ${Number((request.terms.stockQuoteTax as { basisPoints: number }).basisPoints) / 100}% (included).`] : []),
    ...launchReportCautions(quote.report),
  ]
  return [
    `<b>${request.stockQuoteId ? quote.venue.name.replace(/ · (SOL|USDC)$/, '') : quote.venue.name}${request.stockQuoteId ? ` · ${request.quote.symbol} pair` : ''}</b>`,
    ...(launchTaxLabel(request) ? [launchTaxLabel(request)!] : []),
    ...(quote.initialLp ? [`Assuming a ${display(quote.initialLp)} ${symbol} initial LP:`] : []),
    ...(quote.budget ? [`Total budget: <b>${compactUsd(quote.budget.usd)}</b>.`] : []),
    `Capital requirement: <b>${display(quote.capitalTotal)} ${symbol} total</b> — ${quote.budget ? 'estimated' : 'targeting'} <b>${display(quote.supplyControlPct, 2)}% supply control</b> with an estimated <b>~${compactUsd(quote.launchMarketCapUsd)} launch MC</b>.`,
    '', 'Breakdown:',
    ...quote.lines.map(line => `• ~${display(line.amount)} ${symbol} ${line.label}`),
    ...(quote.budget && quote.budget.unusedUsd >= 0.5 ? [`Unused budget: ~${display(formatAmount(BigInt(quote.budget.unusedRaw), quote.report.fundingCurrency?.decimals ?? request.quote.decimals))} ${symbol}.`] : []),
    ...(notes.length ? ['', ...notes] : []),
  ].join('\n')
}
