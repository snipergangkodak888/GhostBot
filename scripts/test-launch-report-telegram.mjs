#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

let prepareCalls = 0
let preparedInput
const load = createSourceLoader({
  './prepare': { prepareLaunchReport: async draft => {
    prepareCalls++
    preparedInput = structuredClone(draft)
    const request = structuredClone(draft)
    request.quote.usdPrice = '125.50'
    request.quote.priceSource = 'Fixture current price'
    request.quote.priceAsOf = '2026-09-20T12:00:00.000Z'
    request.termsSource = { kind: 'snapshot', label: 'Fresh fixture terms', asOf: '2026-09-20T12:00:00.000Z' }
    return request
  } },
})
const flow = load(path.join(projectRoot, 'lib/launch-reports/telegram.ts'))
const { getModelCatalog, createDefaultRequest } = load(path.join(projectRoot, 'lib/launch-reports/catalog.ts'))
const { calculateLaunchReport } = load(path.join(projectRoot, 'lib/launch-reports/engine.ts'))
const buttons = view => view.replyMarkup.inline_keyboard.flat()
const callback = button => flow.parseLaunchMathCallback(button.callback_data)

// Every supported venue is reachable in two menu taps, with no typed configuration.
const home = flow.launchMathHomeView()
const homeActions = buttons(home).map(callback)
assert.equal(homeActions.length, 4)
const discovered = new Set()
for (const action of homeActions) {
  assert.equal(action.action, 'group')
  const menu = flow.launchMathGroupView(action.group)
  for (const button of buttons(menu)) {
    assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64, 'Telegram callback limit')
    const choice = callback(button)
    assert.ok(choice, 'Every rendered button must parse')
    if (choice.action === 'home') continue
    assert.equal(choice.action, 'review')
    discovered.add(choice.selection.modelId)
    const review = flow.launchMathReviewView(choice.selection)
    const generate = callback(buttons(review)[0])
    assert.equal(generate.action, 'generate')
    assert.deepEqual(generate.selection, choice.selection)
    assert.match(review.text, /Every total includes 125 aged wallets/)
    assert.match(review.text, /does not launch a token or move funds/)
    for (const option of buttons(review)) assert.ok(callback(option), 'Liquidity and navigation callbacks must parse')
  }
}
assert.deepEqual([...discovered].sort(), getModelCatalog().map(model => model.id).sort())

// Callback payloads are untrusted. They can select known presets, never prices or math.
for (const data of [
  null, {}, 'lm:', 'lm:group:constructor', 'lm:group:__proto__', 'lm:group:unknown',
  'lm:generate:missing:compare', 'lm:generate:pumpfun:25', 'lm:generate:raydium-cpmm:0',
  'lm:generate:uniswap-v2:2.1', 'lm:generate:pumpfun:', 'lm:generate:pumpfun:compare:extra',
  'lm:generate:pumpfun:compare\n', `lm:${'x'.repeat(65)}`, 'launch:generate',
]) assert.equal(flow.parseLaunchMathCallback(data), null, `Reject invalid callback ${String(data)}`)
assert.throws(() => flow.createTelegramLaunchRequest({ modelId: 'not-supported' }), /Choose a venue/)
assert.throws(() => flow.createTelegramLaunchRequest({ modelId: 'uniswap-v3', liquidity: '-1' }), /liquidity/)

// Shared commercial policy remains fixed for every teammate and every new request.
const expectedWallets = { pumpfun: ['0.10', 'SOL', '12.5'], pons: ['0.10', 'ETH', '12.5'], fourmeme: ['0.02', 'BNB', '2.5'] }
for (const [modelId, [unit, currency, total]] of Object.entries(expectedWallets)) {
  const request = flow.createTelegramLaunchRequest({ modelId })
  assert.equal(request.operations.agedWalletUnitAmount, unit)
  assert.equal(request.operations.agedWalletCount, 125)
  assert.ok(flow.launchMathReviewView({ modelId }).text.includes(`125 aged wallets × ${unit} ${currency} = ${total} ${currency}`))
  assert.deepEqual(request.targetsPct, createDefaultRequest(modelId).targetsPct)
}
const first = flow.createTelegramLaunchRequest({ modelId: 'pumpfun' })
first.operations.agedWalletCount = 7
first.targetsPct[0] = 1
const second = flow.createTelegramLaunchRequest({ modelId: 'pumpfun' })
assert.equal(second.operations.agedWalletCount, 125)
assert.equal(second.targetsPct[0], 40)

const raydium = flow.createTelegramLaunchRequest({ modelId: 'raydium-cpmm', liquidity: '30' })
assert.deepEqual(raydium.liquidityAmounts, ['30'])
assert.equal(raydium.operations.retainedPct, 30)
assert.deepEqual(flow.createTelegramLaunchRequest({ modelId: 'raydium-cpmm' }).liquidityAmounts, ['25', '30', '40', '50'])
assert.match(flow.launchMathReviewView({ modelId: 'uniswap-v3' }).text, /Example pool · full range · 0\.30% swap fee/)
assert.equal(flow.createTelegramLaunchRequest({ modelId: 'uniswap-v2' }).chain, 'ETH pool example')
assert.match(flow.launchMathReviewView({ modelId: 'pumpfun-custom' }).text, /costs convert into USDC automatically/)
assert.match(flow.launchMathReviewView({ modelId: 'lunch-v4-tax' }).text, /0% creator buy tax/)
assert.match(flow.launchMathReviewView({ modelId: 'fourmeme' }).text, /Network, setup, cleanup and holder costs are excluded/)
assert.doesNotMatch(flow.launchMathReviewView({ modelId: 'pons' }).text, /costs are excluded/)

const progress = flow.launchMathProgressView({ modelId: 'pumpfun' })
assert.equal(buttons(progress).length, 0, 'The busy message must not keep an active Generate button')
assert.match(progress.text, /image will appear here/)
const failure = flow.launchMathErrorView({ modelId: 'pumpfun' })
assert.equal(callback(buttons(failure)[0]).action, 'generate')
assert.match(failure.text, /No estimate was sent/)
assert.match(flow.launchMathErrorView({ modelId: 'pumpfun' }, 'delivery').text, /Telegram could not receive/)

// This uses the real shared math + PNG renderer. Only public network lookups are replaced.
const result = await flow.generateTelegramLaunchReport({ modelId: 'pumpfun' })
assert.equal(prepareCalls, 1)
assert.equal(preparedInput.modelId, 'pumpfun')
assert.equal(preparedInput.quote.usdPrice, undefined, 'Always prepare current prices, never a Telegram-cached rate')
assert.equal(result.report.request.quote.usdPrice, '125.50')
assert.equal(result.report.request.termsSource.label, 'Fresh fixture terms')
assert.equal(result.report.rows.length, 8)
assert.ok(result.report.rows.every(row => row.status === 'ok'))
assert.deepEqual(result.report.rows, calculateLaunchReport(result.report.request).rows, 'Bot and web math must agree on every amount')
assert.equal(result.filename, 'ghost-pumpfun-launch-report.png')
assert.equal(result.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
assert.ok(result.caption.length <= 1024, 'Photo caption must fit Telegram')
assert.ok(result.png.length < 10_000_000, 'Photo must fit Telegram size limit')
assert.ok(result.png.readUInt32BE(16) + result.png.readUInt32BE(20) <= 10_000, 'Photo dimensions must fit Telegram')

// Delivery retry must preserve the frozen image and never refresh prices/settings.
const frozen = flow.renderTelegramLaunchReport(result.report, { modelId: 'pumpfun' })
assert.equal(prepareCalls, 1)
assert.deepEqual(frozen.png, result.png)
assert.equal(frozen.caption, result.caption)
assert.match(frozen.caption, /Open or save the PNG to share/)
assert.throws(() => flow.renderTelegramLaunchReport(result.report, { modelId: 'pons' }), /does not match/)
assert.throws(() => flow.renderTelegramLaunchReport({ ...result.report, rows: [] }, { modelId: 'pumpfun' }), /No funding scenarios/)
for (const button of buttons(result)) assert.ok(callback(button))

// DEX comparison uses the selected liquidity and includes a valid Telegram-sized image.
const dex = await flow.generateTelegramLaunchReport({ modelId: 'raydium-cpmm', liquidity: '30' })
assert.equal(dex.report.rows.length, 5)
assert.ok(dex.report.rows.every(row => row.liquidity === '30' && row.status === 'ok'))
assert.ok(dex.caption.length <= 1024)

const v2 = await flow.generateTelegramLaunchReport({ modelId: 'uniswap-v2' })
assert.match(v2.caption, /Network, setup, cleanup and holder costs are excluded/)
assert.ok(v2.caption.length <= 1024)

const failing = createSourceLoader({ './prepare': { prepareLaunchReport: async () => { throw new Error('Fixture refresh unavailable') } } })(path.join(projectRoot, 'lib/launch-reports/telegram.ts'))
await assert.rejects(failing.generateTelegramLaunchReport({ modelId: 'pumpfun' }), /Fixture refresh unavailable/, 'Live refresh failure must never silently use stale defaults')
assert.equal(prepareCalls, 3)
process.stdout.write(`PASS: Telegram menu reaches all ${discovered.size} venues; fixed pricing, callback validation, defaults, progress/retry, live preparation, shared engine, PNG output and frozen delivery retries. No Telegram messages were sent.\n`)
