// Optional reference-only tool. Install @meteora-ag/cp-amm-sdk@1.5.1 in a temp
// directory and set METEORA_REFERENCE_MODULES to that directory's node_modules.
const path = require('node:path')
const modules = process.env.METEORA_REFERENCE_MODULES
if (!modules) throw new Error('Set METEORA_REFERENCE_MODULES to the reference node_modules directory')
const sdkPath = path.join(modules, '@meteora-ag/cp-amm-sdk')
if (require(path.join(sdkPath, 'package.json')).version !== '1.5.1') throw new Error('Use SDK 1.5.1 for these pinned fixtures')
const sdk = require(sdkPath)
const BN = require(path.join(modules, 'bn.js'))
const fs = require('node:fs')
const vectors=[]
for (const [symbol,decimals,lp] of [['SOL',9,'25'],['USDC',6,'2500'],['USDC',6,'50000']]) {
 for (const [feeBps,count,control] of [[1,1,30],[100,25,67.37],[500,1,90],[500,64,90],[9900,32,70]]) {
  const base=new BN('700000000000000'), quote=new BN(lp).mul(new BN(10).pow(new BN(decimals)))
  let price=sdk.calculateInitSqrtPrice(base,quote,sdk.MIN_SQRT_PRICE,sdk.MAX_SQRT_PRICE)
  const la=sdk.getLiquidityDeltaFromAmountAForConcentratedLiquidity(base,price,sdk.MAX_SQRT_PRICE)
  const lb=sdk.getLiquidityDeltaFromAmountBForConcentratedLiquidity(quote,sdk.MIN_SQRT_PRICE,price)
  const liquidity=BN.min(la,lb), initialSqrtPrice=price.toString()
  const initialQuote=sdk.getAmountBFromLiquidityDeltaForConcentratedLiquidity(sdk.MIN_SQRT_PRICE,price,liquidity,sdk.Rounding.Up)
  const target=BigInt(Math.round(control*1e6))*1000000000000000n/100000000n-300000000000000n
  let total=new BN(0)
  for(let i=0;i<count;i++) {
   const amount=target/BigInt(count)+(BigInt(i)<target%BigInt(count)?1n:0n)
   if(!amount)continue
   const result=sdk.calculateBtoAFromAmountOutForConcentratedLiquidity(sdk.MAX_SQRT_PRICE,price,liquidity,new BN(amount.toString()))
   const fee=sdk.getIncludedFeeAmount(new BN(feeBps*100000),result.inputAmount)
   total=total.add(fee.includedFeeAmount);price=result.nextSqrtPrice
  }
  vectors.push({symbol,decimals,lp,feeBps,count,control,initialSqrtPrice,liquidity:liquidity.toString(),initialQuote:initialQuote.toString(),buyRaw:total.toString(),finalSqrtPrice:price.toString(),mcQuote:(Number(price)/2**64)**2*1e15/10**decimals})
 }
}
fs.writeFileSync(path.join(__dirname, 'fixtures/launch-reports/meteora-sdk.json'),JSON.stringify({sdk:'@meteora-ag/cp-amm-sdk@1.5.1',source:'79ebbfe59a225e641a2f37cd03404f26de1b0c8e',feeMode:sdk.getFeeMode(sdk.CollectFeeMode.OnlyB,sdk.TradeDirection.BtoA,false),vectors},null,2)+'\n')
console.log('Saved',vectors.length,'independent SDK cases')
