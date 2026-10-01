import { accountData, CLOCK, decodePumpRegistry, decodeQuoteMint, PUMP_PROGRAM, PUMP_QUOTE_REGISTRY, resolveStockPair, stockJson } from './stock-pairs'
import { readSolanaLaunchAccounts } from './solana-data'
import { refreshPonsTerms } from './refresh-pons'
import { convertNativeOperations } from './funding'
import { createLaunchLabCurve } from './amm-math/launchlab-quote-math'
import { launchTaxPercent, launchTaxTargets } from './tax'
import { GHOST_INJECTION_VERSION, injectionReference } from './injection'
import type { LaunchReportRequest } from './types'

const GLOBAL = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf'
const FEES = ['5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx', '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt']
const FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'
const LAUNCHLAB = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'
function dated(asOf: string) { if (!Number.isFinite(Date.parse(asOf)) || Math.abs(Date.now() - Date.parse(asOf)) > 180_000) throw new Error('Stock prices are stale. Please generate again.') }
function price(value: unknown): string { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error('The stock price is unavailable.'); return n.toFixed(18).replace(/0+$/, '').replace(/\.$/, '') }

export async function prepareStockReport(request: LaunchReportRequest, spot: (symbol: string) => Promise<{price: string; asOf: string; source: string}>): Promise<LaunchReportRequest> {
  const pair = await resolveStockPair(request.modelId, request.stockQuoteId!)
  let next = structuredClone(request)
  delete next.stockFundingQuotes; delete next.injectionLiquidity
  next.operations = structuredClone(request.fundingConversion?.nativeOperations || request.operations)
  delete next.fundingConversion
  const nativeSymbol = request.modelId === 'pons' ? 'ETH' : 'SOL'
  if (next.operations.currencySymbol !== nativeSymbol) throw new Error('Stock funding allowances must remain in the native currency.')
  const native = await spot(nativeSymbol)
  next.quote = { symbol: pair.symbol, decimals: pair.decimals, address: pair.address }
  const now = new Date().toISOString()
  if (request.modelId === 'pons') {
    next = await refreshPonsTerms(next)
    const data = await stockJson(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(pair.symbol)}`, 'Robinhood stock price')
    const q = data.quotes?.find((q: any) => q.tokenSymbol === pair.symbol)
    if (!q || q.isTradingHalt || !q.deployments?.some((d: any) => d.chainId === 4663 && d.contractAddress.toLowerCase() === pair.address.toLowerCase())) throw new Error('The stock price is halted or its contract does not match.')
    dated(q.generatedAt)
    next.quote = { ...next.quote, usdPrice: price(Number(q.ask) * Number(pair.multiplier)), priceAsOf: q.generatedAt, priceSource: 'Robinhood ask × corporate-action multiplier' }
    next.terms.stockQuoteTax = { basisPoints: 0, source: 'Canonical Robinhood stock token; factory-approved pair', multiplier: pair.multiplier }
    // Before a launch address exists, fund both possible Uniswap currency orderings.
    next.terms.stockCurrencyOrderings = true
  } else {
    const pump = request.modelId.startsWith('pumpfun')
    const reward = !pump && (launchTaxPercent(next) || 0) > 0
    const pricing = !pump ? (await stockJson(`https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?${new URLSearchParams({quoteMint: pair.address, mode: reward ? 'reward' : 'standard'})}`)).data : null
    if (!pump && (pricing?.quote?.mint !== pair.address || pricing.quote.decimals !== pair.decimals || pricing.curve?.programId !== LAUNCHLAB || pricing.curve.curveType !== 'ConstantCurve')) throw new Error('The stock LaunchLab settings have changed.')
    const addresses = pump ? [PUMP_QUOTE_REGISTRY, GLOBAL, ...FEES, pair.address, CLOCK] : [pricing.curve.configId, pricing.platform[reward ? 'reward' : 'standard'], pair.address, CLOCK]
    const snapshot = await readSolanaLaunchAccounts(addresses)
    const clock = accountData(snapshot.value.at(-1), undefined, undefined, 40)
    if (Math.abs(Date.now() / 1000 - Number(clock.readBigInt64LE(32))) > 180) throw new Error('The stock RPC snapshot is stale.')
    const mint = decodeQuoteMint(snapshot.value.at(-2), clock.readBigUInt64LE(16))
    if (mint.decimals !== pair.decimals) throw new Error('The stock catalogue decimals differ from its mint.')
    next.terms = { ...next.terms, mint: pair.address, tokenProgramId: mint.tokenProgram, quoteTransferFee: mint.transferFee, stockQuoteTax: { ...mint.transferFee, basisPoints: mint.transferFee?.basisPoints || 0, epoch: clock.readBigUInt64LE(16).toString(), source: 'Token-2022 mint RPC' } }
    if (pump) {
      if (mint.transferFee?.basisPoints && BigInt(mint.transferFee.maximumFee)) throw new Error('Pump custom pairs with an active quote transfer tax are not supported by the verified launch model. Choose another pair.')
      const initial = decodePumpRegistry(snapshot.value[0]).get(pair.address)
      if (!initial || BigInt(initial) <= 0n) throw new Error('This stock is no longer approved by Pump.')
      const global = accountData(snapshot.value[1], PUMP_PROGRAM, 'a7e8e8b1c86c727f', 1054)
      if (global.readBigUInt64LE(73) !== 1_073_000_000_000_000n || global.readBigUInt64LE(89) !== 793_100_000_000_000n || global.readBigUInt64LE(97) !== 1_000_000_000_000_000n) throw new Error('Pump supply settings changed; the stock model needs review.')
      const flat = snapshot.value.slice(2, 4).map(a => accountData(a, FEE_PROGRAM, '8f3492bbdb7b4c9b', 65))
      const protocol = Number(flat[0].readBigUInt64LE(49)), creator = Number(flat[0].readBigUInt64LE(57))
      const pool = { lp: Number(flat[1].readBigUInt64LE(41)), protocol: Number(flat[1].readBigUInt64LE(49)), creator: Number(flat[1].readBigUInt64LE(57)) }
      if (protocol + creator >= 10_000 || pool.lp + pool.protocol + pool.creator >= 10_000) throw new Error('Invalid Pump custom fees.')
      const override = Number(next.terms.creatorFeeOverrideBps || 0)
      if (override && (!global[1045] || override > Number(global.readBigUInt64LE(1046)))) throw new Error('The creator tax exceeds Pump’s current allowed maximum.')
      next.terms = { ...next.terms, registry: PUMP_QUOTE_REGISTRY, quoteSchedule: 'stock', initialVirtualQuoteReserves: initial, protocolFeeBps: protocol, creatorFeeBps: creator, migrationFeeRaw: '0', nativeMigrationCostLamports: global.readBigUInt64LE(146).toString(), stockPoolFees: pool, maxCreatorFeeBps: Number(global.readBigUInt64LE(1046)) }
      delete next.terms.ammFeeTiers
      const { stockSwapQuote } = await import('./stock-funding')
      const quote = await stockSwapQuote(next, 1_000_000_000n)
      const unitPrice = quote.quoteUsd || (Number(native.price) / (Number(quote.outputRaw) / 10 ** pair.decimals))
      next.quote = { ...next.quote, usdPrice: price(unitPrice), priceAsOf: now, priceSource: `${quote.provider} token price` }
    } else {
      dated(pricing.prices.observedAt)
      const global = accountData(snapshot.value[0], LAUNCHLAB, '95089ccaa0fcb0d9', 115)
      const platform = accountData(snapshot.value[1], LAUNCHLAB, 'a04e8000f853e6a0', 728)
      const { base58 } = await import('./stock-pairs')
      if (global[16] !== 0 || base58(global.subarray(83, 115)) !== pair.address || BigInt(pricing.raise.raw) < global.readBigUInt64LE(35)) throw new Error('The quote config or raise does not match LaunchLab.')
      if (reward && !pricing.modes?.reward?.transferFeeBps?.includes(Math.round(launchTaxPercent(next)! * 100))) throw new Error('Stonkfun no longer offers this holder tax.')
      next.terms = { ...next.terms, supply: pricing.curve.supply, totalSellA: pricing.curve.totalSellA, totalLockedAmount: pricing.curve.vesting.totalLockedAmount, totalFundRaisingB: pricing.raise.raw, migrateFee: global.readBigUInt64LE(19).toString(), tradeFeeRate: global.readBigUInt64LE(27).toString(), platformFeeRate: platform.readBigUInt64LE(104).toString(), creatorFeeRate: platform.readBigUInt64LE(720).toString() }
      const curve = createLaunchLabCurve(next.terms as any)
      if (curve.virtualBase.toString() !== pricing.curve.derived.virtualA || curve.virtualQuote.toString() !== pricing.curve.derived.virtualB) throw new Error('The stock curve differs from Stonkfun’s quoted reserves.')
      next.targetsPct = launchTaxTargets(next)
      next.quote = { ...next.quote, usdPrice: price(pricing.prices.quoteUsd), priceAsOf: pricing.prices.observedAt, priceSource: 'Stonkfun stock pricing' }
    }
    next.terms._snapshot = { slot: snapshot.context.slot, rpc: snapshot.rpc, observedAt: snapshot.observedAt, accounts: addresses }
    next.termsSource = { kind: 'snapshot', label: `${pump ? 'Pump' : 'Stonkfun'} ${pair.symbol} pair · slot ${snapshot.context.slot}`, asOf: now }
  }
  const nativeOps = structuredClone(next.operations)
  next.operations = convertNativeOperations(nativeOps, pair.symbol, pair.decimals, native.price, next.quote.usdPrice!)
  next.fundingConversion = { nativeOperations: nativeOps, nativeUsdPrice: native.price, quoteUsdPrice: next.quote.usdPrice!, asOf: now, source: `${native.source}; ${next.quote.priceSource}` }
  next.injectionLiquidity = { policyVersion: GHOST_INJECTION_VERSION, referenceSymbol: injectionReference(next.modelId), referenceUsdPrice: native.price, quoteUsdPrice: next.quote.usdPrice!, asOf: now, source: native.source }
  return next
}
