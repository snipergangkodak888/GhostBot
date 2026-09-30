import type { LaunchReportRequest } from './types'
import { parseAmount } from './utils'

export function launchTaxConfig(modelId: string) {
  if (modelId === 'pons') return { label: 'Creator tax', options: [0, 1, 3, 5, 10], custom: true }
  if (modelId === 'stonkfun' || modelId === 'launchlab') return { label: 'Holder tax', options: [0, 1, 3], custom: false }
  return null
}

export function launchTaxPercent(request: LaunchReportRequest): number | undefined {
  if (!launchTaxConfig(request.modelId)) return undefined
  return request.modelId === 'pons' ? Number(request.terms.creatorTaxBps ?? 0) / 100
    : Number((request.terms.transferFee as { basisPoints?: number } | undefined)?.basisPoints ?? 0) / 100
}

export function validateLaunchTax(modelId: string, percent: number) {
  const config = launchTaxConfig(modelId)
  if (!config) throw new Error('This venue does not offer a configurable launch tax.')
  if (!Number.isFinite(percent) || percent < 0 || percent > 10 || Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-8) throw new Error('Enter a tax from 0% to 10%, with at most two decimal places.')
  if (!config.custom && !config.options.includes(percent)) throw new Error('Choose 0% standard, 1% or 3% Stonkfun holder tax. Available reward rates are verified when generating.')
}

/** Client choice; protocol fees remain separate and are refreshed from the venue. */
export function applyLaunchTax(request: LaunchReportRequest, percent: number): LaunchReportRequest {
  validateLaunchTax(request.modelId, percent)
  const next = structuredClone(request), bps = Math.round(percent * 100)
  if (next.modelId === 'pons') next.terms.creatorTaxBps = bps
  else if (bps) next.terms.transferFee = { basisPoints: bps, maximumFee: parseAmount(next.base.supply, next.base.decimals).toString() }
  else delete next.terms.transferFee
  return next
}

/** Keep preset comparisons and MC-search samples inside the net curve inventory. */
export function launchTaxTargets(request: LaunchReportRequest, targets = request.targetsPct): number[] {
  if (!['stonkfun', 'launchlab'].includes(request.modelId) || !launchTaxPercent(request)) return targets
  const supply = parseAmount(request.base.supply, request.base.decimals)
  const sellable = BigInt(String(request.terms.totalSellA))
  const bps = BigInt(Math.round(launchTaxPercent(request)! * 100))
  // Round down for a readable comparison endpoint, leaving room for wallet fee rounding.
  const ceiling = Number((sellable * (10_000n - bps) * 1_000_000n / (10_000n * supply) - 1n) / 100n) / 100
  return [...new Set(targets.map(target => Math.min(target, ceiling)))].filter(target => target > 0)
}

export function launchTaxLabel(request: LaunchReportRequest): string | undefined {
  const config = launchTaxConfig(request.modelId), percent = launchTaxPercent(request)
  return config ? `${config.label}: ${percent}%` : undefined
}
