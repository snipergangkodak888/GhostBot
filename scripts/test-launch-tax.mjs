import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSourceLoader, loadSource, projectRoot } from './launch-report-runtime.mjs'
import { prepareCalculatorFixture } from './launch-calculator-fixtures.mjs'
const load = file => loadSource(`${projectRoot}/lib/${file}.ts`)
const { createDefaultRequest } = load('launch-reports/catalog')
const { applyLaunchTax, launchTaxPercent, launchTaxTargets } = load('launch-reports/tax')
const { calculateLaunchReport } = load('launch-reports/engine')
const { calculateLaunchQuote, formatLaunchQuote } = load('launch-calculator')
const flow = load('launch-reports/telegram')
const { launchReportFootnotes } = load('launch-reports/client-summary')
const input = { venueId: 'pons', metric: 'supply', target: 82.97 }
const pons = await prepareCalculatorFixture(createDefaultRequest('pons'))
pons.quote.usdPrice = '2685.65'
pons.injectionLiquidity.referenceUsdPrice = pons.injectionLiquidity.quoteUsdPrice = '2685.65'
const before = structuredClone(pons), quote = calculateLaunchQuote(input, pons)
const row = quote.report.rows[0]
// Independent reconciliation of the user's Sumo screenshot, using exact 82.97%.
assert.equal(row.raw.buys, '9838169524776352100')
assert.equal(row.amounts.operations, '0.4405')
assert.equal(row.amounts.funding, '10.2786695247763521')
assert(Math.abs(row.fdvUsd - 300656.89691433444) < 0.00001)
assert.deepEqual(row.details.count, { curve: 32, pool: 2 })
assert.equal(calculateLaunchQuote({ ...input, target: 70 }, pons).report.rows[0].amounts.operations, '0.4205', 'Curve-only quotes fund only 32 buyers')
for (const taxPercent of [0, 1, 2.5, 10]) {
  const selected = applyLaunchTax(pons, taxPercent)
  const direct = calculateLaunchQuote({ ...input, taxPercent }, selected)
  assert.equal(launchTaxPercent(direct.report.request), taxPercent)
  assert.equal(direct.lines.reduce((sum,line)=>sum+BigInt(line.raw),0n).toString(), direct.capitalTotalRaw)
  const inverse = calculateLaunchQuote({ ...input, metric: 'market_cap', target: direct.launchMarketCapUsd, taxPercent }, selected)
  assert(Math.abs(inverse.supplyControlPct - input.target) < 0.00001)
  assert.match(formatLaunchQuote(direct), new RegExp(`Creator tax: ${taxPercent}%`))
  if (taxPercent > 0) assert(BigInt(direct.capitalTotalRaw) > BigInt(quote.capitalTotalRaw))
}
assert.deepEqual(pons,before)
for (const percent of [-1,10.01,0.001,NaN,Infinity]) assert.throws(()=>applyLaunchTax(pons,percent))
assert.throws(()=>applyLaunchTax(createDefaultRequest('pumpfun'),1),/does not offer/)
for (const modelId of ['stonkfun','launchlab']) for (const taxPercent of [0,1,3]) {
  const draft=flow.createTelegramLaunchRequest({modelId,taxPercent}), untouched=structuredClone(draft)
  const prepared=await prepareCalculatorFixture(draft)
  assert.deepEqual(draft,untouched)
  assert.equal(launchTaxPercent(prepared),taxPercent,'Live refresh must preserve the selection')
  assert.equal(prepared.terms._snapshot.accounts[1],taxPercent?'6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt':'4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7')
  const report=calculateLaunchReport(prepared)
  assert(report.rows.every(row=>row.status==='ok'),JSON.stringify(report.rows.filter(row=>row.status!=='ok')))
  const at70=calculateLaunchQuote({venueId:modelId,metric:'supply',target:70,taxPercent},prepared)
  const inverse=calculateLaunchQuote({venueId:modelId,metric:'market_cap',target:at70.launchMarketCapUsd,taxPercent},prepared)
  assert(Math.abs(inverse.supplyControlPct-70)<0.00001)
  assert.match(launchReportFootnotes(report)[0],new RegExp(`Holder tax: ${taxPercent}%`))
  if(taxPercent) {
    assert(prepared.targetsPct.at(-1)<79.31)
    const fees=at70.report.rows[0].details.buys.reduce((sum,buy)=>sum+BigInt(buy.transferFeeRaw),0n)
    assert(fees>0n,'Token withholding must be modeled, not added as an unrelated SOL percentage')
    assert.throws(()=>calculateLaunchQuote({venueId:modelId,metric:'supply',target:79.31,taxPercent},prepared),/curve|transfer/)
    assert.throws(()=>calculateLaunchQuote({venueId:modelId,metric:'supply',target:70,taxPercent:0},prepared),/Refresh/)
  }
  const rendered=flow.renderTelegramLaunchReport(report,{modelId,taxPercent})
  assert(rendered.png.length<10000000)
  assert.match(rendered.caption,new RegExp(`Holder tax: ${taxPercent}%`))
  for(const button of rendered.replyMarkup.inline_keyboard.flat()) assert(flow.parseLaunchMathCallback(button.callback_data))
}
assert.throws(()=>applyLaunchTax(createDefaultRequest('stonkfun'),2),/Choose 0%/)
for(const data of ['lm:review:pons:compare:10.01','lm:review:pons:compare:-1','lm:review:pons:compare:0.001','lm:review:stonkfun:compare:2','lm:review:pumpfun:compare:1','lm:tax:stonkfun:compare:1']) assert.equal(flow.parseLaunchMathCallback(data),null,data)
assert.equal(flow.parseLaunchMathCallback('lm:generate:pons:compare:2.5').selection.taxPercent,2.5)
assert.equal(flow.parseLaunchMathCallback('lm:review:pons:compare').selection.taxPercent,undefined,'Existing buttons still work')
// Retired rates, wrong reward platform and unverified fee caps must fail closed.
const pricing=JSON.parse(readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/stonk-reward-pricing.json`,'utf8'))
const accounts=JSON.parse(readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/stonk-reward-accounts.json`,'utf8'))
const refresher=createSourceLoader({ './solana-data':{readSolanaLaunchAccounts:async()=>({...accounts.result,rpc:'fixture',observedAt:new Date().toISOString()})} })(`${projectRoot}/lib/launch-reports/refresh.ts`)
const oldFetch=globalThis.fetch
try {
  globalThis.fetch=async()=>Response.json(pricing)
  const draft=applyLaunchTax(createDefaultRequest('stonkfun'),3)
  const retired=structuredClone(pricing.data.modes.reward.transferFeeBps)
  pricing.data.modes.reward.transferFeeBps=[100]
  await assert.rejects(()=>refresher.refreshLaunchTerms(draft),/no longer offers/)
  pricing.data.modes.reward.transferFeeBps=retired
  const platform=pricing.data.platform.reward;pricing.data.platform.reward='wrong'
  await assert.rejects(()=>refresher.refreshLaunchTerms(draft),/identity/)
  pricing.data.platform.reward=platform
  draft.terms.transferFee.maximumFee='1000'
  await assert.rejects(()=>refresher.refreshLaunchTerms(draft),/cap/)
} finally {globalThis.fetch=oldFetch}
console.log('PASS: Sumo Pons regression, phase-specific buyer funding, Pons 0–10% and Stonkfun 0/1/3% tax, both target modes, taxed supply limits, live reward platform, PNG/callback persistence and rejected stale/tampered tax settings.')
