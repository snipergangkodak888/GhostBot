#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import path from 'node:path'
import { createSourceLoader, projectRoot } from './launch-report-runtime.mjs'

const priorFetch = globalThis.fetch, priorEnv = { NODE_ENV: process.env.NODE_ENV, APP_BASE_URL: process.env.APP_BASE_URL, NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL }
let adminCookie, botLookups = 0, rejectTelegram = false
const botToken = '12345:test-token-not-real'
const calls = []
const load = createSourceLoader({
  'next/headers': { cookies: () => ({ get: name => name === 'admin_token' && adminCookie ? { value: adminCookie } : undefined }) },
  '@/lib/auth': { verifyAdminToken: async token => {
    if (token === 'expired') throw new Error('Expired test credential')
    return { sub: 'test', role: token === 'admin' ? 'admin' : 'member' }
  } },
  '@/lib/telegram-bot': { getTelegramBotToken: async () => { botLookups++; return botToken } },
})
const { telegramWebhookSecret, isTelegramWebhookRequest, isLocalWebhookSetupRequest } = load(path.join(projectRoot, 'lib/telegram-webhook-auth.ts'))
const legacy = load(path.join(projectRoot, 'app/api/telegram/set-webhook/route.ts'))
const admin = load(path.join(projectRoot, 'app/api/admin/setup-webhook/route.ts'))
globalThis.fetch = async (url, options = {}) => {
  assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot12345:test-token-not-real\/(setWebhook|deleteWebhook|getWebhookInfo)$/)
  calls.push({ method: String(url).split('/').at(-1), body: options.body ? JSON.parse(options.body) : undefined })
  return Response.json(rejectTelegram ? { ok: false, description: 'Test rejection' } : { ok: true, result: {} })
}
const request = (url = 'https://ghost.test/api/telegram/set-webhook', headers = {}) => new Request(url, { method: 'POST', headers })
const adminRequest = () => new Request('https://ghost.test/api/admin/setup-webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookUrl: 'https://ghost.test/api/telegram/webhook' }) })

try {
  const secret = telegramWebhookSecret(botToken)
  assert.equal(secret, createHmac('sha256', botToken).update('ghostbot:telegram-webhook:v1').digest('hex'))
  assert.match(secret, /^[a-zA-Z0-9_-]{1,256}$/)
  assert.notEqual(secret, botToken)
  assert.notEqual(secret, telegramWebhookSecret('rotated-token'))
  assert.throws(() => telegramWebhookSecret(''), /required/)
  assert.equal(isTelegramWebhookRequest(request(), botToken), false)
  assert.equal(isTelegramWebhookRequest(request(undefined, { 'X-Telegram-Bot-Api-Secret-Token': secret }), botToken), true)
  assert.equal(isTelegramWebhookRequest(request(undefined, { 'X-Telegram-Bot-Api-Secret-Token': secret }), 'rotated-token'), false)
  assert.equal(isTelegramWebhookRequest(request(undefined, { 'X-Telegram-Bot-Api-Secret-Token': secret }), ''), false)
  for (const invalid of ['', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65), 'a'.repeat(500), secret.toUpperCase(), `${secret}, ${secret}`]) {
    assert.equal(isTelegramWebhookRequest(request(undefined, { 'x-telegram-bot-api-secret-token': invalid }), botToken), false)
  }

  process.env.NODE_ENV = 'production'
  process.env.APP_BASE_URL = 'https://ghost.test'
  delete process.env.NEXT_PUBLIC_BASE_URL
  for (const credential of [undefined, 'expired', 'member']) {
    adminCookie = credential
    assert.equal((await legacy.POST(request())).status, 401)
    assert.equal((await legacy.DELETE(request())).status, 401)
    assert.equal((await admin.POST(adminRequest())).status, 401)
    assert.equal((await admin.GET()).status, 401)
  }
  adminCookie = undefined
  assert.equal((await legacy.POST(request('http://127.0.0.1:3000/api/telegram/set-webhook'))).status, 401, 'Production loopback still requires admin')
  assert.equal(botLookups, 0, 'Unauthenticated callers must not access bot configuration')
  assert.equal(calls.length, 0, 'Unauthenticated callers must not change or inspect the webhook')

  adminCookie = 'admin'
  for (const call of [() => legacy.POST(request()), () => admin.POST(adminRequest())]) {
    const response = await call()
    assert.equal(response.status, 200)
    const registration = calls.findLast(call => call.method === 'setWebhook')
    assert.equal(registration.body.secret_token, secret)
    assert.equal(registration.body.url, 'https://ghost.test/api/telegram/webhook')
    assert.equal(registration.body.drop_pending_updates, false)
    assert.deepEqual(registration.body.allowed_updates, ['message', 'callback_query', 'pre_checkout_query', 'chat_member', 'my_chat_member'])
    const returned = await response.text()
    assert.ok(!returned.includes(secret) && !returned.includes(botToken), 'Do not return webhook/API credentials')
  }
  assert.equal((await legacy.DELETE(request())).status, 200)
  assert.equal(calls.at(-1).method, 'deleteWebhook')
  rejectTelegram = true
  assert.equal((await legacy.POST(request())).status, 502, 'Failed registration must not report success')
  assert.equal((await legacy.DELETE(request())).status, 502, 'Failed deletion must not report success')
  rejectTelegram = false

  process.env.NODE_ENV = 'development'
  adminCookie = undefined
  for (const url of ['http://localhost:3000/api/telegram/set-webhook', 'http://127.0.0.1:3000/api/telegram/set-webhook', 'http://[::1]:3000/api/telegram/set-webhook']) {
    assert.equal(isLocalWebhookSetupRequest(request(url)), true)
    assert.equal((await legacy.POST(request(url))).status, 200)
  }
  assert.equal((await legacy.POST(request())).status, 401, 'A public development tunnel is not an admin bypass')
  for (const headers of [{ host: 'other.test' }, { 'x-forwarded-host': 'public-tunnel.test' }, { origin: 'https://other.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal(isLocalWebhookSetupRequest(request('http://localhost:3000/api/telegram/set-webhook', headers)), false)
    assert.equal((await legacy.POST(request('http://localhost:3000/api/telegram/set-webhook', headers))).status, 401)
  }
  process.stdout.write('PASS: derived webhook secret, constant-time verification, invalid/missing header rejection, production admin-only setup/removal, both registrations, API failure handling, local dev bootstrap and tunnel/CSRF rejection.\n')
} finally {
  globalThis.fetch = priorFetch
  for (const [key, value] of Object.entries(priorEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value
}
