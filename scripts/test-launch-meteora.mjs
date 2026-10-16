import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'
import { prepareCalculatorFixture } from './launch-calculator-fixtures.mjs'
const { createDefaultRequest } = loadSource(`${projectRoot}/lib/launch-reports/catalog.ts`)
const { calculateLaunchQuote, formatLaunchQuote } = loadSource(`${projectRoot}/lib/launch-calculator.ts`)
const { calculateLaunchReport } = loadSource(`${projectRoot}/lib/launch-reports/engine.ts`)
const { applyLaunchTax, validateLaunchTax } = loadSource(`${projectRoot}/lib/launch-reports/tax.ts`)
const { applyBundleWalletCount, validateBundleWalletCount } = loadSource(`${projectRoot}/lib/launch-reports/meteora.ts`)
const reference = JSON.parse(fs.readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/meteora-sdk.json`))
assert.equal(reference.feeMode.feesOnInput, true)
for (const v of reference.vectors) {
  const id = v.symbol === 'SOL' ? 'meteora-damm-v2' : 'meteora-damm-v2-usdc'
  let request = applyLaunchTax(createDefaultRequest(id), v.feeBps / 100)
  request = applyBundleWalletCount(request, v.count)
  request.targetsPct = [v.control]; request.liquidityAmounts = [v.lp]
  const row = calculateLaunchReport(await prepareCalculatorFixture(request)).rows[0]
  assert.equal(row.status, 'ok', row.error)
  assert.equal(row.raw.buys, v.buyRaw, `${id} SDK gross input ${v.control}% fee=${v.feeBps}, wallets=${v.count}`)
  assert.equal(row.raw.initialLiquidity, v.initialQuote)
  assert(Math.abs(row.fdvQuote / v.mcQuote - 1) < 1e-12, 'SDK post-buy MC')
  assert.equal(row.actualPct, v.control)
}
for (const id of ['meteora-damm-v2', 'meteora-damm-v2-usdc']) {
  const prepared = await prepareCalculatorFixture(createDefaultRequest(id))
  const input = { venueId: id, metric: 'supply', target: 70, initialLp: id.endsWith('usdc') ? 3500 : 35, taxPercent: 3, bundleWalletCount: 32 }
  const quote = calculateLaunchQuote(input, prepared)
  assert.match(quote.report.sourceVersion, /meteora-damm-v2-sdk@1.5.1/)
  assert.equal(quote.report.request.operations.buyerCount, 32)
  assert.equal(quote.report.request.operations.agedWalletCount, 32)
  assert.match(formatLaunchQuote(quote), /Pool fee: 3%/)
  assert.match(formatLaunchQuote(quote), /32 bundle wallets/)
  assert.equal(quote.report.request.injectionLiquidity.referenceSymbol, 'SOL')
  if (id.endsWith('usdc')) {
    assert.equal(quote.report.request.fundingConversion.nativeOperations.buyerCount, 32)
    assert.equal(quote.lines.find(x => x.key === 'mm').amount, '3000')
  } else assert.equal(quote.lines.find(x => x.key === 'mm').amount, '30')
  const mc = calculateLaunchQuote({ ...input, metric: 'market_cap', target: quote.launchMarketCapUsd }, prepared)
  assert(Math.abs(mc.supplyControlPct - 70) < 0.00001)
  const budget = Number(quote.capitalTotal) * Number(prepared.quote.usdPrice)
  const capped = calculateLaunchQuote({ ...input, metric: 'budget', target: Math.ceil(budget) }, prepared)
  assert(Number(capped.capitalTotal) * Number(prepared.quote.usdPrice) <= Math.ceil(budget))
  const lowerFee = calculateLaunchQuote({ ...input, taxPercent: 1 }, prepared)
  assert(BigInt(quote.capitalTotalRaw) > BigInt(lowerFee.capitalTotalRaw))
  assert.equal(quote.launchMarketCapUsd, lowerFee.launchMarketCapUsd, 'Claimed fees cannot inflate active pool price')
  const fewer = calculateLaunchQuote({ ...input, bundleWalletCount: 1 }, prepared)
  assert(BigInt(quote.report.rows[0].raw.operations) > BigInt(fewer.report.rows[0].raw.operations))
  assert.equal(BigInt(quote.lines.find(x => x.key === 'aged').raw), 32n * BigInt(fewer.lines.find(x => x.key === 'aged').raw))
  assert.equal(quote.report.request.operations.holderCount, 0)
  assert.equal(quote.report.request.operations.cleanupAmount, '0')
  for (const count of [1, 65, 125, 200]) {
    const direct = calculateLaunchQuote({ ...input, bundleWalletCount: count }, prepared)
    assert.equal(direct.report.request.operations.agedWalletCount, count)
    assert.equal(direct.lines.find(x => x.key === 'aged').amount, String(count * (id.endsWith('usdc') ? 10 : 0.1)))
    assert.equal(direct.capitalTotalRaw, direct.lines.reduce((sum, x) => sum + BigInt(x.raw), 0n).toString())
    const roundTrip = calculateLaunchQuote({ ...input, bundleWalletCount: count, metric: 'market_cap', target: direct.launchMarketCapUsd }, prepared)
    assert(Math.abs(roundTrip.supplyControlPct - 70) < 0.00001)
    const capped = calculateLaunchQuote({ ...input, bundleWalletCount: count, metric: 'budget', target: Math.ceil(Number(direct.capitalTotal) * Number(prepared.quote.usdPrice)) }, prepared)
    assert(BigInt(capped.capitalTotalRaw) <= BigInt(capped.budget.currencyRaw))
  }
  // Explicit bundles win over a stale independent aged count from an old bot session.
  assert.equal(calculateLaunchQuote({ ...input, agedWalletCount: 125 }, prepared).report.request.operations.agedWalletCount, 32)
  // A new generation upgrades legacy drafts, without modifying the saved request.
  const legacy = createDefaultRequest(id)
  legacy.operations = { ...legacy.operations, holderCount: 100, holderAmount: '0.02', cleanupAmount: '0.25', agedWalletCount: 125 }
  delete legacy.operations.injectionWalletCount
  const upgraded = await prepareCalculatorFixture(legacy)
  assert.equal(upgraded.operations.agedWalletCount, 25)
  assert.equal(upgraded.operations.holderCount, 0)
  assert.equal(legacy.operations.agedWalletCount, 125)
  // Separate injection wallets add acquisition cost once and never execute bundle buys.
  const extra = createDefaultRequest(id)
  extra.operations.injectionWalletCount = 10
  const withInjection = await prepareCalculatorFixture(extra)
  const extraQuote = calculateLaunchQuote({ ...input, bundleWalletCount: 200 }, withInjection)
  assert.equal(extraQuote.report.request.operations.buyerCount, 200)
  assert.equal(extraQuote.report.request.operations.agedWalletCount, 210)
  assert.equal(extraQuote.lines.find(x => x.key === 'aged').amount, id.endsWith('usdc') ? '2100' : '21')
  const mismatch = structuredClone(withInjection)
  mismatch.operations.agedWalletCount = 125
  assert.throws(() => calculateLaunchReport(mismatch), /wallet total/)
  const invalid = createDefaultRequest(id)
  invalid.operations.injectionWalletCount = 10001
  await assert.rejects(() => prepareCalculatorFixture(invalid), /Injection wallets/)

  for (const bad of [0, 100, -1, 0.001, NaN, Infinity]) assert.throws(() => validateLaunchTax(id, bad))
  for (const bad of [0, 201, 1.5, NaN, Infinity]) assert.throws(() => validateBundleWalletCount(bad))
  assert.throws(() => calculateLaunchQuote({ ...input, initialLp: 0 }, prepared))
  assert.throws(() => calculateLaunchQuote({ ...input, target: 100 }, prepared))
  assert.equal(calculateLaunchQuote({ ...input, target: 1 }, prepared).supplyControlPct, 1, 'No implicit team allocation')
  for (const terms of [{ dynamicFee: true }, { collectFeeMode: 'BothToken' }, { transferFee: { basisPoints: 1 } }]) {
    const report = calculateLaunchReport({ ...prepared, terms: { ...prepared.terms, ...terms }, targetsPct: [70], liquidityAmounts: [String(input.initialLp)] })
    assert.equal(report.rows[0].status, 'unavailable')
  }
}
console.log(`PASS Meteora: ${reference.vectors.length} official SDK vectors; SOL/USDC, fees, LP, buyers, supply/MC/budget, conversion and invalid configurations`)
