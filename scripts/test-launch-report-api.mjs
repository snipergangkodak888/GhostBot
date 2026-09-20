#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

let token
let verificationCalls = 0
let priceCalls = 0
let priceReply = () => new Response(JSON.stringify({ data: { amount: '110.25' } }), { headers: { date: 'Sat, 19 Sep 2026 23:00:00 GMT' } })
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  priceCalls++
  assert.match(String(url), /^https:\/\/api\.coinbase\.com\/v2\/prices\/(SOL|ETH|BNB|USDC|USDT)-USD\/spot$/)
  assert.equal(options.cache, 'no-store')
  return priceReply()
}
const load = createSourceLoader({
  'next/headers': { cookies: () => ({ get: name => name === 'admin_token' && token ? { value: token } : undefined }) },
  '@/lib/auth': { verifyAdminToken: async value => {
    verificationCalls++
    if (value === 'expired') throw new Error('Expired signature')
    return { sub: 'test-admin', role: value === 'admin' ? 'admin' : 'member' }
  } },
})
const api = load(path.join(projectRoot, 'app/api/admin/launch-reports/route.ts'))
const prices = load(path.join(projectRoot, 'app/api/admin/launch-reports/price/route.ts'))
const baseUrl = 'https://ghost.test/api/admin/launch-reports'
const post = (body, headers = {}) => api.POST(new Request(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ghost.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const price = symbol => prices.GET(new Request(`${baseUrl}/price?symbol=${encodeURIComponent(symbol)}`))

try {
  assert.equal((await api.GET()).status, 401)
  assert.equal((await post({})).status, 401)
  assert.equal((await price('SOL')).status, 401)
  assert.equal(verificationCalls, 0)
  assert.equal(priceCalls, 0, 'Unauthorized requests must never call the price service')
  for (const invalid of ['expired', 'member']) {
    token = invalid
    assert.equal((await api.GET()).status, 401)
    assert.equal((await post({})).status, 401)
    assert.equal((await price('SOL')).status, 401)
  }
  token = 'admin'
  const catalogResponse = await api.GET()
  assert.equal(catalogResponse.status, 200)
  assert.equal(catalogResponse.headers.get('cache-control'), 'no-store')
  const catalog = await catalogResponse.json()
  assert.deepEqual(catalog.pricing, { SOL: '0.10', ETH: '0.10', BNB: '0.02' })
  assert.ok(catalog.models.length >= 16)
  assert.equal((await post({}, { Origin: 'https://other.test' })).status, 403)
  assert.equal((await post('{bad json')).status, 400)
  assert.equal((await post({}, { 'Content-Length': '262145' })).status, 400)
  assert.equal((await post(' '.repeat(262145))).status, 400)
  assert.equal((await post({ format: 'html' })).status, 400)

  const request = structuredClone(catalog.presets['uniswap-v2'])
  request.title = 'Client <review> & report'
  request.targetsPct = [40, 50]
  request.liquidityAmounts = ['2']
  const invalidCurrency = structuredClone(request)
  invalidCurrency.operations.currencySymbol = 'SOL'
  assert.equal((await post({ request: invalidCurrency })).status, 400)
  const invalidPrice = structuredClone(request)
  invalidPrice.operations.agedWalletUnitAmount = '0.02'
  assert.equal((await post({ request: invalidPrice })).status, 400)
  const jsonResponse = await post({ request })
  assert.equal(jsonResponse.status, 200)
  const { report } = await jsonResponse.json()
  assert.equal(report.rows.length, 2)
  assert.ok(report.rows.every(row => row.status === 'ok' && row.totalUsd === null))
  for (const format of ['csv', 'svg', 'png']) {
    const response = await post({ request, format })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-disposition'), new RegExp(`launch-report\\.${format}`))
    if (format === 'png') assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    else {
      const content = await response.text()
      if (format === 'svg') assert.ok(content.includes('Client &lt;review&gt; &amp; report'))
      else assert.ok(content.includes(report.rows[0].amounts.total), 'CSV must preserve the calculated amount')
    }
  }
  const unavailable = structuredClone(request)
  unavailable.liquidityAmounts = ['0']
  assert.equal((await post({ request: unavailable })).status, 200, 'Unavailable rows should remain reviewable')
  assert.equal((await post({ request: unavailable, format: 'png' })).status, 400, 'A report with no calculated scenarios must not export an image')
  assert.equal((await price('not-a-token')).status, 400)
  assert.equal(priceCalls, 0)
  const priceResponse = await price('SOL')
  assert.equal(priceResponse.status, 200)
  assert.equal(priceResponse.headers.get('cache-control'), 'no-store')
  const quote = await priceResponse.json()
  assert.equal(quote.price, '110.25')
  assert.equal(quote.asOf, '2026-09-19T23:00:00.000Z')
  priceReply = () => new Response('Unavailable', { status: 503 })
  assert.equal((await price('ETH')).status, 503)
  priceReply = () => new Response(JSON.stringify({ data: { amount: '-1' } }))
  assert.equal((await price('ETH')).status, 503)
  priceReply = () => new Response(JSON.stringify({ data: { amount: '9'.repeat(400) } }))
  assert.equal((await price('ETH')).status, 503, 'Nonfinite upstream prices must never become client exchange rates')
  process.stdout.write('PASS: report API admin auth, origin checks, body limits, currency/pricing validation, consistent exports, unavailable rows, and price refresh failures.\n')
} finally {
  globalThis.fetch = originalFetch
}
