// Deterministic preparation through the real refreshers, with recorded public reads.
// This helper never falls through to the network; use sequentially in tests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toFunctionSelector } from 'viem'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'
const fixture = name => JSON.parse(readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/${name}.json`, 'utf8'))
const { prepareLaunchReport } = loadSource(`${projectRoot}/lib/launch-reports/prepare.ts`)
const word = n => `0x${BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')}`
const getters = Object.fromEntries(Object.entries({
  'calculateStartTick(address)': -200800, 'protocolReserveBps()': 300,
  'launchFee()': 500000000000000n, 'launchTickMagnitude()': 204200,
  'launchTick()': 204200, 'TICK_SPACING()': 200,
}).map(([key, value]) => [toFunctionSelector(key), word(value)]))
export async function prepareCalculatorFixture(request) {
  const oldFetch = globalThis.fetch, model = request.modelId
  globalThis.fetch = async (url, options) => {
    url = String(url)
    if (url.includes('coinbase.com')) {
      const symbol = /prices\/(\w+)-USD/.exec(url)[1]
      return Response.json({ data: { amount: { SOL: '100', ETH: '2000', BNB: '600', USDC: '1' }[symbol] } })
    }
    if (url.includes('cpmm-config')) return Response.json(fixture('raydium-configs'))
    if (url.includes('stonkfun.xyz')) return Response.json(fixture('stonk-pricing'))
    const body = JSON.parse(options.body)
    if (body.method === 'getMultipleAccounts') {
      const count = body.params[0].length
      const payload = fixture(count === 4 ? 'pump-usdc-accounts' : count === 3 ? 'pump-accounts' : 'stonk-accounts')
      payload.result.value = payload.result.value.slice(0, count)
      return Response.json(payload)
    }
    if (['letscash', 'pools-instant', 'flap', 'fourmeme'].includes(model)) {
      const records = fixture(model === 'fourmeme' ? 'four-native-rpc' : `${model}-rpc`)
      const record = records.find(item => { const query = item.request || item.payload; return query.method === body.method && JSON.stringify(query.params) === JSON.stringify(body.params) })
      assert(record, `Unexpected ${model} fixture read: ${body.method}`)
      const payload = structuredClone(record.response)
      payload.id = body.id
      if (body.method === 'eth_getBlockByNumber') payload.result.timestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`
      return Response.json(payload)
    }
    const pons = model === 'pons' ? fixture('pons-config') : null, block = pons?.block || '0x123456'
    let result
    if (body.method === 'eth_chainId') result = '0x1237'
    else if (body.method === 'eth_blockNumber') result = block
    else if (body.method === 'eth_getBlockByNumber') result = { number: block, hash: `0x${'1'.repeat(64)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` }
    else if (body.method === 'eth_call') {
      const selector = body.params[0].data.slice(0, 10)
      result = pons && selector === toFunctionSelector('getLaunchConfig(uint256)') ? pons.configRaw
        : pons && selector === toFunctionSelector('hookFeeBps()') ? word(pons.hookFeeBps)
        : getters[selector]
      assert(result, `Unexpected contract getter ${selector}`)
    } else throw new Error(`Unexpected fixture read: ${body.method}`)
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
  try { return await prepareLaunchReport(request) } finally { globalThis.fetch = oldFetch }
}
