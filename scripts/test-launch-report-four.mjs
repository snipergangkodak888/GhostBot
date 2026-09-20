#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'

const { refreshFourMemeTerms } = loadSource(path.join(projectRoot, 'lib/launch-reports/refresh-four.ts'))
const { fourCurveCost } = loadSource(path.join(projectRoot, 'lib/launch-reports/four-curve.ts'))
const { createDefaultRequest } = loadSource(path.join(projectRoot, 'lib/launch-reports/catalog.ts'))
const { calculateLaunchReport } = loadSource(path.join(projectRoot, 'lib/launch-reports/engine.ts'))
const evidence = JSON.parse(readFileSync(path.join(projectRoot, 'scripts/fixtures/launch-reports/four-native-rpc.json'), 'utf8'))
const key = request => JSON.stringify([request.method, request.params])
const fixtures = new Map(evidence.map(entry => [key(entry.payload), entry.response]))
const originalFetch = globalThis.fetch
let failure = ''
let calls = 0
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://bsc-rpc.publicnode.com')
  assert.equal(options.method, 'POST')
  const request = JSON.parse(options.body)
  assert.ok(['eth_chainId', 'eth_getBlockByNumber', 'eth_call'].includes(request.method), 'Refresh must only use read-only RPC methods')
  calls++
  const fixture = fixtures.get(key(request))
  assert.ok(fixture, `Unexpected RPC read: ${key(request)}`)
  const response = structuredClone(fixture)
  if (request.method === 'eth_chainId' && failure === 'chain') response.result = '0x1'
  if (request.method === 'eth_getBlockByNumber') response.result.timestamp = `0x${Math.floor(Date.now() / 1000 - (failure === 'stale' ? 3600 : 0)).toString(16)}`
  // Corrupt an actual cost returned by the official helper; do not allow a cached
  // curve to conceal a changed contract rounding rule.
  if (failure === 'quote' && request.method === 'eth_call' && request.params[0].to.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034' && request.params[0].data.length > 138) {
    const words = response.result.slice(2).match(/.{64}/g)
    words[3] = (BigInt(`0x${words[3]}`) + 1n).toString(16).padStart(64, '0')
    response.result = `0x${words.join('')}`
  }
  return Response.json(response)
}

try {
  const input = createDefaultRequest('fourmeme')
  const before = JSON.stringify(input)
  const refreshed = await refreshFourMemeTerms(input)
  assert.equal(JSON.stringify(input), before)
  assert.equal(refreshed.terms.curveModel, 'four-native-kt-v1')
  assert.equal(refreshed.terms.kRaw, '6620379057293150682482642147')
  assert.equal(refreshed.terms.initialTRaw, '1073972602739726027397260273')
  assert.equal(refreshed.terms.protocolFeeBps, 100)
  assert.equal(refreshed.terms.creatorBuyTaxBps, 0, 'Reference-token taxes must not leak into the new-launch scenario')
  assert.equal(refreshed.terms._snapshot.referenceTokens.length, 2)
  assert.equal(refreshed.terms._snapshot.quoteChecks.length, 10)
  assert.ok(calls > 10)
  const k = BigInt(refreshed.terms.kRaw), t = BigInt(refreshed.terms.initialTRaw), cap = BigInt(refreshed.terms.maxOffersRaw)
  assert.equal(fourCurveCost(k, t, cap), 17999999998119999994n, 'Full curve must preserve separate integer division rounding')
  const request = structuredClone(refreshed)
  request.targetsPct = [40, 50, 60, 70, 75, 80, 85, 90, 99]
  const report = calculateLaunchReport(request)
  assert.ok(report.rows.every(row => row.status === 'ok'), JSON.stringify(report.rows.map(row => row.error)))
  for (let i = 1; i < report.rows.length; i++) assert.ok(BigInt(report.rows[i].raw.buys) > BigInt(report.rows[i - 1].raw.buys))
  assert.equal(report.rows[0].raw.buys, '3695121950833577220')
  assert.equal(report.rows[5].phase, 'Graduation endpoint')
  assert.ok(BigInt(report.rows[5].raw.modelReserves) > 0n)
  assert.equal(report.rows[5].details.raisedRaw, '17999999998119999994')
  const taxed = structuredClone(request)
  taxed.terms.creatorBuyTaxBps = 300
  const taxedReport = calculateLaunchReport(taxed)
  assert.ok(taxedReport.rows[0].status === 'ok')
  assert.ok(BigInt(taxedReport.rows[0].raw.buys) > BigInt(report.rows[0].raw.buys))
  assert.ok(BigInt(taxedReport.rows[6].raw.buys) > BigInt(report.rows[6].raw.buys))
  const wrongCurrency = structuredClone(input)
  wrongCurrency.quote.symbol = 'USDC'
  await assert.rejects(() => refreshFourMemeTerms(wrongCurrency), /standard native/)
  for (const mode of ['chain', 'stale', 'quote']) {
    failure = mode
    await assert.rejects(() => refreshFourMemeTerms(input), mode === 'chain' ? /different chain/ : mode === 'stale' ? /stale/ : /no longer matches/)
    assert.equal(JSON.stringify(input), before, 'A failed refresh must not mutate the saved request')
  }
  process.stdout.write('PASS: automatic Four.meme discovery, two-reference verification, Helper3 rounding checks, curve/graduation/tax calculations, and fail-closed refresh.\n')
} finally {
  globalThis.fetch = originalFetch
}
