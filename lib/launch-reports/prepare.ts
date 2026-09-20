import type { LaunchReportRequest } from './types'
import { refreshLaunchTerms, supportedRefreshModels } from './refresh'
import { validateRequest } from './engine'
import { convertNativeAmount, convertNativeOperations, nativeDecimals } from './funding'
import { formatAmount, parseAmount } from './utils'
import { getModelCatalog } from './catalog'

async function spot(symbol: string) {
  if (!['SOL', 'ETH', 'BNB', 'USDC', 'USDT'].includes(symbol)) throw new Error('Select a supported quote currency or supply an explicit dated USD price.')
  const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Could not refresh ${symbol}/USD. Retry when the price service is available.`)
  const body = await response.json(), price = String(body.data?.amount || '')
  if (price.length > 120 || !/^\d+(\.\d+)?$/.test(price) || !Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error('Price service returned an invalid quote.')
  return { price, asOf: new Date(response.headers.get('date') || Date.now()).toISOString(), source: 'Coinbase spot' }
}

/** Validate editable inputs before public lookups, allowing explicitly native funding. */
export function validateLaunchDraft(request: LaunchReportRequest) {
  if (request?.fundingConversion) request = { ...request, operations: request.fundingConversion.nativeOperations, fundingConversion: undefined }
  if (request?.operations?.currencySymbol && request?.quote?.symbol && request.operations.currencySymbol !== request.quote.symbol) {
    if (!['USDC', 'USDT'].includes(request.quote.symbol)) throw new Error('Native funding conversion is supported for USDC and USDT quotes.')
    if (!Number.isInteger(request.quote.decimals) || request.quote.decimals < 0 || request.quote.decimals > 30) throw new Error('Quote decimals must be between 0 and 30.')
    const decimals = nativeDecimals(request.operations.currencySymbol)
    // Quote-liquidity values retain their own decimals; native allowances use native decimals.
    for (const value of request.liquidityAmounts || []) parseAmount(value, request.quote.decimals, 'Initial liquidity')
    validateRequest({ ...request, fundingConversion: undefined, liquidityAmounts: undefined, quote: { ...request.quote, symbol: request.operations.currencySymbol, decimals } })
  } else validateRequest(request)
  if (!getModelCatalog().some(model => model.id === request.modelId)) throw new Error('Choose a supported launch model.')
}

/** Fetch protocol inputs for a new quote. A failed refresh never silently uses old terms. */
export async function prepareLaunchReport(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  validateLaunchDraft(request)
  let next = structuredClone(request)
  const symbol = next.quote.symbol.toUpperCase()
  if (!next.quote.usdPrice || next.quote.priceSource === 'Coinbase spot') {
    const price = await spot(symbol)
    next.quote = { ...next.quote, usdPrice: price.price, priceSource: price.source, priceAsOf: price.asOf }
  }
  const native = next.fundingConversion?.nativeOperations || (next.operations.currencySymbol !== symbol ? next.operations : undefined)
  if (native) {
    const price = await spot(native.currencySymbol)
    next.operations = convertNativeOperations(native, symbol, next.quote.decimals, price.price, next.quote.usdPrice!)
    next.fundingConversion = { nativeOperations: structuredClone(native), nativeUsdPrice: price.price, quoteUsdPrice: next.quote.usdPrice!, asOf: price.asOf, source: `${price.source} · ${native.currencySymbol}/USD; ${next.quote.priceSource} · ${symbol}/USD at ${next.quote.priceAsOf}` }
  }
  if ((supportedRefreshModels as readonly string[]).includes(next.modelId)) next = await refreshLaunchTerms(next)
  if (next.modelId === 'pumpfun-custom' && next.terms.nativeMigrationCostLamports !== undefined) {
    const nativePrice = next.fundingConversion?.nativeOperations.currencySymbol === 'SOL' ? next.fundingConversion.nativeUsdPrice : (await spot('SOL')).price
    const amount = convertNativeAmount(formatAmount(BigInt(String(next.terms.nativeMigrationCostLamports)), 9), 'SOL', next.quote.decimals, nativePrice, next.quote.usdPrice!)
    next.terms.nativeMigrationFundingQuoteRaw = parseAmount(amount, next.quote.decimals).toString()
    next.terms.nativeMigrationConversion = { nativeUsdPrice: nativePrice, quoteUsdPrice: next.quote.usdPrice, source: 'Coinbase spot', quoteAsOf: next.quote.priceAsOf }
  }
  validateRequest(next)
  return next
}
