import assert from 'node:assert/strict'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'
const load = createSourceLoader()
const { injectionLiquidityRaw, validateInjectionPolicy } = load(`${projectRoot}/lib/launch-reports/injection.ts`)
const { createDefaultRequest } = load(`${projectRoot}/lib/launch-reports/catalog.ts`)
const { calculateLaunchReport } = load(`${projectRoot}/lib/launch-reports/engine.ts`)
const { formatAmount } = load(`${projectRoot}/lib/launch-reports/utils.ts`)
const { renderLaunchReportSvg, launchReportCsv } = load(`${projectRoot}/lib/launch-reports/render.ts`)
const stamp = '2026-09-20T12:00:00Z'
function request(model = 'pons', quote = 'ETH', price = '2000', reference = '2000') {
  const draft = createDefaultRequest(model)
  draft.quote = { symbol: quote, decimals: ['USDC', 'USDT'].includes(quote) ? 6 : quote === 'SOL' ? 9 : 18, usdPrice: price, priceAsOf: stamp, priceSource: 'Policy test fixture' }
  draft.injectionLiquidity = { policyVersion: 'ghost-injection-v1', referenceSymbol: model.startsWith('pumpfun') || model === 'raydium-cpmm' ? 'SOL' : 'ETH', referenceUsdPrice: reference, quoteUsdPrice: price, asOf: stamp, source: 'Policy test fixture' }
  return draft
}
const amount = (draft, mc) => formatAmount(injectionLiquidityRaw(draft, mc), draft.quote.decimals)
const eth = request()
for (const [mc, expected] of [[0, '1.3'], [299999, '1.3'], [300000, '1.3'], [400000, '1.65'], [500000, '2'], [750000, '3.5'], [1000000, '5'], [2000000, '10']]) assert.equal(amount(eth, mc), expected, `ETH buffer at ${mc}`)
const sol = request('pumpfun', 'SOL', '100', '100')
for (const [mc, expected] of [[0, '30'], [499999, '30'], [500000, '30'], [750000, '45'], [1000000, '60']]) assert.equal(amount(sol, mc), expected, `SOL buffer at ${mc}`)
const bnb = request('fourmeme', 'BNB', '500')
for (const [mc, expected] of [[300000, '5.2'], [500000, '8'], [1000000, '20'], [2000000, '40']]) assert.equal(amount(bnb, mc), expected, `BNB conversion at ${mc}`)
assert.equal(amount(request('pumpfun-custom', 'USDC', '1', '100'), 500000), '3000')
assert.equal(amount(request('pons', 'ETH', '6000', '6000'), 1000000), '2')
assert.equal(amount(request('pons', 'ETH', '6000', '6000'), 2000000), '4', 'Scale proportionally above the minimum-protected $1m anchor')
assert.equal(amount(request('uniswap-v2', 'USDC', '1', '1.0000001'), 300000), '1.300001', 'Round upward to the quote atom')

for (const ethPrice of ['1000', '2000', '6000', '10000']) {
  const draft = request('pons', 'ETH', ethPrice, ethPrice)
  let previous = 0n
  for (let mc = 0; mc <= 2_000_000; mc += 10000) {
    const reserve = injectionLiquidityRaw(draft, mc)
    assert(reserve >= previous, 'Buffer must not decrease as MC increases, even when 2 ETH exceeds $10k')
    previous = reserve
  }
}
for (const change of [
  r => { r.injectionLiquidity.policyVersion = 'unknown' },
  r => { r.injectionLiquidity.referenceSymbol = 'SOL' },
  r => { r.injectionLiquidity.referenceUsdPrice = '0' },
  r => { r.injectionLiquidity.referenceUsdPrice = '3000' },
  r => { r.injectionLiquidity.quoteUsdPrice = '1' },
  r => { r.injectionLiquidity.asOf = 'not-a-date' },
]) { const invalid = structuredClone(eth); change(invalid); assert.throws(() => validateInjectionPolicy(invalid)) }
assert.throws(() => injectionLiquidityRaw(eth, null), /market cap/)
assert.throws(() => injectionLiquidityRaw(eth, Infinity), /market cap/)

const withReserve = calculateLaunchReport(sol)
const legacy = structuredClone(sol); delete legacy.injectionLiquidity
const withoutReserve = calculateLaunchReport(legacy)
for (let i = 0; i < withReserve.rows.length; i++) {
  const row = withReserve.rows[i], old = withoutReserve.rows[i]
  assert.equal(row.status, 'ok')
  assert.equal(row.fdvQuote, old.fdvQuote, 'Holding the reserve does not change the modeled MC')
  for (const key of ['buys', 'initialLiquidity', 'funding', 'providerFee', 'agedWallets']) assert.equal(row.raw[key], old.raw[key], key)
  assert.equal(BigInt(row.raw.total), BigInt(row.raw.funding) + BigInt(row.raw.agedWallets) + BigInt(row.raw.injectionLiquidity))
  assert.equal(BigInt(row.raw.total) - BigInt(old.raw.total), BigInt(row.raw.injectionLiquidity))
}
assert.deepEqual(calculateLaunchReport(withReserve.request).rows, withReserve.rows, 'Frozen snapshots preserve the buffer and FX without new lookups')
assert(withoutReserve.assumptions.some(note => /excluded from this legacy snapshot/.test(note)))
const svg = renderLaunchReportSvg(withReserve), csv = launchReportCsv(withReserve)
assert.match(svg, /MC \(USD\)/)
assert.match(svg, /INJECTION \/ MM \(SOL\)/)
assert.doesNotMatch(svg, /FDV/)
assert.match(csv.split('\r\n')[0], /injection_mm_liquidity.*mc_quote.*mc_usd/)
console.log('PASS: injection policy anchors, interpolation, proportional scaling, BNB/stablecoin conversions, integer rounding, monotonic minimums, validation, separate funding totals, MC labels and reproducible legacy/current snapshots.')
