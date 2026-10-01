import assert from 'node:assert/strict'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'
import { prepareCalculatorFixture } from './launch-calculator-fixtures.mjs'
const load = createSourceLoader(), src = path => load(`${projectRoot}/lib/launch-reports/${path}.ts`)
const { decodeQuoteMint, TOKEN_2022, TOKEN_LEGACY } = src('stock-pairs')
const { createDefaultRequest } = src('catalog')
const { calculateLaunchReport } = src('engine')
const { convertNativeOperations } = src('funding')
const { applyStockFunding } = src('stock-funding-math')
const { applyLaunchTax } = src('tax')
const { calculateLaunchQuote, formatLaunchQuote } = load(`${projectRoot}/lib/launch-calculator.ts`)
const { launchMathReviewView, parseLaunchMathCallback, createTelegramLaunchRequest } = src('telegram')
const { renderLaunchReportSvg, launchReportCsv } = src('render')
const { sizeStockFunding } = src('stock-funding')
const id = '9a25b687886d'
function mint(extension, data) {
  const bytes = Buffer.alloc(170 + data.length); bytes[44] = 8; bytes[45] = 1; bytes[165] = 1
  bytes.writeUInt16LE(extension, 166); bytes.writeUInt16LE(data.length, 168); data.copy(bytes, 170)
  return { owner: TOKEN_2022, data: [bytes.toString('base64'), 'base64'] }
}
const fee = Buffer.alloc(108)
fee.writeBigUInt64LE(1n, 72); fee.writeBigUInt64LE(100n, 80); fee.writeUInt16LE(100, 88)
fee.writeBigUInt64LE(10n, 90); fee.writeBigUInt64LE(1000n, 98); fee.writeUInt16LE(300, 106)
assert.deepEqual(decodeQuoteMint(mint(1, fee), 9n).transferFee, {basisPoints:100, maximumFee:'100'})
assert.deepEqual(decodeQuoteMint(mint(1, fee), 10n).transferFee, {basisPoints:300, maximumFee:'1000'})
const paused = Buffer.alloc(33); paused[32] = 1
assert.throws(() => decodeQuoteMint(mint(26, paused), 10n), /paused/)
const hook = Buffer.alloc(64); hook[32] = 1
assert.throws(() => decodeQuoteMint(mint(14, hook), 10n), /transfer hook/)
assert.throws(() => decodeQuoteMint(mint(999, Buffer.alloc(1)), 10n), /does not support/)
assert.equal(decodeQuoteMint(mint(14, Buffer.alloc(64)), 10n).transferFee, undefined)
const legacy = Buffer.alloc(82); legacy[44] = 6; legacy[45] = 1
assert.equal(decodeQuoteMint({owner:TOKEN_LEGACY,data:[legacy.toString('base64'),'base64']}, 10n).decimals, 6)
assert.throws(() => decodeQuoteMint({owner:'wrong',data:[legacy.toString('base64'),'base64']}, 10n), /program/)

for (const modelId of ['pumpfun','pumpfun-custom','stonkfun','launchlab','pons']) {
  for (const taxPercent of [0, ...(modelId.startsWith('pumpfun') ? [3] : [1,3])]) {
    const selection = {modelId, stockQuoteId:id, taxPercent, agedWalletCount:10000}
    for (const b of launchMathReviewView(selection).replyMarkup.inline_keyboard.flat()) {
      assert(Buffer.byteLength(b.callback_data) <= 64)
      const parsed = parseLaunchMathCallback(b.callback_data); assert(parsed, b.callback_data)
      if (parsed.selection) assert.equal(parsed.selection.stockQuoteId,id)
    }
    assert.equal(createTelegramLaunchRequest(selection).stockQuoteId,id)
  }
}
assert.equal(parseLaunchMathCallback('lm:generate:pumpfun:compare:0:125:invalid'), null)
assert.equal(parseLaunchMathCallback(`lm:generate:fourmeme:compare::125:${id}`), null)

const requests = []
for (const modelId of ['pumpfun','stonkfun','pons']) {
  let req = await prepareCalculatorFixture(createDefaultRequest(modelId))
  const native = structuredClone(req.operations), nativePrice = req.quote.usdPrice
  req.stockQuoteId = id
  req.quote = {symbol:'NVDA',decimals:8,address:'fixture',usdPrice:'200',priceAsOf:new Date().toISOString(),priceSource:'Fixture token price'}
  if (modelId === 'pumpfun') req.terms = {initialVirtualQuoteReserves:'1800000000',protocolFeeBps:95,creatorFeeBps:30,migrationFeeRaw:'0',stockPoolFees:{lp:20,protocol:5,creator:5}}
  if (modelId === 'stonkfun') req.terms.totalFundRaisingB = '4300000000'
  if (modelId === 'pons') { req.terms.phantomQuoteWei = '1600000000'; req.terms.graduationThresholdWei = '4000000000' }
  req.operations = convertNativeOperations(native,'NVDA',8,nativePrice,'200')
  req.fundingConversion = {nativeOperations:native,nativeUsdPrice:nativePrice,quoteUsdPrice:'200',asOf:new Date().toISOString(),source:'Fixture'}
  req.injectionLiquidity.quoteUsdPrice = '200'
  req.targetsPct = modelId === 'stonkfun' ? [60,79.31] : [60,83]
  const report = calculateLaunchReport(req)
  assert(report.rows.every(r => r.status === 'ok'), JSON.stringify(report.rows.map(r => r.error)))
  assert.throws(() => renderLaunchReportSvg(report), /live stock funding/)
  assert.throws(() => launchReportCsv(report), /live stock funding/)
  const routes = report.rows.map(r => ({quoteId:id,quoteRaw:r.raw.buys,nativeRaw:native.currencySymbol === 'SOL' ? '10000000000' : '2000000000000000000',minimumOutputRaw:r.raw.buys,gasRaw:'10000',slippageBps:200,treasuryFeeBps:50,asOf:new Date().toISOString(),provider:'Fixture route'}))
  const funded = applyStockFunding(report,routes)
  assert.throws(() => applyStockFunding(report, routes.map(r => ({ ...r, minimumOutputRaw: '1' }))), /does not cover/)
  assert.throws(() => applyStockFunding(report, routes.map(r => ({ ...r, treasuryFeeBps: 0 }))), /does not cover/)
  assert.equal(funded.fundingCurrency.symbol, native.currencySymbol)
  for (const r of funded.rows) {
    assert.equal(r.raw.total, (BigInt(r.raw.funding)+BigInt(r.raw.agedWallets)+BigInt(r.raw.injectionLiquidity)).toString())
    assert.equal(r.amounts.agedWallets, native.currencySymbol === 'SOL' ? '12.5' : '1.25')
    assert.equal(r.totalUsd,null)
  }
  const replay = calculateLaunchReport(funded.request)
  assert.deepEqual(replay.rows.map(r => r.raw),funded.rows.map(r => r.raw),'Frozen export must reproduce identical native totals')
  assert.doesNotMatch(renderLaunchReportSvg(funded), /≈ \$/)
  assert(funded.assumptions.some(a => a.includes(`capital and operating allowances are in ${native.currencySymbol}`)))
  const quote = calculateLaunchQuote({venueId:modelId,stockQuoteId:id,metric:'supply',target:60,mmLiquidity:0}, funded.request)
  assert.equal(quote.lines.find(l => l.key === 'mm').amount,'0')
  assert(formatLaunchQuote(quote).includes(`${native.currencySymbol} total`))
  const mcDraft = structuredClone(req); delete mcDraft.stockFundingQuotes
  const mc = calculateLaunchQuote({venueId:modelId,stockQuoteId:id,metric:'market_cap',target:report.rows[0].fdvUsd},mcDraft)
  assert(Math.abs(mc.supplyControlPct-60)<0.001)
  requests.push(req)
}
const stonk = requests[1]
const untaxed = calculateLaunchReport(stonk)
const taxed = structuredClone(stonk); taxed.terms.quoteTransferFee = {basisPoints:300,maximumFee:'10'}
const report = calculateLaunchReport(taxed)
assert.equal(report.rows[0].raw.buys, (BigInt(untaxed.rows[0].raw.buys)+10n*BigInt(stonk.operations.buyerCount)).toString(),'Quote tax must respect the cap on every wallet transfer')
assert.equal(report.rows[0].fdvUsd,untaxed.rows[0].fdvUsd,'Quote tax changes funding, not received supply or curve state')
const both = applyLaunchTax(taxed,3); both.targetsPct=[60]
assert.equal(calculateLaunchReport(both).rows[0].actualPct,60,'Quote tax and launched-token tax are independent')
const nativeFetch = globalThis.fetch
try {
  let calls = 0
  globalThis.fetch = async url => {
    calls++
    const p = new URL(url).searchParams, input = p.get('amount')
    // First sizing suffers price impact; a second quote must cover the actual need.
    const out = calls === 1 ? 80_000_000n : 110_000_000n
    return Response.json({inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:input,outAmount:out.toString(),routePlan:[{}]})
  }
  const req = {...requests[0],quote:{...requests[0].quote,address:'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'}}
  const route = await sizeStockFunding(req,100_000_000n)
  assert.equal(calls,2)
  assert(BigInt(route.minimumOutputRaw)>=100_000_000n)
  globalThis.fetch = async () => Response.json({inputMint:'WRONG', outAmount:'999999999999999999999',routePlan:[{}]})
  await assert.rejects(() => sizeStockFunding(req,100_000_000n), /No SOL funding route/)
} finally { globalThis.fetch = nativeFetch }
console.log('PASS stock pairs: RPC epoch tax/caps and mint restrictions; all callbacks; curve + migration in 8-decimal quotes; both MC/supply targets; native budgets and frozen replay; tax composition; funding price-impact rechecks and mismatched-route rejection.')
