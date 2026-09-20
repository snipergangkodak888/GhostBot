import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { calculateLaunchReport, validateRequest } from '../lib/launch-reports/engine'
import { createDefaultRequest, getModelCatalog } from '../lib/launch-reports/catalog'
import { calculateEvm } from '../lib/launch-reports/adapters-evm'
import { LETSCASH_NATIVE_CONFIGS } from '../lib/launch-reports/amm-math/letscash-v4'
import { parseAmount } from '../lib/launch-reports/utils'
import { GHOST_WALLET_PRICING } from '../lib/launch-reports/pricing'
import type { LaunchReportRequest, LaunchReportRow } from '../lib/launch-reports/types'
import manifest from '../lib/launch-reports/source-manifest.json'

let assertions = 0
function check(ok: unknown, message?: string): asserts ok { assert(ok, message); assertions++ }
function equals(actual: unknown, expected: unknown, message?: string) { assert.deepEqual(actual, expected, message); assertions++ }
function throws(callback: () => unknown, pattern: RegExp) { assert.throws(callback, pattern); assertions++ }
function first(request: LaunchReportRequest): LaunchReportRow {
  const row = calculateLaunchReport(request).rows[0]
  check(row.status === 'ok', row.error)
  return row
}

// The product imports immutable copies; the original source package is never patched.
for (const [name, hash] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(readFileSync(path.join(process.cwd(), 'lib/launch-reports/amm-math', name))).digest('hex')
  equals(actual, hash, `Source module ${name} changed`)
}

equals(GHOST_WALLET_PRICING, { SOL: '0.10', ETH: '0.10', BNB: '0.02' })
equals(getModelCatalog().length, 16)
const needsTerms = new Set(['lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards', 'sushi-launchpad', 'fourmeme'])
for (const model of getModelCatalog()) {
  const request = createDefaultRequest(model.id)
  if (model.id === 'pumpfun-custom') {
    equals(request.operations.currencySymbol, 'SOL'); equals(request.operations.agedWalletCount, 125)
    throws(() => calculateLaunchReport(request), /currency/i)
    continue
  }
  const report = calculateLaunchReport(request)
  check(report.rows.length <= 64)
  equals(report.request.quote.usdPrice, undefined)
  if (needsTerms.has(model.id)) { check(report.rows.every(row => row.status === 'unavailable' && row.error)); continue }
  for (const row of report.rows) {
    check(row.status === 'ok', `${model.id}: ${row.error}`)
    check(row.actualPct! >= row.targetPct)
    check(row.fdvQuote! > 0 && Number.isFinite(row.fdvQuote))
    equals(row.fdvUsd, null)
    const raw = row.raw!
    const components = ['buys', 'initialLiquidity', 'operations', 'modelReserves', 'providerFee', 'recipientBuffers', 'sourceGas'] as const
    equals(components.reduce((sum, key) => sum + BigInt(raw[key]), 0n), BigInt(raw.funding))
    equals(BigInt(raw.funding) + BigInt(raw.agedWallets), BigInt(raw.total))
  }
}

// Aged-wallet commercial prices stay fixed; quantities remain configurable.
for (const [id, expected] of [['pumpfun', '12.5'], ['pons', '12.5'], ['flap', '2.5']] as const) {
  const input = createDefaultRequest(id), original = first(input)
  equals(original.amounts!.agedWallets, expected)
  input.operations.agedWalletCount = 126
  const next = first(input)
  equals(next.raw!.funding, original.raw!.funding)
  equals(BigInt(next.raw!.total) - BigInt(original.raw!.total), parseAmount(input.operations.agedWalletUnitAmount, input.quote.decimals))
  input.operations.agedWalletUnitAmount = '0.07'
  throws(() => calculateLaunchReport(input), /fixed/)
}

// FX is optional, sourced and dated; it changes only USD displays.
const fxRequest = createDefaultRequest('pumpfun'), noFx = first(fxRequest)
fxRequest.quote = { ...fxRequest.quote, usdPrice: '100', priceAsOf: '2026-09-19T12:00:00Z', priceSource: 'Synthetic test exchange rate' }
const withFx = first(fxRequest)
equals(withFx.raw, noFx.raw)
equals(withFx.fdvUsd, withFx.fdvQuote! * 100)
fxRequest.quote.priceAsOf = '2026-02-31T12:00:00Z'
throws(() => validateRequest(fxRequest), /calendar/)
fxRequest.quote.priceAsOf = undefined
throws(() => validateRequest(fxRequest), /timestamp/)

// No mixing native gas with a non-native quote or zero-cost wallet disguises.
const custom = createDefaultRequest('pumpfun-custom')
custom.operations.currencySymbol = 'SOL'
throws(() => validateRequest(custom), /quote currency/)
custom.operations.currencySymbol = 'USDC'; custom.operations.agedWalletCount = 125; custom.operations.agedWalletUnitAmount = '0'
throws(() => validateRequest(custom), /converted/)

// Hard upper bounds prevent expensive or overlong client reports.
const invalid = createDefaultRequest('pumpfun')
invalid.operations.buyerCount = 65
throws(() => validateRequest(invalid), /64/)
invalid.operations.buyerCount = 25; invalid.targetsPct = Array(17).fill(50)
throws(() => validateRequest(invalid), /16/)
invalid.targetsPct = [50]; invalid.liquidityAmounts = Array(5).fill('1')
throws(() => validateRequest(invalid), /4/)
invalid.liquidityAmounts = []; invalid.base.supply = '-1'
throws(() => validateRequest(invalid), /nonnegative/)

// Impossible targets are isolated per row and never mislabeled as a reached endpoint.
const launchlab = createDefaultRequest('launchlab')
launchlab.targetsPct = [50, 79.31, 80]
const launchlabRows = calculateLaunchReport(launchlab).rows
equals(launchlabRows.map(row => row.status), ['ok', 'ok', 'unavailable'])
equals(launchlabRows[1].actualPct, 79.31)
launchlab.base.supply = '900000000'
check(calculateLaunchReport(launchlab).rows.every(row => row.error?.includes('raw supply')))
const pumpSupply = createDefaultRequest('pumpfun'); pumpSupply.base.decimals = 18
check(calculateLaunchReport(pumpSupply).rows.every(row => row.error?.includes('6 decimals')))

// Transfer fees consume extra sale inventory and raise costs for the same net control.
const reward = createDefaultRequest('stonkfun'); reward.targetsPct = [50, 79.31]
const untaxed = first(reward)
reward.terms.transferFee = { basisPoints: 300, maximumFee: '1000000000000000' }
const taxed = calculateLaunchReport(reward)
check(BigInt(taxed.rows[0].raw!.buys) > BigInt(untaxed.raw!.buys))
equals(taxed.rows[1].status, 'unavailable')

// Provider fee is genuinely grossed up; buffers and wallet purchases stay separate.
const fees = createDefaultRequest('raydium-cpmm'); fees.targetsPct = [50]; fees.liquidityAmounts = ['25']
fees.operations.providerFeeBps = 100; fees.operations.recipientCount = 26; fees.operations.recipientBufferAmount = '0.02'; fees.operations.sourceGasAmount = '0.01'
const paid = first(fees).raw!
const providerBase = BigInt(paid.buys) + BigInt(paid.initialLiquidity) + BigInt(paid.operations) + BigInt(paid.modelReserves)
const sent = providerBase + BigInt(paid.providerFee)
check(sent * 9900n / 10000n >= providerBase)
check((sent - 1n) * 9900n / 10000n < providerBase)
equals(paid.recipientBuffers, '520000000')
fees.operations.includeInitialLiquidity = false
const noLiquidity = first(fees)
equals(noLiquidity.raw!.initialLiquidity, '0')
check(BigInt(noLiquidity.raw!.total) < BigInt(paid.total))

// Both token address orderings give the same economics in the V3 pool.
const v3 = createDefaultRequest('uniswap-v3'); v3.targetsPct = [50]; v3.liquidityAmounts = ['2']
const token0 = first(v3)
v3.terms.tokenIsToken0 = false
const token1 = first(v3)
check(Math.abs(Number(token0.amounts!.buys) / Number(token1.amounts!.buys) - 1) < 1e-10)
check(Math.abs(token0.fdvQuote! / token1.fdvQuote! - 1) < 1e-10)

// Graduation keeps native fee tiers and per-wallet order visible and reproducible.
const native = createDefaultRequest('pumpfun'); native.targetsPct = [79.31, 80, 90]
const graduated = calculateLaunchReport(native)
check(graduated.rows.every(row => row.status === 'ok'))
equals(graduated.rows.map(row => row.phase), ['Curve → migration', 'Curve + graduated pool', 'Curve + graduated pool'])
native.operations.curveBuyerCount = 25
check(calculateLaunchReport(native).rows[1].error?.includes('add up'))

// Specialized families use deterministic synthetic geometry solely for arithmetic tests.
function evm(request: LaunchReportRequest, targetPct: number) {
  const supplyRaw = parseAmount(request.base.supply, request.base.decimals)
  return calculateEvm({ request, targetPct, targetRaw: supplyRaw * BigInt(Math.round(targetPct * 100)) / 10000n, supplyRaw, buyerCount: request.operations.buyerCount, liquidityRaw: 0n, retainedRaw: 0n })
}
for (const id of ['flap', 'letscash', 'pools-instant', 'lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards', 'sushi-launchpad']) {
  const request = createDefaultRequest(id)
  if (id.startsWith('lunch')) request.terms.magnitude = 200000
  if (id === 'sushi-launchpad') Object.assign(request.terms, { plannedStartTick: -200000, reserveBps: 100 })
  let previous = 0n
  for (const target of [40, 50, 60, 70, 80, 90]) {
    const result = evm(request, target), supply = parseAmount(request.base.supply, request.base.decimals)
    check(result.buyRaw > previous); check(result.actualBaseRaw >= supply * BigInt(target) / 100n); check(result.fdvQuote! > 0 && Number.isFinite(result.fdvQuote))
    if (id === 'flap' && target >= 80) check(result.refundableReserveRaw! > 0n)
    previous = result.buyRaw
  }
  if (id.startsWith('lunch-v4')) { const zero = evm(request, 70).buyRaw; request.terms.buyTaxBps = 500; check(evm(request, 70).buyRaw > zero) }
}
for (const config of LETSCASH_NATIVE_CONFIGS) {
  const request = createDefaultRequest('letscash'); request.terms.configId = config.configId; request.base.supply = (config.supplyWei / 10n ** 18n).toString()
  check(evm(request, 80).actualBaseRaw >= config.supplyWei * 80n / 100n)
}
const four = createDefaultRequest('fourmeme')
Object.assign(four.terms, { quotedBuyerCount: 32, quotedCurveBuyerCount: 30, quoteSource: 'Synthetic arithmetic fixture', quoteAsOf: '2026-09-19T00:00:00Z', authoritativeQuotes: [{ targetPct: 50, grossQuote: '5', fdvQuote: '20' }], curveGrossQuote: '20', curveReserveQuote: '19', crossingBuyGrossQuote: '1' })
equals(evm(four, 50).buyRaw, 5n * 10n ** 18n)
check(evm(four, 85).buyRaw > 20n * 10n ** 18n)
throws(() => evm(four, 55), /exactly 55/)

console.log(`Launch report engine: ${assertions} assertions passed across all 16 model entries, funding, FX, limits, transfer fees, graduation and immutable source hashes.`)
