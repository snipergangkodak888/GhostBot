#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

const originalFetch = globalThis.fetch
const observedAt = '2026-09-19T23:00:00.000Z'
let prices = { SOL: '150.00000001', ETH: '2000', BNB: '600', USDC: '1', USDT: '1' }
let lookupFailure = '', refreshFailure = false, refreshCalls = 0
const lookups = [], refreshInputs = []
const load = createSourceLoader({
  './refresh': {
    supportedRefreshModels: ['pumpfun-custom'],
    refreshLaunchTerms: async input => {
      refreshCalls++
      refreshInputs.push(structuredClone(input))
      if (refreshFailure) throw new Error('Protocol configuration unavailable')
      return {
        ...structuredClone(input),
        terms: { ...input.terms, quoteSchedule: 'stable', initialVirtualQuoteReserves: '4292000000',
          protocolFeeBps: 95, creatorFeeBps: 30, migrationFeeRaw: '0', nativeMigrationCostLamports: '15000001',
          ammFeeTiers: [{ thresholdRaw: '0', lpFeeBps: 20, protocolFeeBps: 5, creatorFeeBps: 30 }] },
        termsSource: { kind: 'snapshot', label: 'Deterministic protocol fixture', asOf: observedAt },
      }
    },
  },
  'next/headers': { cookies: () => ({ get: () => ({ value: 'test-admin' }) }) },
  '@/lib/auth': { verifyAdminToken: async () => ({ sub: 'test-admin', role: 'admin' }) },
})
const { prepareLaunchReport, validateLaunchDraft } = load(path.join(projectRoot, 'lib/launch-reports/prepare.ts'))
const { createDefaultRequest } = load(path.join(projectRoot, 'lib/launch-reports/catalog.ts'))
const { calculateLaunchReport, validateRequest } = load(path.join(projectRoot, 'lib/launch-reports/engine.ts'))
const { convertNativeAmount, FUNDING_MONEY_KEYS } = load(path.join(projectRoot, 'lib/launch-reports/funding.ts'))
const api = load(path.join(projectRoot, 'app/api/admin/launch-reports/route.ts'))
const post = body => api.POST(new Request('https://ghost.test/api/admin/launch-reports', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ghost.test' }, body: JSON.stringify(body),
}))
globalThis.fetch = async (url, options) => {
  const match = /^https:\/\/api\.coinbase\.com\/v2\/prices\/(SOL|ETH|BNB|USDC|USDT)-USD\/spot$/.exec(String(url))
  assert.ok(match, 'Preparation may only use the fixed public price endpoint in this test')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.redirect, 'error')
  lookups.push(match[1])
  if (lookupFailure === 'http') return new Response('Unavailable', { status: 503 })
  const amount = lookupFailure === 'zero' ? '0' : lookupFailure === 'invalid' ? '9'.repeat(400) : prices[match[1]]
  return Response.json({ data: { amount } }, { headers: { Date: 'Sat, 19 Sep 2026 23:00:00 GMT' } })
}

try {
  // Independent exact expectations: one native atom must not round down to zero.
  assert.equal(convertNativeAmount('0.000000001', 'SOL', 6, '150.00000001', '1'), '0.000001')
  assert.equal(convertNativeAmount('0.10', 'SOL', 6, '150.00000001', '1'), '15.000001')
  assert.equal(convertNativeAmount('0.10', 'ETH', 6, '2000', '1'), '200')
  assert.equal(convertNativeAmount('0.02', 'BNB', 6, '600', '1'), '12')
  assert.throws(() => convertNativeAmount('1', 'SOL', 6, '0', '1'), /positive/)
  assert.throws(() => convertNativeAmount('1', 'SOL', 6, '1', '0'), /positive/)

  const draft = createDefaultRequest('pumpfun-custom')
  draft.targetsPct = [50, 80]
  for (const key of FUNDING_MONEY_KEYS) if (key !== 'agedWalletUnitAmount') draft.operations[key] = '0.000000001'
  draft.operations.providerFeeBps = 100
  const draftBefore = structuredClone(draft)
  validateLaunchDraft(draft)
  assert.throws(() => validateRequest(draft), /conversion/, 'A native draft is not yet a stablecoin snapshot')
  const prepared = await prepareLaunchReport(draft)
  assert.deepEqual(draft, draftBefore, 'Automatic preparation must not mutate the editable input')
  assert.deepEqual(lookups, ['USDC', 'SOL'])
  assert.equal(refreshCalls, 1)
  assert.equal(refreshInputs[0].operations.currencySymbol, 'USDC', 'Convert native allowances before protocol refresh')
  assert.equal(prepared.quote.usdPrice, '1')
  assert.equal(prepared.quote.priceAsOf, observedAt)
  assert.equal(prepared.operations.agedWalletUnitAmount, '15.000001')
  assert.equal(prepared.operations.agedWalletCount, 125)
  assert.equal(prepared.operations.buyerCount, draft.operations.buyerCount)
  assert.equal(prepared.operations.providerFeeBps, 100)
  for (const key of FUNDING_MONEY_KEYS) if (key !== 'agedWalletUnitAmount') assert.equal(prepared.operations[key], '0.000001', key)
  assert.deepEqual(prepared.fundingConversion.nativeOperations, draft.operations)
  assert.equal(prepared.fundingConversion.nativeUsdPrice, '150.00000001')
  assert.equal(prepared.fundingConversion.quoteUsdPrice, '1')
  assert.equal(prepared.terms.nativeMigrationFundingQuoteRaw, '2250001', 'Convert 15,000,001 lamports with upward USDC rounding')
  validateRequest(prepared)

  const frozenBefore = structuredClone(prepared), lookupsBeforeSnapshot = lookups.length
  const report = calculateLaunchReport(prepared)
  assert.ok(report.rows.every(row => row.status === 'ok'), JSON.stringify(report.rows.map(row => row.error)))
  assert.equal(report.rows[0].amounts.agedWallets, '1875.000125')
  assert.equal(report.rows[0].raw.modelReserves, '0')
  assert.equal(report.rows[1].raw.modelReserves, '2250001', 'Native migration funding belongs only to a graduating row')
  assert.equal(lookups.length, lookupsBeforeSnapshot, 'Snapshot calculations must make no network requests')
  assert.deepEqual(prepared, frozenBefore)
  assert.deepEqual(report.request, prepared)

  for (const edit of [
    request => { request.operations.agedWalletUnitAmount = '1' },
    request => { request.operations.setupAmount = '0' },
    request => { request.operations.buyerCount++ },
    request => { request.fundingConversion.nativeOperations.agedWalletUnitAmount = '0.02' },
    request => { request.fundingConversion.quoteUsdPrice = '2' },
    request => { request.fundingConversion.asOf = 'yesterday' },
  ]) {
    const tampered = structuredClone(prepared); edit(tampered)
    assert.throws(() => validateRequest(tampered), undefined, 'Frozen cost/conversion changes must be rejected')
  }

  prices.SOL = '200'
  lookups.length = 0
  const refreshed = await prepareLaunchReport(prepared)
  assert.deepEqual(lookups, ['USDC', 'SOL'])
  assert.equal(refreshed.operations.agedWalletUnitAmount, '20', 'Regeneration uses original 0.10 SOL, never the prior USDC amount')
  assert.equal(refreshed.terms.nativeMigrationFundingQuoteRaw, '3000001')
  assert.deepEqual(refreshed.fundingConversion.nativeOperations, draft.operations)
  assert.deepEqual(prepared, frozenBefore, 'Refreshing a snapshot cannot overwrite the old snapshot')

  const explicitPrice = structuredClone(draft)
  explicitPrice.quote = { ...explicitPrice.quote, usdPrice: '1.01', priceSource: 'Client scenario', priceAsOf: observedAt }
  lookups.length = 0
  const explicitPrepared = await prepareLaunchReport(explicitPrice)
  assert.deepEqual(lookups, ['SOL'], 'Preserve an explicit dated quote-price assumption')
  assert.equal(explicitPrepared.quote.usdPrice, '1.01')
  assert.equal(explicitPrepared.operations.agedWalletUnitAmount, '19.801981')

  const generic = createDefaultRequest('uniswap-v2')
  generic.quote = { ...generic.quote, usdPrice: '2000', priceSource: 'Client scenario', priceAsOf: observedAt }
  lookups.length = 0
  const callsBeforeGeneric = refreshCalls
  const preparedGeneric = await prepareLaunchReport(generic)
  assert.deepEqual({ ...preparedGeneric, injectionLiquidity: undefined }, { ...generic, injectionLiquidity: undefined })
  assert.equal(preparedGeneric.injectionLiquidity.referenceSymbol, 'ETH')
  assert.equal(lookups.length, 0)
  assert.equal(refreshCalls, callsBeforeGeneric, 'Generic chosen-liquidity math needs no launchpad lookup')

  for (const mutate of [
    request => { request.operations.agedWalletUnitAmount = '0.02' },
    request => { request.modelId = 'not-a-model' },
    request => { request.targetsPct = [0] },
  ]) {
    const invalid = structuredClone(draft); mutate(invalid)
    const priorLookups = lookups.length, priorRefreshes = refreshCalls
    await assert.rejects(() => prepareLaunchReport(invalid))
    assert.equal(lookups.length, priorLookups, 'Reject invalid inputs before public requests')
    assert.equal(refreshCalls, priorRefreshes)
  }
  for (const mode of ['http', 'zero', 'invalid']) {
    lookupFailure = mode
    const priorRefreshes = refreshCalls
    await assert.rejects(() => prepareLaunchReport(draft), /refresh|invalid|temporarily unavailable/)
    assert.equal(refreshCalls, priorRefreshes, 'A failed FX lookup must stop before protocol calculation')
    assert.deepEqual(draft, draftBefore)
  }
  lookupFailure = ''
  refreshFailure = true
  await assert.rejects(() => prepareLaunchReport(prepared), /Protocol configuration unavailable/, 'A failed current lookup cannot reuse old terms')
  assert.deepEqual(prepared, frozenBefore)
  refreshFailure = false

  // Exercise the actual API and preparation path with a native SOL draft for USDC.
  const response = await post({ request: draft, refresh: true })
  assert.equal(response.status, 200)
  const apiReport = (await response.json()).report
  assert.equal(apiReport.request.operations.currencySymbol, 'USDC')
  assert.equal(apiReport.request.operations.agedWalletUnitAmount, '20')
  assert.equal(apiReport.request.fundingConversion.nativeOperations.agedWalletUnitAmount, '0.10')
  assert.ok(apiReport.rows.every(row => row.status === 'ok'))
  lookups.length = 0
  assert.equal((await post({ request: apiReport.request, format: 'csv' })).status, 200)
  assert.equal(lookups.length, 0, 'Export the captured report without refreshing prices or protocol terms')
  assert.equal((await post({ request: draft })).status, 400, 'An unconverted draft cannot be exported as a snapshot')
  refreshFailure = true
  const failedResponse = await post({ request: apiReport.request, refresh: true })
  assert.equal(failedResponse.status, 400)
  assert.match((await failedResponse.json()).error, /Protocol configuration unavailable/)
  process.stdout.write('PASS: automatic preparation, fixed native wallet policy, upward FX rounding, migration conversion, immutable snapshots, refresh failures, tamper detection and USDC API/export flow.\n')
} finally {
  globalThis.fetch = originalFetch
}
