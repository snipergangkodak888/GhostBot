import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'
import { toFunctionSelector } from 'viem'
const { createDefaultRequest } = loadSource(`${projectRoot}/lib/launch-reports/catalog.ts`)
const { refreshLaunchTerms } = loadSource(`${projectRoot}/lib/launch-reports/refresh.ts`)
const { calculateLaunchReport } = loadSource(`${projectRoot}/lib/launch-reports/engine.ts`)
const originalFetch = globalThis.fetch
let checks = 0
try {
  for (const model of ['letscash', 'pools-instant', 'flap']) {
    const fixture = JSON.parse(readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/${model}-rpc.json`, 'utf8'))
    let failure = '', headers = 0
    globalThis.fetch = async (url, options) => {
      const query = JSON.parse(options.body)
      assert(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_call', 'eth_getLogs'].includes(query.method))
      const match = fixture.find(item => item.url === url && item.request.method === query.method && JSON.stringify(item.request.params) === JSON.stringify(query.params))
      assert(match, `Unexpected public read: ${model} ${JSON.stringify(query)}`)
      const reply = structuredClone(match.response)
      if (query.method === 'eth_getBlockByNumber') {
        reply.result.timestamp = `0x${Math.floor(Date.now() / 1000 - (failure === 'stale' ? 3600 : 0)).toString(16)}`
        if (failure === 'reorg' && ++headers > 1) reply.result.hash = `0x${'f'.repeat(64)}`
      }
      if (failure === 'wrong-chain' && query.method === 'eth_chainId') reply.result = '0x1'
      if (query.method === 'eth_call') {
        if (failure === 'shape') reply.result = '0x01'
        if (failure === 'disabled' && query.params[0].data === toFunctionSelector('launchEnabled()')) reply.result = `0x${'0'.repeat(64)}`
        if (failure === 'pool-fee' && query.params[0].data === toFunctionSelector('LP_FEE()')) reply.result = `0x${(3000n).toString(16).padStart(64, '0')}`
        if (failure === 'curve-config' && query.params[0].data.startsWith(toFunctionSelector('getQuoteTokenConfiguration(address)'))) reply.result = reply.result.slice(0, 2 + 64) + (19n).toString(16).padStart(64, '0') + reply.result.slice(2 + 128)
      }
      return Response.json(reply)
    }
    const request = createDefaultRequest(model), before = JSON.stringify(request)
    const resolved = await refreshLaunchTerms(request)
    assert.equal(JSON.stringify(request), before)
    assert.equal(resolved.operations.agedWalletUnitAmount, request.operations.agedWalletUnitAmount)
    assert.equal(resolved.operations.setupAmount, request.operations.setupAmount)
    assert.equal(resolved.termsSource.kind, 'snapshot')
    assert(resolved.terms._snapshot.blockHash)
    assert(calculateLaunchReport(resolved).rows.every(row => row.status === 'ok'))
    checks += 6
    for (const mode of ['wrong-chain', 'stale', 'shape', 'reorg', model === 'letscash' ? 'disabled' : model === 'pools-instant' ? 'pool-fee' : 'curve-config']) {
      failure = mode; headers = 0
      await assert.rejects(() => refreshLaunchTerms(request), undefined, `${model} ${mode} must fail closed`)
      checks++
    }
  }
} finally { globalThis.fetch = originalFetch }
console.log(`Native EVM automatic settings: ${checks} checks passed (LetsCash, Pools Instant, Flap; pinned reads, unchanged Ghost prices, stale/invalid/changed-chain rejection).`)
