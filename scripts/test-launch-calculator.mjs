import assert from 'node:assert/strict'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'
const load=createSourceLoader()
const {calculateLaunchQuote,formatLaunchQuote,parseLaunchNumber,getLaunchAssetPrice}=load(`${projectRoot}/lib/launch-calculator.ts`)
const {LAUNCH_PADS}=load(`${projectRoot}/lib/launch-math.ts`)
const unit={SOL:0.1,ETH:0.01,BNB:0.02}
for(const pad of LAUNCH_PADS){
 const input={venueId:pad.id,metric:'supply',target:60,assetPriceUsd:pad.fallbackUsd,...(pad.type==='amm'?{initialLp:pad.defaultLp}:{})}
 const supply=calculateLaunchQuote(input)
 assert.equal(supply.lines.find(line=>line.key==='aged').amount,125*unit[pad.symbol])
 assert.equal(supply.capitalTotal,supply.lines.reduce((sum,line)=>sum+line.amount,0))
 assert.match(formatLaunchQuote(supply),/Capital requirement:.*supply control.*launch MC/s)
 const mc=calculateLaunchQuote({...input,metric:'market_cap',target:supply.launchMarketCapUsd})
 assert(Math.abs(mc.supplyControlPct-60)<0.0001,`${pad.id} MC inverse must recover supply control`)
 assert(Math.abs(mc.launchMarketCapUsd-supply.launchMarketCapUsd)<0.01)
 const custom=calculateLaunchQuote({...input,agedWalletCount:100,mmLiquidity:0})
 assert.equal(custom.lines.find(line=>line.key==='aged').amount,100*unit[pad.symbol])
 assert.equal(custom.lines.find(line=>line.key==='mm').amount,0)
}
const pump={venueId:'pumpfun',metric:'supply',target:90,assetPriceUsd:100}
const migrated=calculateLaunchQuote(pump)
assert(migrated.lines.some(line=>line.key==='migration'))
const roundTrip=calculateLaunchQuote({...pump,metric:'market_cap',target:migrated.launchMarketCapUsd})
assert(Math.abs(roundTrip.supplyControlPct-90)<0.0001)
for(const change of [{target:100},{target:Infinity},{target:NaN},{assetPriceUsd:Infinity},{assetPriceUsd:0},{mmLiquidity:Infinity},{mmLiquidity:-1},{agedWalletCount:-1},{agedWalletCount:1.5},{metric:'bad'}])assert.throws(()=>calculateLaunchQuote({...pump,...change}))
for(const [input,value] of [['70%',70],['$500k',500000],['1m',1000000],['garbage',null],['-1',null]])assert.equal(parseLaunchNumber(input),value)
const originalFetch=globalThis.fetch
try{
 globalThis.fetch=async()=>Response.json({data:{amount:'150.25'}})
 assert.equal((await getLaunchAssetPrice(LAUNCH_PADS[0])).price,150.25)
 globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503})
 await assert.rejects(()=>getLaunchAssetPrice(LAUNCH_PADS[0]),/no estimate was generated/)
}finally{globalThis.fetch=originalFetch}
console.log(`PASS: text capital quotes for ${LAUNCH_PADS.length} venues, both target modes, exact wallet budgets, custom counts/reserves, Pump migration, invalid inputs and live-price failure.`)
