#!/usr/bin/env node
// Read-only live smoke test. Generates temporary report artifacts; never launches
// tokens, signs transactions, or sends Telegram messages. Requires network access.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'

const { getModelCatalog, createDefaultRequest } = loadSource(path.join(projectRoot, 'lib/launch-reports/catalog.ts'))
const { prepareLaunchReport } = loadSource(path.join(projectRoot, 'lib/launch-reports/prepare.ts'))
const { calculateLaunchReport } = loadSource(path.join(projectRoot, 'lib/launch-reports/engine.ts'))
const { supportedRefreshModels } = loadSource(path.join(projectRoot, 'lib/launch-reports/refresh.ts'))
const { renderLaunchReportPng } = loadSource(path.join(projectRoot, 'lib/launch-reports/render.ts'))
const { parseAmount } = loadSource(path.join(projectRoot, 'lib/launch-reports/utils.ts'))

const requested = [], args = process.argv.slice(2)
let concurrency = 2, destination
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) requested.push(args[++i])
  else if (args[i] === '--concurrency' && args[i + 1]) concurrency = Number(args[++i])
  else if (args[i] === '--out' && args[i + 1]) destination = path.resolve(args[++i])
  else throw new Error('Usage: node scripts/test-launch-report-live.mjs [--model ID] [--concurrency 1..4] [--out DIRECTORY]')
}
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4, 'Concurrency must be between 1 and 4')
const catalog = getModelCatalog()
for (const id of requested) assert.ok(catalog.some(model => model.id === id), `Unknown model: ${id}`)
const models = requested.length ? catalog.filter(model => requested.includes(model.id)) : catalog
const output = destination || await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-launch-live-'))
await fs.mkdir(output, { recursive: true })
process.chdir(projectRoot)
process.stdout.write(`Live verification: ${models.length} venues, concurrency ${concurrency}. Artifacts: ${output}\n`)

function verifyReport(report, request) {
  assert.deepEqual(report.request, request, 'Report must retain its prepared snapshot')
  assert.equal(report.rows.length, request.targetsPct.length * (request.liquidityAmounts?.length || 1))
  const walletRaw = BigInt(request.operations.agedWalletCount) * parseAmount(request.operations.agedWalletUnitAmount, request.quote.decimals)
  for (const row of report.rows) {
    assert.equal(row.status, 'ok', `${row.targetPct}% / ${row.liquidity}: ${row.error}`)
    assert.ok(row.actualPct >= row.targetPct && row.actualPct <= 100, `Invalid achieved control at ${row.targetPct}%`)
    for (const [name, raw] of Object.entries(row.raw)) {
      assert.match(raw, /^\d+$/, `Invalid ${name} atomic amount`)
      assert.equal(parseAmount(row.amounts[name], request.quote.decimals), BigInt(raw), `${name} formatted amount differs`)
    }
    const raw = Object.fromEntries(Object.entries(row.raw).map(([key, value]) => [key, BigInt(value)]))
    assert.equal(raw.agedWallets, walletRaw, 'Fixed wallet pricing must reconcile')
    assert.equal(raw.funding, raw.buys + raw.initialLiquidity + raw.operations + raw.modelReserves + raw.providerFee + raw.recipientBuffers + raw.sourceGas)
    assert.equal(raw.total, raw.funding + raw.agedWallets)
    assert.ok(Number.isFinite(row.totalUsd) && row.totalUsd > 0, 'USD total must be positive and finite')
    if (row.fdvUsd !== null) assert.ok(Number.isFinite(row.fdvUsd) && row.fdvUsd >= 0, 'FDV must be finite and nonnegative')
  }
}

async function testVenue(model) {
  const started = Date.now(), draft = createDefaultRequest(model.id), before = structuredClone(draft)
  let stage = 'live-preparation'
  try {
    const prepared = await prepareLaunchReport(draft)
    assert.deepEqual(draft, before, 'Live preparation mutated the defaults')
    assert.equal(prepared.quote.priceSource, 'Coinbase spot')
    assert.ok(Date.now() - Date.parse(prepared.quote.priceAsOf) < 30 * 60 * 1000, 'Price must be current')
    if (supportedRefreshModels.includes(model.id)) {
      assert.equal(prepared.termsSource.kind, 'snapshot')
      assert.ok(Date.now() - Date.parse(prepared.termsSource.asOf) < 5 * 60 * 1000, 'Protocol configuration must be fresh')
      assert.ok(prepared.terms._snapshot, 'Live protocol metadata must be retained')
    }
    stage = 'calculation'
    const report = calculateLaunchReport(prepared)
    await fs.writeFile(path.join(output, `${model.id}.json`), JSON.stringify(report, null, 2) + '\n')
    verifyReport(report, prepared)
    stage = 'png-export'
    const png = await renderLaunchReportPng(report)
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]), 'Export must be a valid PNG')
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
    assert.ok(width > 0 && height > 0 && png.length > 1000)
    await fs.writeFile(path.join(output, `${model.id}.png`), png)
    const result = { model: model.id, status: 'pass', rows: report.rows.length, elapsedMs: Date.now() - started, pngBytes: png.length, width, height,
      source: supportedRefreshModels.includes(model.id) ? 'live protocol + live FX' : 'generic pool assumptions + live FX',
      terms: prepared.termsSource?.label, warnings: [...new Set([...report.warnings, ...report.rows.flatMap(row => row.warnings)])] }
    process.stdout.write(`PASS ${model.id}: ${result.rows} scenarios, PNG ${width}×${height}, ${result.elapsedMs}ms\n`)
    return result
  } catch (error) {
    const result = { model: model.id, status: 'fail', stage, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
    process.stdout.write(`FAIL ${model.id} (${stage}): ${result.error}\n`)
    return result
  }
}

let cursor = 0
const results = new Array(models.length)
await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, async () => {
  while (cursor < models.length) { const index = cursor++; results[index] = await testVenue(models[index]) }
}))
const summary = { observedAt: new Date().toISOString(), count: models.length, passed: results.filter(result => result.status === 'pass').length, artifacts: output, results }
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(`${summary.passed}/${summary.count} venues passed live preparation, every default scenario, and PNG export. Summary: ${path.join(output, 'summary.json')}\n`)
if (summary.passed !== summary.count) process.exitCode = 1
