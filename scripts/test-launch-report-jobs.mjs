#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

const modulePath = path.join(projectRoot, 'lib/launch-report-jobs.ts')
const deliveryPath = path.join(projectRoot, 'lib/launch-report-delivery.ts')
const baseline = createSourceLoader()
const flow = baseline(path.join(projectRoot, 'lib/launch-reports/telegram.ts'))
const { calculateLaunchReport } = baseline(path.join(projectRoot, 'lib/launch-reports/engine.ts'))
const fixture = calculateLaunchReport(flow.createTelegramLaunchRequest({ modelId: 'pumpfun' }))
fixture.generatedAt = '2026-09-20T12:00:00.000Z'
const copy = value => structuredClone(value)
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('No network calls are permitted in job tests') }
const failures = []
let passed = 0
async function test(name, run) {
  try { await run(); passed++; process.stdout.write(`PASS: ${name}\n`) }
  catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL: ${name}: ${error.message}\n`) }
}

function harness() {
  const state = {
    rows: new Map(), operations: [], edits: [], sends: [], generateCalls: 0, renderCalls: 0,
    allowed: true, profile: 'launch', capture: false, token: 'TEST_ONLY_TOKEN',
    delivery: { status: 'sent', messageId: 900 }, failStorage: null, generateError: null,
    onGenerate: null, accessCalls: 0, editError: null,
  }
  function matches(row, search) {
    for (const [key, condition] of search) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(key)) continue
      const actual = key.startsWith('data->>') ? row.data[key.slice(7)] : row[key]
      if (condition.startsWith('eq.')) { if (String(actual) !== condition.slice(3)) return false }
      else if (condition.startsWith('in.(') && condition.endsWith(')')) { if (!condition.slice(4, -1).split(',').includes(String(actual))) return false }
      else if (condition.startsWith('lt.')) { if (actual === undefined || String(actual) >= condition.slice(3)) return false }
      else throw new Error(`Unexpected filter ${key}=${condition}`)
    }
    return true
  }
  async function supabaseRest(url, options = {}) {
    const search = new URL(url, 'https://test.invalid/').searchParams
    const method = options.method || 'GET'
    assert.equal(search.get('collection'), 'eq.launchReportJobs', 'Job storage must stay in its own collection')
    const operation = { method, search: Object.fromEntries(search), body: copy(options.body) }
    state.operations.push(operation)
    if (state.failStorage?.(operation)) throw new Error('Fixture storage unavailable')
    if (method === 'POST') {
      assert.equal(search.get('on_conflict'), 'collection,id')
      assert.match(options.headers.Prefer, /ignore-duplicates/)
      if (state.rows.has(options.body.id)) return []
      const row = copy(options.body)
      state.rows.set(row.id, row)
      return [copy(row)]
    }
    let selected = [...state.rows.values()].filter(row => matches(row, search))
    if (method === 'PATCH') {
      assert.ok(search.get('id')?.startsWith('eq.'), 'CAS must identify a single job')
      assert.ok(search.get('data->>status')?.startsWith('eq.'), 'CAS must check the previous status')
      assert.ok(search.get('data->>version')?.startsWith('eq.'), 'CAS must check the previous version')
      for (const row of selected) Object.assign(row, copy(options.body))
    } else assert.equal(method, 'GET')
    if (search.get('order')) {
      assert.equal(search.get('order'), 'created_at.asc')
      selected.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
    if (search.get('limit')) selected = selected.slice(0, Number(search.get('limit')))
    return copy(selected)
  }
  const fakeResult = report => ({
    report: copy(report), png: Buffer.from(JSON.stringify(report)), filename: 'ghost-pumpfun-launch-report.png',
    caption: flow.launchMathResultCaption(report), replyMarkup: { inline_keyboard: [[{ text: 'New report', callback_data: 'lm:home' }]] },
  })
  const overrides = {
    './supabase': { supabaseRest },
    '@/lib/chat-subscriptions': { getChatProfile: async () => state.profile ? { profile: state.profile } : null },
    '@/lib/team-access': {
      getTeamAccess: async () => { state.accessCalls++; return { allowed: state.allowed, member: { accessRole: 'member' } } },
      normalizeTeamAccessRole: value => value === 'admin' ? 'admin' : 'member',
    },
    './telegram-bot': {
      getTelegramBotToken: async () => state.token,
      isTelegramCaptureActive: () => state.capture,
      editTelegramMessage: async (...args) => { state.edits.push(args); if (state.editError) throw state.editError; return true },
    },
    './launch-reports/telegram': {
      ...flow,
      generateTelegramLaunchReport: async selection => {
        state.generateCalls++
        if (state.onGenerate) await state.onGenerate(selection)
        if (state.generateError) throw state.generateError
        const report = copy(fixture)
        report.request.modelId = selection.modelId
        report.modelId = selection.modelId
        return fakeResult(report)
      },
      renderTelegramLaunchReport: (report, selection) => {
        state.renderCalls++
        assert.equal(report.modelId, selection.modelId)
        return fakeResult(report)
      },
    },
    './launch-report-delivery': { sendLaunchReportImage: async (token, chatId, result) => {
      state.sends.push({ token, chatId, ...result })
      return state.delivery
    } },
  }
  const loadWorker = () => createSourceLoader(overrides)(modulePath)
  const worker = loadWorker()
  const params = (extra = {}) => ({ chatId: '1234', telegramId: 1234, messageId: 77, selection: { modelId: 'pumpfun' }, ...extra })
  const job = id => state.rows.get(id).data
  return { state, worker, loadWorker, params, job }
}

try {
  await test('duplicate clicks create one durable job and one delivery', async () => {
    const h = harness()
    const clicked = await Promise.all([h.worker.queueLaunchReport(h.params()), h.worker.queueLaunchReport(h.params())])
    assert.equal(h.state.rows.size, 1)
    assert.equal(clicked.filter(result => !result.duplicate).length, 1)
    await h.worker.runLaunchReportJobs()
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.sends.length, 1)
    const finished = h.job(clicked[0].job._id)
    assert.equal(finished.status, 'complete')
    assert.equal(finished.deliveredMessageId, 900)
    assert.equal((await h.worker.queueLaunchReport(h.params())).duplicate, true)
  })

  await test('independent workers claim the same queued job atomically', async () => {
    const h = harness()
    await h.worker.queueLaunchReport(h.params())
    const secondWorker = h.loadWorker()
    await Promise.all([h.worker.runLaunchReportJobs(), secondWorker.runLaunchReportJobs()])
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.sends.length, 1)
    assert.equal([...h.state.rows.values()][0].data.status, 'complete')
  })

  await test('same-process workers share their active run', async () => {
    const h = harness()
    await h.worker.queueLaunchReport(h.params())
    const firstRun = h.worker.runLaunchReportJobs()
    const secondRun = h.worker.runLaunchReportJobs()
    assert.equal(firstRun, secondRun)
    await firstRun
    assert.equal(h.state.sends.length, 1)
  })

  await test('worker batches are bounded and remaining jobs persist for the next run', async () => {
    const h = harness()
    for (const chatId of ['1234', '1235', '1236']) await h.worker.queueLaunchReport(h.params({ chatId }))
    assert.equal((await h.worker.runLaunchReportJobs()).processed, 2)
    assert.equal(h.state.sends.length, 2)
    assert.equal([...h.state.rows.values()].filter(row => row.data.status === 'queued').length, 1)
    assert.equal((await h.worker.runLaunchReportJobs()).processed, 1)
    assert.equal(h.state.sends.length, 3)
  })

  await test('capture worker uses capture permissions without querying real team access', async () => {
    const h = harness()
    h.state.capture = true
    h.state.allowed = false
    await h.worker.queueLaunchReport(h.params())
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.sends.length, 1)
    assert.equal(h.state.accessCalls, 0)
  })

  await test('failed delivery retries the frozen report without fetching live inputs', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.delivery = { status: 'rejected' }
    await h.worker.runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.job(queued.job._id).deliveryUncertain, false)
    const firstBytes = h.state.sends[0].png
    const saved = copy(h.job(queued.job._id).report)
    h.state.generateError = new Error('Live preparation must not run on a delivery retry')
    h.state.delivery = { status: 'sent', messageId: 901 }
    assert.equal((await h.worker.queueLaunchReport(h.params())).duplicate, false)
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.renderCalls, 1)
    assert.deepEqual(h.state.sends[1].png, firstBytes)
    assert.deepEqual(h.job(queued.job._id).report, saved)
    assert.equal(h.job(queued.job._id).deliveredMessageId, 901)
  })

  await test('membership revoked after queuing prevents generation and delivery', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.allowed = false
    await h.worker.runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'cancelled')
    assert.equal(h.state.generateCalls, 0)
    assert.equal(h.state.sends.length, 0)
  })

  await test('membership revoked during calculation prevents the finished report from being sent', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.onGenerate = async () => { h.state.allowed = false }
    await h.worker.runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'cancelled')
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.accessCalls, 2)
    assert.equal(h.state.sends.length, 0)
  })

  await test('group permissions are rechecked by the worker', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params({ chatId: '-1000' }))
    h.state.profile = 'finance'
    await h.worker.runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'cancelled')
    assert.equal(h.state.generateCalls, 0)
  })

  await test('unknown delivery is never automatically repeated', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.delivery = { status: 'uncertain' }
    await h.worker.runLaunchReportJobs()
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.job(queued.job._id).deliveryUncertain, true)
    assert.equal(h.state.sends.length, 1)
    assert.match(h.state.edits.at(-1)[3], /Check this chat for the PNG before tapping Try again/)
  })

  await test('restart recovers an expired calculation lease', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    Object.assign(h.job(queued.job._id), { status: 'running', version: 1, leaseUntil: '2000-01-01T00:00:00.000Z' })
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'complete')
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.sends.length, 1)
  })

  await test('restart marks an expired send lease uncertain without resending', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    Object.assign(h.job(queued.job._id), { status: 'sending', version: 2, report: copy(fixture), leaseUntil: '2000-01-01T00:00:00.000Z' })
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.job(queued.job._id).deliveryUncertain, true)
    assert.equal(h.state.generateCalls, 0)
    assert.equal(h.state.sends.length, 0)
    assert.match(h.state.edits.at(-1)[3], /Check this chat/)
  })

  await test('unexpired leases cannot be reclaimed by another worker', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    Object.assign(h.job(queued.job._id), { status: 'running', version: 1, leaseUntil: '2999-01-01T00:00:00.000Z' })
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'running')
    assert.equal(h.state.generateCalls, 0)
    assert.equal(h.state.sends.length, 0)
  })

  await test('a stale calculation cannot send after another worker has recovered its lease', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    let releaseOriginal
    let generationStarted
    const started = new Promise(resolve => { generationStarted = resolve })
    const held = new Promise(resolve => { releaseOriginal = resolve })
    h.state.onGenerate = async () => {
      h.state.onGenerate = null
      generationStarted()
      await held
    }
    const originalRun = h.worker.runLaunchReportJobs()
    await started
    h.job(queued.job._id).leaseUntil = '2000-01-01T00:00:00.000Z'
    await h.loadWorker().runLaunchReportJobs()
    releaseOriginal()
    await originalRun
    assert.equal(h.job(queued.job._id).status, 'complete')
    assert.equal(h.state.generateCalls, 2)
    assert.equal(h.state.sends.length, 1, 'Only the worker holding the current version may deliver')
  })

  await test('queue storage failure rejects without generating or sending', async () => {
    const h = harness()
    h.state.failStorage = operation => operation.method === 'POST'
    await assert.rejects(h.worker.queueLaunchReport(h.params()), /Fixture storage unavailable/)
    assert.equal(h.state.rows.size, 0)
    assert.equal(h.state.generateCalls, 0)
    assert.equal(h.state.sends.length, 0)
  })

  await test('report persistence failure prevents delivery', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.failStorage = operation => operation.method === 'PATCH' && operation.body?.data.status === 'sending'
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.generateCalls, 1)
    assert.equal(h.state.sends.length, 0)
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.job(queued.job._id).report, undefined)
  })

  await test('completion storage failure preserves frozen report and marks delivery uncertain', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.failStorage = operation => operation.method === 'PATCH' && operation.body?.data.status === 'complete'
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.sends.length, 1)
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.job(queued.job._id).deliveryUncertain, true)
    assert.deepEqual(h.job(queued.job._id).report, fixture)
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.state.sends.length, 1)
  })

  await test('completion message failure cannot reopen an already delivered job', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.editError = new Error('Fixture completion message edit failed')
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.sends.length, 1)
    assert.equal(h.job(queued.job._id).status, 'complete')
    assert.equal(h.job(queued.job._id).deliveredMessageId, 900)
    assert.equal((await h.worker.queueLaunchReport(h.params())).duplicate, true)
    await h.loadWorker().runLaunchReportJobs()
    assert.equal(h.state.sends.length, 1)
  })

  await test('generation failure exposes a plain retry and succeeds on explicit retry', async () => {
    const h = harness()
    const queued = await h.worker.queueLaunchReport(h.params())
    h.state.generateError = new Error('Sensitive fixture RPC details must stay out of the bot message')
    await h.worker.runLaunchReportJobs()
    assert.equal(h.job(queued.job._id).status, 'failed')
    assert.equal(h.state.sends.length, 0)
    assert.match(h.state.edits.at(-1)[3], /Please try again in a moment/)
    assert.doesNotMatch(h.state.edits.at(-1)[3], /Sensitive fixture RPC/)
    assert.equal(h.state.edits.at(-1)[4].replyMarkup.inline_keyboard[0][0].text, 'Try again')
    h.state.generateError = null
    await h.worker.queueLaunchReport(h.params())
    await h.worker.runLaunchReportJobs()
    assert.equal(h.state.generateCalls, 2)
    assert.equal(h.state.sends.length, 1)
    assert.equal(h.job(queued.job._id).status, 'complete')
  })

  await test('invalid callback selections and message identifiers never enter storage', async () => {
    const h = harness()
    await assert.rejects(h.worker.queueLaunchReport(h.params({ messageId: -1 })), /new report/)
    await assert.rejects(h.worker.queueLaunchReport(h.params({ selection: { modelId: 'pumpfun', liquidity: '9000' } })), /liquidity/)
    assert.equal(h.state.operations.length, 0)
  })

  // Exercise real multipart delivery independently, with every HTTP response captured.
  await test('PNG delivery sends the original image and result keyboard', async () => {
    const requests = []
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 903 } }), { status: 200 })
    }
    const delivery = createSourceLoader({ './telegram-bot': { isTelegramCaptureActive: () => false } })(deliveryPath)
    const image = { png: Buffer.from('fixture original PNG'), filename: 'ghost-pumpfun-launch-report.png', caption: 'Report prepared', replyMarkup: { inline_keyboard: [[{ text: 'New report', callback_data: 'lm:home' }]] } }
    assert.deepEqual(await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image), { status: 'sent', messageId: 903 })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://api.telegram.org/botTEST_ONLY_TOKEN/sendDocument')
    const { body, signal } = requests[0].options
    assert.equal(body.get('chat_id'), '1234')
    assert.equal(body.get('caption'), image.caption)
    assert.deepEqual(JSON.parse(body.get('reply_markup')), image.replyMarkup)
    assert.equal(body.get('document').type, 'image/png')
    assert.equal(body.get('document').name, image.filename)
    assert.deepEqual(Buffer.from(await body.get('document').arrayBuffer()), image.png)
    assert.ok(signal instanceof AbortSignal)
  })

  await test('Telegram rejection differs from unknown network or invalid gateway responses', async () => {
    const delivery = createSourceLoader({ './telegram-bot': { isTelegramCaptureActive: () => false } })(deliveryPath)
    const image = { png: Buffer.from('PNG'), filename: 'report.png', caption: 'Report', replyMarkup: { inline_keyboard: [] } }
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Fixture rejection' }), { status: 429 })
    assert.deepEqual(await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image), { status: 'rejected' })
    globalThis.fetch = async () => new Response('<h1>Gateway failure</h1>', { status: 502 })
    assert.deepEqual(await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image), { status: 'uncertain' })
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    assert.deepEqual(await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image), { status: 'uncertain' })
    globalThis.fetch = async () => { throw new TypeError('Fixture connection closed after send') }
    assert.deepEqual(await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image), { status: 'uncertain' })
  })

  await test('capture mode records an image without making network requests', async () => {
    const captures = []
    let accepted = true
    const delivery = createSourceLoader({ './telegram-bot': {
      isTelegramCaptureActive: () => true,
      sendTelegramDocument: async (...args) => { captures.push(args); return accepted },
    } })(deliveryPath)
    globalThis.fetch = async () => { throw new Error('Capture must not use the network') }
    const image = { png: Buffer.from('PNG'), filename: 'report.png', caption: 'Fixture report', replyMarkup: { inline_keyboard: [] } }
    assert.equal((await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image)).status, 'sent')
    assert.equal(captures.length, 1)
    assert.deepEqual(captures[0].slice(0, 5), ['TEST_ONLY_TOKEN', '1234', image.png, image.caption, image.filename])
    assert.deepEqual(captures[0][5], { replyMarkup: image.replyMarkup })
    accepted = false
    assert.equal((await delivery.sendLaunchReportImage('TEST_ONLY_TOKEN', '1234', image)).status, 'rejected')
  })
} finally { globalThis.fetch = originalFetch }

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure.name}\n${failure.error.stack}\n`)
  process.exitCode = 1
} else process.stdout.write(`PASS: ${passed} durable job, permission, recovery, retry and original PNG delivery checks. No Telegram messages were sent.\n`)
