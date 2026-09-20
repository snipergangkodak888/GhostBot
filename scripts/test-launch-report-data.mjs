import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

const savedFetch = globalThis.fetch, savedPrimary = process.env.LAUNCH_REPORT_SOLANA_RPC_URL
const savedFallback = process.env.LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL
const primary = 'https://fixture.quiknode.pro/PRIVATE_TEST_TOKEN/'
const publicNode = 'https://solana-rpc.publicnode.com'
const pump = JSON.parse(readFileSync(`${projectRoot}/scripts/fixtures/launch-reports/pump-accounts.json`, 'utf8'))
let passed = 0
const tests = []
const test = (name, run) => tests.push({ name, run })
function harness() {
  process.env.LAUNCH_REPORT_SOLANA_RPC_URL = primary
  delete process.env.LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL
  const load = createSourceLoader()
  return {
    ...load(`${projectRoot}/lib/launch-reports/data-fetch.ts`),
    ...load(`${projectRoot}/lib/launch-reports/solana-data.ts`),
    ...load(`${projectRoot}/lib/launch-reports/refresh.ts`),
    ...load(`${projectRoot}/lib/launch-reports/catalog.ts`),
    ...load(`${projectRoot}/lib/launch-reports/telegram.ts`),
  }
}

test('QuickNode is primary, finalized accounts stay together, credentials never enter reports', async () => {
  const h = harness(), calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(url)
    const body = JSON.parse(options.body)
    assert.equal(body.method, 'getMultipleAccounts')
    assert.equal(body.params[1].commitment, 'finalized')
    return Response.json(pump)
  }
  const report = await h.refreshLaunchTerms(h.createDefaultRequest('pumpfun'))
  assert.deepEqual(calls, [primary])
  assert.equal(report.terms._snapshot.rpc, 'QuickNode Solana mainnet')
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TEST_TOKEN|fixture\.quiknode/)
})

test('a real Pump report and PNG survive primary HTTP 429 using the backup', async () => {
  const h = harness(), calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    if (url.includes('coinbase.com')) return Response.json({ data: { amount: '125' } })
    if (url === primary) return new Response('rate limited', { status: 429, headers: { 'Retry-After': '60' } })
    assert.equal(url, publicNode)
    return Response.json(pump)
  }
  const result = await h.generateTelegramLaunchReport({ modelId: 'pumpfun' })
  assert.equal(result.report.rows.length, 8)
  assert(result.report.rows.every(row => row.status === 'ok'))
  assert.equal(result.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(result.report.request.terms._snapshot.rpc, publicNode)
  assert.equal(calls.filter(url => url === primary).length, 1)
  await h.refreshLaunchTerms(h.createDefaultRequest('pumpfun'))
  assert.equal(calls.filter(url => url === primary).length, 1, 'Do not hammer a throttled endpoint during Retry-After')
})

test('JSON-RPC throttling, blocked provider and connection failure all fail over', async () => {
  for (const mode of ['rpc', 'blocked', 'connection']) {
    const h = harness(), calls = []
    globalThis.fetch = async url => {
      calls.push(url)
      if (url !== primary) return Response.json(pump)
      if (mode === 'connection') throw new TypeError(`fetch failed ${primary}`)
      if (mode === 'blocked') return new Response('blocked', { status: 403 })
      return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node unhealthy' } })
    }
    const value = await h.readSolanaLaunchAccounts(['a', 'b', 'c'])
    assert.equal(value.rpc, publicNode)
    assert.deepEqual(calls, [primary, publicNode])
  }
})

test('concurrent requests share one read; later requests get fresh settings', async () => {
  const h = harness()
  let calls = 0, release
  globalThis.fetch = async () => { calls++; await new Promise(resolve => { release = resolve }); return Response.json(pump) }
  const first = h.readSolanaLaunchAccounts(['a', 'b', 'c']), second = h.readSolanaLaunchAccounts(['a', 'b', 'c'])
  assert.equal(calls, 1)
  release()
  const [a, b] = await Promise.all([first, second])
  a.value[0].owner = 'edited'
  assert.notEqual(b.value[0].owner, 'edited')
  globalThis.fetch = async () => { calls++; return Response.json(pump) }
  await h.readSolanaLaunchAccounts(['a', 'b', 'c'])
  assert.equal(calls, 2, 'No stale cached result')
})

test('all-provider outage is bounded and retryable without leaking URLs', async () => {
  const h = harness()
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('busy', { status: 429, headers: { 'Retry-After': '30' } }) }
  await assert.rejects(h.readSolanaLaunchAccounts(['a', 'b', 'c']), error => {
    assert.equal(error.code, 'LAUNCH_DATA_UNAVAILABLE')
    assert.equal(error.httpStatus, 429)
    assert(error.retryAfterMs >= 30000)
    assert.doesNotMatch(error.message, /PRIVATE_TEST_TOKEN/)
    return true
  })
  assert.equal(calls, 3)
})

test('bad account owners, changed layouts and invalid RPC parameters never trigger a blind retry', async () => {
  for (const mode of ['owner', 'shape', 'rpc']) {
    const h = harness()
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      const data = structuredClone(pump)
      if (mode === 'owner') data.result.value[2].owner = 'wrong-owner'
      if (mode === 'shape') data.result.value[2].data[0] = Buffer.alloc(154).toString('base64')
      return Response.json(mode === 'rpc' ? { jsonrpc: '2.0', id: 1, error: { code: -32602 } } : data)
    }
    await assert.rejects(h.refreshLaunchTerms(h.createDefaultRequest('pumpfun')), error => !h.isLaunchDataUnavailable(error))
    assert.equal(calls, 1)
  }
})

test('shared transport retries transient faults, but preserves permanent HTTP errors', async () => {
  const h = harness()
  for (const status of [429, 503]) {
    let calls = 0
    globalThis.fetch = async () => ++calls === 1 ? new Response('busy', { status }) : Response.json({ ok: true })
    assert.equal((await h.fetchLaunchData('https://fixture.test', {}, 'Fixture data')).status, 200)
    assert.equal(calls, 2)
  }
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('bad request', { status: 400 }) }
  assert.equal((await h.fetchLaunchData('https://fixture.test', {}, 'Fixture data')).status, 400)
  assert.equal(calls, 1)
  globalThis.fetch = async () => { calls++; return new Response('busy', { status: 429, headers: { 'Retry-After': '60' } }) }
  await assert.rejects(h.fetchLaunchData('https://fixture.test', {}, 'Fixture data'), error => error.retryAfterMs === 60000)
  assert.equal(calls, 2, 'A long cooldown yields to the durable queue immediately')
})

try {
  for (const { name, run } of tests) { await run(); passed++; console.log(`PASS: ${name}`) }
} finally {
  globalThis.fetch = savedFetch
  if (savedPrimary === undefined) delete process.env.LAUNCH_REPORT_SOLANA_RPC_URL; else process.env.LAUNCH_REPORT_SOLANA_RPC_URL = savedPrimary
  if (savedFallback === undefined) delete process.env.LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL; else process.env.LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL = savedFallback
}
console.log(`PASS: ${passed} live-data resilience regressions, including real Pump math and PNG generation after throttling.`)
