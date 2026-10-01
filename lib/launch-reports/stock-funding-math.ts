import type { LaunchReport, LaunchReportAmounts, StockFundingQuote } from './types'
import { ceilDiv, formatAmount, parseAmount } from './utils'
import { nativeDecimals } from './funding'
import { injectionLiquidityRaw } from './injection'
import { launchReportFootnotes } from './client-summary'

/** Project a frozen stock purchase plan and funding route into native capital. */
export function applyStockFunding(report: LaunchReport, quotes = report.request.stockFundingQuotes): LaunchReport {
  if (!report.request.stockQuoteId) return report
  const request = report.request, conversion = request.fundingConversion
  if (!conversion) throw new Error('Stock funding requires its native operating allowances.')
  const op = conversion.nativeOperations, decimals = nativeDecimals(op.currencySymbol)
  const amount = (v: string) => parseAmount(v, decimals)
  const next = structuredClone(report)
  next.request.stockFundingQuotes = quotes
  next.fundingCurrency = { symbol: op.currencySymbol, decimals }
  for (const row of next.rows) {
    if (row.status !== 'ok' || !row.raw) continue
    const quoteRaw = row.raw.buys
    const route = quotes?.find(q => q.quoteId === request.stockQuoteId && q.quoteRaw === quoteRaw)
    if (!route) { row.status = 'unavailable'; row.error = 'A live stock funding quote is required. Generate again.'; delete row.raw; delete row.amounts; continue }
    for (const key of ['quoteRaw', 'nativeRaw', 'minimumOutputRaw', 'gasRaw'] as const) if (!/^\d+$/.test(route[key])) throw new Error('Invalid saved stock funding amount.')
    if (BigInt(route.minimumOutputRaw) < BigInt(quoteRaw) || BigInt(route.nativeRaw) <= 0n || !Number.isFinite(Date.parse(route.asOf)) || route.slippageBps !== 200 || route.treasuryFeeBps !== 50) throw new Error('The stock funding route does not cover the purchases.')
    const counts = row.details?.count as { curve?: number; pool?: number } | undefined
    const participating = counts ? (counts.curve || 0) + (counts.pool || 0) : op.buyerCount
    const nativeMigration = request.modelId.startsWith('pumpfun') && row.phase !== 'Curve' ? BigInt(String(request.terms.nativeMigrationCostLamports || '0')) : 0n
    const operations = amount(op.setupAmount) + amount(op.buyerGasAmount) * BigInt(participating) + amount(op.cleanupAmount) + amount(op.holderAmount) * BigInt(op.holderCount) + amount(op.tipAmount) + amount(op.launchFeeAmount)
      + BigInt(route.gasRaw) * BigInt(participating) + nativeMigration
    const buys = BigInt(route.nativeRaw), base = buys + operations
    const providerFee = ceilDiv(base * 10_000n, 10_000n - BigInt(op.providerFeeBps)) - base
    const recipientBuffers = BigInt(op.recipientCount) * amount(op.recipientBufferAmount), sourceGas = amount(op.sourceGasAmount)
    const funding = base + providerFee + recipientBuffers + sourceGas, agedWallets = BigInt(op.agedWalletCount) * amount(op.agedWalletUnitAmount)
    const injectionLiquidity = injectionLiquidityRaw({ ...request, fundingConversion: undefined, quote: { symbol: op.currencySymbol, decimals, usdPrice: conversion.nativeUsdPrice }, injectionLiquidity: { ...request.injectionLiquidity!, quoteUsdPrice: conversion.nativeUsdPrice } }, row.fdvUsd ?? null)
    const raw = { buys, operations, initialLiquidity: 0n, modelReserves: 0n, providerFee, recipientBuffers, sourceGas, funding, agedWallets, injectionLiquidity, total: funding + agedWallets + injectionLiquidity }
    row.raw = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.toString()])) as unknown as LaunchReportAmounts
    row.amounts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, formatAmount(v, decimals)])) as unknown as LaunchReportAmounts
    row.totalUsd = null
    row.details = { ...row.details, stockPurchaseRaw: quoteRaw, stockFunding: route }
  }
  next.assumptions = [
    ...launchReportFootnotes(next),
    `Pair: ${request.quote.symbol}; capital and operating allowances are in ${op.currencySymbol}. Live funding routes cover the required quote tokens after slippage and the treasury conversion fee.`,
    `Operating allowance = setup ${op.setupAmount} + participating buyers × buyer gas ${op.buyerGasAmount} + cleanup ${op.cleanupAmount} + ${op.holderCount} × holder funding ${op.holderAmount} + tip ${op.tipAmount} + launch fee ${op.launchFeeAmount}; native swap gas and any Pump migration fee are added.`,
    `Provider fee ${op.providerFeeBps} bps is grossed up on funded purchases and operating allowances; recipient buffers and source gas are then added.`,
    `Stock acquisition amounts, transfer-fee schedules and dated funding routes are retained in the report details.`,
  ]
  return next
}
