import assert from 'node:assert/strict'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'
import { prepareCalculatorFixture } from './launch-calculator-fixtures.mjs'
const load = createSourceLoader(), src = p => load(`${projectRoot}/lib/launch-reports/${p}.ts`)
const {calculateLaunchQuote,calculateStockBudgetQuote,formatLaunchQuote} = load(`${projectRoot}/lib/launch-calculator.ts`)
const {createDefaultRequest,getModelCatalog}=src('catalog')
const {applyLaunchTax}=src('tax')
const {convertNativeOperations}=src('funding')
const snapshots=new Map()
for (const venue of getModelCatalog()) {
 const req=await prepareCalculatorFixture(createDefaultRequest(venue.id));snapshots.set(venue.id,req)
 const input={venueId:venue.id,metric:'supply',target:67.37,...(venue.requiresLiquidity?{initialLp:Number(req.liquidityAmounts[0])}:{})}
 const direct=calculateLaunchQuote(input,req)
 const target=Math.ceil(Number(direct.capitalTotal)*Number(req.quote.usdPrice)*100)/100
 const before=structuredClone(req), q=calculateLaunchQuote({...input,metric:'budget',target},req)
 assert(BigInt(q.capitalTotalRaw)<=BigInt(q.budget.currencyRaw),venue.id+' must stay under budget')
 assert.equal(q.capitalTotalRaw,q.lines.reduce((a,l)=>a+BigInt(l.raw),0n).toString())
 assert(q.supplyControlPct>=67.37&&q.supplyControlPct<67.4,venue.id+' budget round trip '+q.supplyControlPct)
 assert(q.budget.unusedUsd<0.1,venue.id+' should allocate remaining funds')
 assert.match(formatLaunchQuote(q),/Total budget:.*\$[\s\S]*supply control/)
 assert.deepEqual(req,before,'Budget search must not mutate the prepared snapshot')
 assert.throws(()=>calculateLaunchQuote({...input,metric:'budget',target:1},req),/budget is too low|No supply purchase/)
 console.log('PASS '+venue.id+' budget round trip, fixed costs, ceiling, too-low budget and immutable settings')
}
const req=snapshots.get('pumpfun'), input={venueId:'pumpfun',metric:'budget',target:20000}
const pump=calculateLaunchQuote(input,req)
assert.equal(pump.lines.find(l=>l.key==='aged').amount,'12.5')
assert.equal(pump.lines.find(l=>l.key==='mm').amount,'30')
assert.equal(pump.budget.currencyRaw,'200000000000')
assert(pump.budget.unusedUsd<0.01)
const fewer=calculateLaunchQuote({...input,agedWalletCount:50},req)
const moreMm=calculateLaunchQuote({...input,mmLiquidity:60},req)
assert(fewer.supplyControlPct>pump.supplyControlPct)
assert(moreMm.supplyControlPct<pump.supplyControlPct)
assert.equal(moreMm.lines.find(l=>l.key==='mm').amount,'60')
const bigger=calculateLaunchQuote({...input,target:100000},req)
assert(bigger.launchMarketCapUsd>500000)
assert(Number(bigger.lines.find(l=>l.key==='mm').amount)>30,'MM scales with the solved MC')
assert(BigInt(bigger.capitalTotalRaw)<=BigInt(bigger.budget.currencyRaw))
for(const [venueId,tax,target] of [['stonkfun',3,15000],['pons',2.5,20000]]){
 const taxed=await prepareCalculatorFixture(applyLaunchTax(createDefaultRequest(venueId),tax))
 const quote=calculateLaunchQuote({venueId,metric:'budget',target,taxPercent:tax},taxed)
 assert(BigInt(quote.capitalTotalRaw)<=BigInt(quote.budget.currencyRaw))
 assert.equal(quote.report.request.operations.agedWalletCount,125)
}
const capped=calculateLaunchQuote({venueId:'stonkfun',metric:'budget',target:100000},snapshots.get('stonkfun'))
assert(capped.supplyControlPct<=79.31)
assert(capped.budget.unusedUsd>80000)
assert.match(formatLaunchQuote(capped),/Unused budget/)
const stock=structuredClone(req), native=structuredClone(stock.operations)
stock.stockQuoteId='9a25b687886d'
stock.quote={symbol:'NVDAx',decimals:8,address:'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',usdPrice:'200',priceAsOf:new Date().toISOString(),priceSource:'Fixture'}
stock.terms={initialVirtualQuoteReserves:'1800000000',protocolFeeBps:95,creatorFeeBps:30,migrationFeeRaw:'0',stockPoolFees:{lp:20,protocol:5,creator:5}}
stock.operations=convertNativeOperations(native,'NVDAx',8,'100','200')
stock.fundingConversion={nativeOperations:native,nativeUsdPrice:'100',quoteUsdPrice:'200',asOf:new Date().toISOString(),source:'Fixture'}
stock.injectionLiquidity.quoteUsdPrice='200'
const fetch=globalThis.fetch
try{
 let calls=0
 globalThis.fetch=async url=>{
  const p=new URL(url).searchParams, amount=p.get('amount');assert(amount,'Only read-only swap quotes may be requested');calls++
  // Worse than the reference FX: the live route, not spot conversion, must fund the plan.
  const input=BigInt(amount), output=input*45n/1000n
  return Response.json({inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:amount,outAmount:output.toString(),routePlan:[{}]})
 }
 const q=await calculateStockBudgetQuote({...input,stockQuoteId:stock.stockQuoteId},stock)
 assert.equal(q.report.fundingCurrency.symbol,'SOL')
 assert(BigInt(q.capitalTotalRaw)<=BigInt(q.budget.currencyRaw))
 assert(q.budget.unusedUsd<2)
 assert(q.report.request.stockFundingQuotes.every(q=>q.provider==='Jupiter Swap V2'),'Never return internal sizing rates as real quotes')
 assert(calls<20,'Stock budget should not make a swap request per supply-search step')
 globalThis.fetch=async()=>{throw new Error('Fixture route unavailable')}
 await assert.rejects(()=>calculateStockBudgetQuote({...input,stockQuoteId:stock.stockQuoteId},stock),/unavailable/)
}finally{globalThis.fetch=fetch}
console.log('PASS total budgets: $20k Pump, MM scaling, wallet/MM edits, taxes, capped inventory, stock-route verification, and route failures')
