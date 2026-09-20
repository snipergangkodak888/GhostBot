#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { toFunctionSelector } from 'viem'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'

const { refreshSushiTerms, refreshLunchTerms } = loadSource(path.join(projectRoot, 'lib/launch-reports/refresh-evm.ts'))
const { createDefaultRequest } = loadSource(path.join(projectRoot, 'lib/launch-reports/catalog.ts'))
const originalFetch = globalThis.fetch
let mode = 'ok'
let headerReads = 0
const contractCalls = []
const block = '0x123456'
const hash = `0x${'1'.repeat(64)}`
const uintWord = (n) => `0x${BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')}`
const getters = {
  [toFunctionSelector('calculateStartTick(address)')]: uintWord(-200800),
  [toFunctionSelector('protocolReserveBps()')]: uintWord(300),
  [toFunctionSelector('launchFee()')]: uintWord(500000000000000n),
  [toFunctionSelector('launchTickMagnitude()')]: uintWord(204200),
  [toFunctionSelector('launchTick()')]: uintWord(204200),
  [toFunctionSelector('TICK_SPACING()')]: uintWord(200),
}
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://rpc.mainnet.chain.robinhood.com')
  const body = JSON.parse(init.body)
  assert(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_call'].includes(body.method))
  if (mode === 'http-failure') return new Response('', { status: 503 })
  let result
  if (body.method === 'eth_chainId') result = mode === 'wrong-chain' ? '0x1' : '0x1237'
  else if (body.method === 'eth_blockNumber') result = block
  else if (body.method === 'eth_getBlockByNumber') {
    headerReads++
    result = { number: block, hash: mode === 'reorg' && headerReads > 1 ? `0x${'2'.repeat(64)}` : hash, timestamp: `0x${Math.floor(Date.now() / 1000 - (mode === 'stale' ? 3600 : 0)).toString(16)}` }
  } else {
    assert.equal(body.params[1], block)
    contractCalls.push(body.params[0])
    const selector = body.params[0].data.slice(0, 10)
    assert(selector in getters)
    result = getters[selector]
    if (mode === 'bad-word') result = '0x01'
    if (mode === 'changed-spacing' && selector === toFunctionSelector('TICK_SPACING()')) result = uintWord(60)
    if (mode === 'getter-failure') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'unavailable' } }))
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
}

try {
  let checks = 0
  for (const id of ['sushi-launchpad', 'lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards']) {
    headerReads = 0
    const request = createDefaultRequest(id)
    request.operations.setupAmount = '0.123'
    request.terms.buyTaxBps = 77
    const before = JSON.stringify(request)
    const refreshed = await (id === 'sushi-launchpad' ? refreshSushiTerms : refreshLunchTerms)(request)
    assert.equal(JSON.stringify(request), before)
    assert.equal(refreshed.operations.setupAmount, '0.123')
    assert.equal(refreshed.operations.agedWalletUnitAmount, request.operations.agedWalletUnitAmount)
    assert.equal(refreshed.base.supply, '1000000000')
    assert.equal(refreshed.terms._snapshot.blockHash, hash)
    assert.equal(refreshed.terms._snapshot.chainId, 4663)
    assert.equal(headerReads, 2)
    if (id === 'sushi-launchpad') {
      assert.equal(refreshed.terms.plannedStartTick, -200800)
      assert.equal(refreshed.terms.reserveBps, 300)
      assert.equal(refreshed.operations.launchFeeAmount, '0.0005')
    } else {
      assert.equal(refreshed.terms.magnitude, 204200)
      assert.equal(refreshed.operations.launchFeeAmount, '0')
      assert.equal(refreshed.terms.buyTaxBps, id === 'lunch-v3' ? 0 : 77)
      assert.equal(refreshed.terms.tokenOrdering, id === 'lunch-v3' ? 'both' : 'token1')
    }
    checks++
  }
  assert(contractCalls.some((call) => call.to === '0xC783221AB1db0244203458417981B4631E80B988' && call.data === toFunctionSelector('launchTick()')))
  for (const bad of ['wrong-chain', 'stale', 'reorg', 'bad-word', 'http-failure', 'getter-failure', 'changed-spacing']) {
    mode = bad; headerReads = 0
    await assert.rejects(() => refreshLunchTerms(createDefaultRequest('lunch-v4-tax')))
    checks++
  }
  mode = 'ok'; headerReads = 0
  const wrongQuote = createDefaultRequest('sushi-launchpad'); wrongQuote.quote.symbol = 'USDC'
  await assert.rejects(() => refreshSushiTerms(wrongQuote), /native ETH/)
  console.log(`EVM automatic refresh: ${checks + 1} success/failure scenarios passed; no network access.`)
} finally {
  globalThis.fetch = originalFetch
}
