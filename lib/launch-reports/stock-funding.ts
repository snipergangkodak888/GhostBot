import { fetchLaunchData } from './data-fetch'
import { ceilDiv, parseAmount } from './utils'
import { nativeDecimals } from './funding'
import { applyStockFunding } from './stock-funding-math'
import type { LaunchReport, LaunchReportRequest, StockFundingQuote } from './types'

const SOL = 'So11111111111111111111111111111111111111112'
const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
// Sumo's default treasury conversion fee; distinct from the launch/Husher fee.
const SWAP_FEE_BPS = 50n, SLIPPAGE_BPS = 200n
async function json(url: string, headers?: Record<string, string>) {
  const r = await fetchLaunchData(url, { headers, signal: AbortSignal.timeout(12_000) }, 'Stock funding quotes', 1)
  if (!r.ok) throw new Error(`Stock funding provider returned HTTP ${r.status}.`)
  const body = await r.text(); if (body.length > 1_000_000) throw new Error('Stock funding quote is too large.')
  return JSON.parse(body)
}
function positiveRaw(value: unknown) { if (typeof value !== 'string' || !/^\d{1,78}$/.test(value) || BigInt(value) <= 0n) throw new Error('No funded route is available for this stock.'); return BigInt(value) }
export async function stockSwapQuote(request: LaunchReportRequest, nativeRaw: bigint): Promise<{ outputRaw: bigint; gasRaw: bigint; provider: string; quoteUsd?: number }> {
  if (!request.quote.address || nativeRaw <= 0n) throw new Error('Select a valid stock pair and funding amount.')
  if (request.modelId === 'pons') {
    const result = await json('https://aggregator-api.kyberswap.com/robinhood/api/v1/routes?' + new URLSearchParams({ tokenIn: ETH, tokenOut: request.quote.address, amountIn: nativeRaw.toString() }), { 'x-client-id': 'ghost-launch-math' })
    const q = result.data?.routeSummary
    if (result.code !== 0 || q?.tokenIn?.toLowerCase() !== ETH.toLowerCase() || q?.tokenOut?.toLowerCase() !== request.quote.address.toLowerCase() || q.amountIn !== nativeRaw.toString() || !q.route?.length) throw new Error('No ETH funding route is available for this stock.')
    const outputRaw = positiveRaw(q.amountOut)
    return { outputRaw, provider: 'KyberSwap · Robinhood', gasRaw: positiveRaw(q.gas) * positiveRaw(q.gasPrice) }
  }
  // V2 order without a taker is a read-only indicative route. No transaction is built or sent.
  const params = new URLSearchParams({ inputMint: SOL, outputMint: request.quote.address, amount: nativeRaw.toString() })
  try {
    const key = process.env.JUPITER_API_KEY
    const q = await json('https://api.jup.ag/swap/v2/order?' + params, key ? { 'x-api-key': key } : undefined)
    if (q.inputMint !== SOL || q.outputMint !== request.quote.address || q.inAmount !== nativeRaw.toString() || !q.routePlan?.length) throw new Error('No Jupiter stock route.')
    const outputRaw = positiveRaw(q.outAmount), quoteUsd = Number(q.outUsdValue) / (Number(outputRaw) / 10 ** request.quote.decimals)
    return { outputRaw, provider: 'Jupiter Swap V2', gasRaw: 3_000_000n, ...(Number.isFinite(quoteUsd) && quoteUsd > 0 ? { quoteUsd } : {}) }
  } catch {
    const q = (await json('https://transaction-v1.raydium.io/compute/swap-base-in?' + new URLSearchParams({ ...Object.fromEntries(params), slippageBps: '200', txVersion: 'V0' }))).data
    if (q?.inputMint !== SOL || q?.outputMint !== request.quote.address || q.inputAmount !== nativeRaw.toString() || !q.routePlan?.length) throw new Error('No SOL funding route is available for this stock. Choose another pair or try again.')
    return { outputRaw: positiveRaw(q.outputAmount), provider: 'Raydium Trade API', gasRaw: 3_000_000n }
  }
}
/** Requote at the actual funding size until net output covers the whole plan.
 * Do not extrapolate a small spot quote over an entire launch's price impact. */
export async function sizeStockFunding(request: LaunchReportRequest, quoteRaw: bigint): Promise<StockFundingQuote> {
  const c = request.fundingConversion!
  const decimals = nativeDecimals(c.nativeOperations.currencySymbol)
  let input = ceilDiv(quoteRaw * parseAmount(c.quoteUsdPrice, 30) * 10n ** BigInt(decimals) * 10_000n * 10_000n,
    10n ** BigInt(request.quote.decimals) * parseAmount(c.nativeUsdPrice, 30) * (10_000n - SLIPPAGE_BPS) * (10_000n - SWAP_FEE_BPS))
  const initial = input
  for (let i = 0; i < 5; i++) {
    const q = await stockSwapQuote(request, input)
    const floor = q.outputRaw * (10_000n - SLIPPAGE_BPS) * (10_000n - SWAP_FEE_BPS) / 100_000_000n
    if (floor >= quoteRaw) return { quoteId: request.stockQuoteId!, quoteRaw: quoteRaw.toString(), nativeRaw: input.toString(), minimumOutputRaw: floor.toString(), gasRaw: q.gasRaw.toString(), provider: q.provider, slippageBps: 200, treasuryFeeBps: 50, asOf: new Date().toISOString() }
    if (floor <= 0n) break
    input = ceilDiv(input * quoteRaw * 1001n, floor * 1000n)
    if (input > initial * 2n) throw new Error('The stock funding route has excessive price impact. Choose another pair or a lower target.')
  }
  throw new Error('The funding route cannot cover this stock launch at the current price. Try a lower target.')
}
export async function fundStockReport(report: LaunchReport): Promise<LaunchReport> {
  if (!report.request.stockQuoteId) return report
  if (report.fundingCurrency) return report
  const amounts = [...new Set(report.rows.filter(r => r.status === 'ok').map(r => r.raw!.buys))]
  const quotes: StockFundingQuote[] = []
  const failures = new Map<string, unknown>()
  for (let i = 0; i < amounts.length; i += 2) {
    const batch = amounts.slice(i, i + 2)
    const results = await Promise.allSettled(batch.map(raw => sizeStockFunding(report.request, BigInt(raw))))
    results.forEach((result, j) => result.status === 'fulfilled' ? quotes.push(result.value) : failures.set(batch[j], result.reason))
  }
  if (!quotes.length && failures.size) throw failures.values().next().value
  const funded = applyStockFunding(report, quotes)
  report.rows.forEach((row, i) => {
    const failure = row.raw && failures.get(row.raw.buys)
    if (failure) funded.rows[i].error = failure instanceof Error ? failure.message : 'Stock funding route is unavailable.'
  })
  return funded
}
