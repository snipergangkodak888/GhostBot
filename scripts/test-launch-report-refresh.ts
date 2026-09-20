import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createDefaultRequest } from '../lib/launch-reports/catalog'
import { calculateLaunchReport } from '../lib/launch-reports/engine'
import { decodePumpFeeTiers, decodePumpGlobal, decodeStonkFees, refreshLaunchTerms } from '../lib/launch-reports/refresh'
import { toFunctionSelector } from 'viem'
import { prepareLaunchReport } from '../lib/launch-reports/prepare'

export async function testRefresh() {
  const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), 'scripts/fixtures/launch-reports', name), 'utf8'))
  const pump = fixture('pump-accounts.json'), stonk = fixture('stonk-accounts.json'), pricing = fixture('stonk-pricing.json'), raydium = fixture('raydium-configs.json')
  const usdc = fixture('pump-usdc-accounts.json')
  const tiers = decodePumpFeeTiers(pump.result.value[0])
  assert.equal(tiers.length, 25)
  assert.deepEqual(tiers[0], { thresholdRaw: '0', lpFeeBps: 2, protocolFeeBps: 93, creatorFeeBps: 30 })
  assert.deepEqual(tiers[1], { thresholdRaw: '420000000000', lpFeeBps: 20, protocolFeeBps: 5, creatorFeeBps: 95 })
  assert.equal(decodePumpGlobal(pump.result.value[2]).migrationFeeRaw, 15000001n)
  assert.equal(decodePumpFeeTiers(usdc.result.value[0], 'stable')[1].thresholdRaw, '59000000000')
  assert.deepEqual(decodeStonkFees(stonk.result.value[0], stonk.result.value[1]), { migrateFee: '0', tradeFeeRate: '2500', platformFeeRate: '10000', creatorFeeRate: '0' })
  assert.throws(() => decodePumpGlobal({ ...pump.result.value[2], owner: 'wrong-program' }), /owner/)
  const badShape = structuredClone(pump.result.value[2]), raw = Buffer.from(badShape.data[0], 'base64'); raw.writeBigUInt64LE(100n, 89); badShape.data[0] = raw.toString('base64')
  assert.throws(() => decodePumpGlobal(badShape), /shape changed/)
  const savedFetch = globalThis.fetch
  const urls: string[] = []
  try {
    globalThis.fetch = async (input, options) => {
      const url = String(input); urls.push(url)
      if (url.includes('coinbase.com')) return Response.json({ data: { amount: url.includes('SOL-USD') ? '100' : '1' } })
      if (url.includes('cpmm-config')) return Response.json(raydium)
      if (url.includes('stonkfun.xyz')) return Response.json(pricing)
      const request = JSON.parse(String(options?.body))
      assert.equal(request.method, 'getMultipleAccounts')
      assert.equal(request.params[1].commitment, 'finalized')
      return Response.json(request.params[0].length === 4 ? usdc : request.params[0].length === 3 ? pump : { ...stonk, result: { ...stonk.result, value: stonk.result.value.slice(0, 2) } })
    }
    for (const id of ['pumpfun', 'stonkfun', 'raydium-cpmm']) {
      const input = createDefaultRequest(id), before = JSON.stringify(input)
      const refreshed = await refreshLaunchTerms(input)
      assert.equal(JSON.stringify(input), before, 'Refresh must not mutate the saved scenario')
      assert.equal(refreshed.operations.agedWalletUnitAmount, input.operations.agedWalletUnitAmount)
      assert.equal(refreshed.operations.buyerGasAmount, input.operations.buyerGasAmount)
      assert(refreshed.termsSource?.asOf)
      assert(refreshed.terms._snapshot)
      assert(calculateLaunchReport(refreshed).rows.every(row => row.status === 'ok'))
    }
    assert(urls.every(url => ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com', 'https://api-v3.raydium.io/main/cpmm-config', 'https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=So11111111111111111111111111111111111111112&mode=standard'].includes(url)))
    const usdcInput = createDefaultRequest('pumpfun-custom'); usdcInput.targetsPct = [50, 79.3, 79.31, 80, 90]
    const usdcBefore = JSON.stringify(usdcInput), usdcPrepared = await prepareLaunchReport(usdcInput)
    assert.equal(JSON.stringify(usdcInput), usdcBefore)
    assert.equal(usdcPrepared.terms.initialVirtualQuoteReserves, '4292000000')
    assert.equal(usdcPrepared.operations.currencySymbol, 'USDC')
    assert.equal(usdcPrepared.operations.agedWalletCount, 125)
    assert.equal(usdcPrepared.operations.agedWalletUnitAmount, '10')
    assert.equal(usdcPrepared.terms.nativeMigrationFundingQuoteRaw, '1500001')
    const usdcReport = calculateLaunchReport(usdcPrepared)
    assert(usdcReport.rows.every(row => row.status === 'ok'))
    assert(usdcReport.rows.every(row => row.amounts!.agedWallets === '1250'))
    assert.deepEqual(usdcReport.rows.map(row => row.raw!.modelReserves), ['0', '0', '1500001', '1500001', '1500001'])
    const repeated = await prepareLaunchReport(usdcPrepared)
    assert.deepEqual(repeated.operations, usdcPrepared.operations, 'Preparing an already converted report must not convert costs twice')
    const missingConversion = structuredClone(usdcPrepared); delete missingConversion.terms.nativeMigrationFundingQuoteRaw
    assert(calculateLaunchReport(missingConversion).rows.slice(2).every(row => row.status === 'unavailable'))
    const unsupportedQuote = structuredClone(usdcPrepared); unsupportedQuote.terms.mint = 'unsupported'
    await assert.rejects(() => refreshLaunchTerms(unsupportedQuote), /USDC/)
    for (const [accountIndex, offset, length] of [[2, 1013, 32], [3, 44, 1]] as const) {
      const account = usdc.result.value[accountIndex], original = account.data[0]
      const bytes = Buffer.from(original, 'base64'); bytes.fill(0, offset, offset + length); account.data[0] = bytes.toString('base64')
      await assert.rejects(() => refreshLaunchTerms(usdcPrepared), /registry|decimals/)
      account.data[0] = original
    }
    const rayConfig = raydium.data.find((value: { index: number }) => value.index === 0), oldCreationFee = rayConfig.createPoolFee
    delete rayConfig.createPoolFee
    await assert.rejects(() => refreshLaunchTerms(createDefaultRequest('raydium-cpmm')), /creation fee/)
    rayConfig.createPoolFee = oldCreationFee
    const reward = createDefaultRequest('stonkfun'); reward.terms.transferFee = { basisPoints: 300, maximumFee: '1000' }
    await assert.rejects(() => refreshLaunchTerms(reward), /untaxed/)
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 })
    await assert.rejects(() => refreshLaunchTerms(createDefaultRequest('pumpfun')), /HTTP 503/)
    await assert.rejects(() => refreshLaunchTerms(createDefaultRequest('uniswap-v2')), /not available/)
    const pons = fixture('pons-config.json'), blockHash = `0x${'1'.repeat(64)}`
    let mode = 'ok', pinnedCalls = 0
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://rpc.mainnet.chain.robinhood.com')
      const body = JSON.parse(String(options?.body)); let result: unknown
      assert(!/send|sign|transaction/i.test(body.method))
      if (body.method === 'eth_chainId') result = mode === 'wrong-chain' ? '0x1' : '0x1237'
      else if (body.method === 'eth_blockNumber') result = pons.block
      else if (body.method === 'eth_getBlockByNumber') result = { number: pons.block, hash: blockHash, timestamp: `0x${Math.floor(Date.now() / 1000 - (mode === 'stale' ? 3600 : 0)).toString(16)}` }
      else if (body.method === 'eth_call') {
        assert.equal(body.params[1], pons.block); pinnedCalls++
        const data = body.params[0].data
        if (data.startsWith(toFunctionSelector('getLaunchConfig(uint256)'))) result = mode === 'disabled' ? pons.configRaw.slice(0, -1) + '0' : mode === 'bad-config' ? '0x01' : pons.configRaw
        else if (data === toFunctionSelector('launchFee()')) result = pons.launchFeeRaw
        else if (data === toFunctionSelector('hookFeeBps()')) result = `0x${BigInt(pons.hookFeeBps).toString(16).padStart(64, '0')}`
        else throw new Error('Unexpected contract selector')
      } else throw new Error('Unexpected RPC method')
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    }
    const ponsInput = createDefaultRequest('pons'); ponsInput.terms.creatorTaxBps = 777; ponsInput.operations.setupAmount = '0.123'
    const untouched = JSON.stringify(ponsInput), refreshedPons = await refreshLaunchTerms(ponsInput)
    assert.equal(JSON.stringify(ponsInput), untouched)
    assert.equal(refreshedPons.terms.creatorTaxBps, 777)
    assert.equal(refreshedPons.operations.setupAmount, '0.123')
    assert.equal(refreshedPons.operations.agedWalletUnitAmount, '0.10')
    assert.equal(refreshedPons.operations.launchFeeAmount, '0.0005')
    assert.equal((refreshedPons.terms._snapshot as Record<string, unknown>).blockHash, blockHash)
    assert.equal(pinnedCalls, 3)
    for (const failure of ['wrong-chain', 'disabled', 'bad-config', 'stale']) { mode = failure; await assert.rejects(() => refreshLaunchTerms(ponsInput)) }
  } finally { globalThis.fetch = savedFetch }
  console.log('Launch refresh fixtures passed: Pump SOL/USDC registry and fee schedules, native funding conversion, Stonkfun API/program accounts, Raydium creation fees, Pons block-pinned RPC, provenance, no mutation, and fail-closed errors.')
}
