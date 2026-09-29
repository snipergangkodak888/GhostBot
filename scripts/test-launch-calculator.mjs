import assert from 'node:assert/strict'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'
import { prepareCalculatorFixture } from './launch-calculator-fixtures.mjs'
let preparations = 0, failPreparation = false
const load = createSourceLoader({ './launch-reports/prepare': { prepareLaunchReport: async request => {
  preparations++
  if (failPreparation) throw new Error('Protocol configuration unavailable')
  return prepareCalculatorFixture(request)
} } })
const { calculateLaunchQuote, prepareLaunchQuote, formatLaunchQuote, parseLaunchNumber } = load(`${projectRoot}/lib/launch-calculator.ts`)
const { getModelCatalog, createDefaultRequest } = load(`${projectRoot}/lib/launch-reports/catalog.ts`)
const { calculateLaunchReport } = load(`${projectRoot}/lib/launch-reports/engine.ts`)
const { getLaunchVenues, groupFor } = load(`${projectRoot}/lib/launch-reports/venues.ts`)
const { launchMathGroupView } = load(`${projectRoot}/lib/launch-reports/telegram.ts`)
assert.deepEqual(getLaunchVenues().map(x => x.id), getModelCatalog().map(x => x.id))
for (const group of ['solana', 'bnb', 'robinhood', 'dex']) {
  assert.deepEqual(getLaunchVenues().filter(x => x.chainId === group).map(x => x.name), launchMathGroupView(group).replyMarkup.inline_keyboard.slice(0, -1).map(row => row[0].text))
}
const snapshots = new Map()
for (const model of getModelCatalog()) {
  const prepared = await prepareCalculatorFixture(createDefaultRequest(model.id)), before = structuredClone(prepared)
  snapshots.set(model.id, prepared)
  const input = { venueId: model.id, metric: 'supply', target: 67.37, ...(model.requiresLiquidity ? { initialLp: Number(prepared.liquidityAmounts[0]) } : {}) }
  const supply = calculateLaunchQuote(input, prepared)
  const report = calculateLaunchReport({ ...prepared, targetsPct: [input.target], liquidityAmounts: model.requiresLiquidity ? [String(input.initialLp)] : undefined })
  assert.equal(supply.capitalTotalRaw, report.rows[0].raw.total, `${model.id} text and image total must match exactly`)
  assert.equal(supply.capitalTotalRaw, supply.lines.reduce((sum, line) => sum + BigInt(line.raw), 0n).toString())
  assert.match(formatLaunchQuote(supply), /Capital requirement:.*supply control.*launch MC/s)
  assert.doesNotMatch(formatLaunchQuote(supply), /FDV/)
  assert.equal(supply.lines.find(x => x.key === 'aged').amount, model.id === 'pumpfun-custom' ? '1250' : prepared.quote.symbol === 'SOL' ? '12.5' : prepared.quote.symbol === 'BNB' ? '2.5' : '1.25')
  for (const target of [67.37, ...prepared.targetsPct]) {
    const direct = calculateLaunchQuote({ ...input, target }, prepared)
    const mc = calculateLaunchQuote({ ...input, metric: 'market_cap', target: direct.launchMarketCapUsd }, prepared)
    assert(Math.abs(mc.launchMarketCapUsd - direct.launchMarketCapUsd) <= Math.max(0.01, direct.launchMarketCapUsd * 0.000001), `${model.id} MC round trip ${target}%`)
    if (target === 67.37) assert(Math.abs(mc.supplyControlPct - target) < 0.001, `${model.id} control round trip`)
  }
  const custom = calculateLaunchQuote({ ...input, mmLiquidity: 0 }, prepared)
  assert.equal(BigInt(custom.capitalTotalRaw), BigInt(supply.capitalTotalRaw) - BigInt(supply.report.rows[0].raw.injectionLiquidity))
  assert.equal(custom.lines.find(line => line.key === 'mm').amount, '0')
  assert.deepEqual(prepared, before, 'Search and custom reserves cannot mutate prepared reports')
  assert.throws(() => calculateLaunchQuote({ ...input, metric: 'market_cap', target: 0.01 }, prepared), /starts at|upper limit/)
  console.log(`PASS ${model.id}: catalogue parity, exact totals, wallet pricing, ${prepared.targetsPct.length + 1} MC round trips, custom MM and range rejection`)
}
const pump = { venueId: 'pumpfun', metric: 'supply', target: 85 }
const migrated = calculateLaunchQuote(pump, snapshots.get('pumpfun'))
assert.match(formatLaunchQuote(migrated), /curve \+ migrated pool/)
for (const change of [{ target: 100 }, { target: Infinity }, { target: NaN }, { target: 60.1234567 }, { mmLiquidity: Infinity }, { mmLiquidity: -1 }, { mmLiquidity: 1e-19 }, { metric: 'bad' }]) assert.throws(() => calculateLaunchQuote({ ...pump, ...change }, snapshots.get('pumpfun')))
assert.throws(() => calculateLaunchQuote({ ...pump, venueId: 'meteora' }, snapshots.get('pumpfun')), /updated Launch Calc menu/)
assert.throws(() => calculateLaunchQuote({ ...pump, venueId: 'stonkfun' }, snapshots.get('stonkfun')), /curve sale allocation/)
assert.throws(() => calculateLaunchQuote({ ...pump, venueId: 'stonkfun', metric: 'market_cap', target: 1e9 }, snapshots.get('stonkfun')), /starts at|upper limit/)
assert.throws(() => calculateLaunchQuote({ ...pump, venueId: 'uniswap-v2', target: 20, initialLp: 2 }, snapshots.get('uniswap-v2')), /retained supply/)
const previousBnb = process.env.LAUNCH_REPORT_BNB_RPC_URL
try {
  process.env.LAUNCH_REPORT_BNB_RPC_URL = 'https://fixture.bsc.quiknode.pro/fixture-secret/'
  for (const id of ['fourmeme', 'flap']) {
    const request = await prepareCalculatorFixture(createDefaultRequest(id))
    assert.equal(request.terms._snapshot.rpc, 'QuickNode BNB mainnet')
    assert(!JSON.stringify(request).includes('fixture-secret'), 'Private RPC credentials must not appear in reports')
  }
  process.env.LAUNCH_REPORT_BNB_RPC_URL = 'http://invalid.example'
  assert.throws(() => load(`${projectRoot}/lib/launch-reports/bnb-rpc.ts`).bnbLaunchRpc(), /HTTPS/)
} finally {
  if (previousBnb === undefined) delete process.env.LAUNCH_REPORT_BNB_RPC_URL
  else process.env.LAUNCH_REPORT_BNB_RPC_URL = previousBnb
}
const limitStarted = Date.now()
assert.throws(() => calculateLaunchQuote({ venueId: 'pons', metric: 'market_cap', target: 1e12 }, snapshots.get('pons')), /model’s limit|upper limit|supported modeled prices/)
assert(Date.now() - limitStarted < 5000, 'Pathological range searches must not stall the bot')
const automatic = await prepareLaunchQuote({ ...pump, metric: 'market_cap', target: migrated.launchMarketCapUsd })
assert.equal(preparations, 1, 'MC search prepares live inputs once, not per iteration')
assert(Math.abs(automatic.launchMarketCapUsd - migrated.launchMarketCapUsd) < 0.1)
failPreparation = true
await assert.rejects(() => prepareLaunchQuote(pump), /Protocol configuration unavailable/, 'No fallback quote on failed refresh')
for (const [input, value] of [['70%', 70], ['$500k', 500000], ['1m', 1000000], ['garbage', null], ['-1', null]]) assert.equal(parseLaunchNumber(input), value)
console.log('PASS: all 16 venues share LaunchMath calculations, both target modes, frozen live inputs, explicit unsupported-target errors and concise text output.')
