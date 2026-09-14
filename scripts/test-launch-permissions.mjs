#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import ts from 'typescript'

// Exercise the real handlers and action executor without Telegram or a live database.
const rows = new Map()
const reads = []
const messages = []
let nextId = 1
const clone = (value) => structuredClone(value)
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (value && typeof value === 'object') {
    if ('$ne' in value) return String(row[key]) !== String(value.$ne)
    if ('$in' in value) return value.$in.map(String).includes(String(row[key]))
  }
  return String(row[key]) === String(value)
})
const db = { collection(name) {
  if (!rows.has(name)) rows.set(name, [])
  const items = rows.get(name)
  return {
    async findOne(query) { reads.push(name); return clone(items.find(row => matches(row, query)) || null) },
    find(query = {}) {
      reads.push(name)
      let found = items.filter(row => matches(row, query))
      return { sort() { return this }, limit(n) { found = found.slice(0, n); return this }, async toArray() { return clone(found) } }
    },
    async insertOne(row) {
      const _id = row._id || `test-${nextId++}`
      items.push(clone({ ...row, _id }))
      return { insertedId: _id }
    },
    async updateOne(query, update, options = {}) {
      let row = items.find(item => matches(item, query))
      if (!row && options.upsert) {
        row = { ...query, ...update.$setOnInsert, _id: query._id || `test-${nextId++}` }
        items.push(row)
      }
      if (row) {
        Object.assign(row, clone(update.$set || {}))
        for (const key of Object.keys(update.$unset || {})) delete row[key]
      }
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 }
    },
    async deleteOne(query) {
      const index = items.findIndex(row => matches(row, query))
      if (index >= 0) items.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  }
} }

const overrides = {
  'server-only': {},
  '@/lib/db': { getDb: async () => db },
  '@/lib/telegram-user-client': {},
  '@/lib/trader-schedule-image': {},
  '@/lib/payroll-report-image': {},
  '@/lib/ops-sheets': { createDefaultSheetsForProject: async () => {} },
  '@/lib/telegram-bot': {
    isTelegramCaptureActive: () => false,
    getTelegramBotUsername: () => 'test_bot',
    sendTelegramMessage: async (_token, chatId, text, options) => { messages.push({ chatId, text, options }); return nextId++ },
    editTelegramMessage: async (_token, chatId, messageId, text, options) => { messages.push({ chatId, messageId, text, options }); return true },
    sendChatAction: async () => {},
    telegramApi: async () => true,
    telegramApiJson: async (_token, method) => {
      assert.equal(method, 'deleteMessage', 'Tests must not send live Telegram requests')
      return { ok: true }
    },
    withTelegramLoading: async (_token, chatId, options) => {
      const result = await options.work()
      messages.push({ chatId, text: result.text })
    },
  },
}
const modules = new Map()
function load(file, extra = '') {
  const absolute = path.resolve(file)
  if (modules.has(absolute)) return modules.get(absolute).exports
  const loaded = new Module(absolute)
  loaded.filename = absolute
  loaded.paths = Module._nodeModulePaths(process.cwd())
  modules.set(absolute, loaded)
  const baseRequire = loaded.require.bind(loaded)
  loaded.require = (id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`)
    if (id.startsWith('.') && fs.existsSync(path.resolve(path.dirname(absolute), `${id}.ts`))) return load(path.resolve(path.dirname(absolute), `${id}.ts`))
    return baseRequire(id)
  }
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  loaded._compile(code, absolute)
  return loaded.exports
}
const permissions = load('lib/bot-permissions.ts')
const access = load('lib/team-access.ts')
const ops = load('lib/ops-bot.ts')
const webhook = load('app/api/telegram/webhook/route.ts', '\nexport { handleCallback, processState, routeText, getLaunchSetupAction, aiPermissionPolicy };')
const req = { nextUrl: new URL('http://localhost:3000/api/telegram/webhook') }
const chatId = -100
const memberId = 2
const adminId = 3
const dmId = 4
for (const [telegramId, role, launchDmAccess] of [[1, 'member', false], [memberId, 'member', false], [adminId, 'admin', false], [dmId, 'member', true]]) {
  await db.collection('guardMembers').insertOne({ _id: `member-${telegramId}`, telegramId, accessRole: role, launchDmAccess, status: 'active', timeZone: 'America/New_York' })
}
await db.collection('opsChatProfiles').insertOne({ chatId: String(chatId), profile: 'launch', status: 'active' })
await db.collection('opsChatProfiles').insertOne({ chatId: '-200', profile: 'trade', status: 'active' })
const payload = {
  name: 'Shared Launch', launchAt: '2030-09-09T18:00:00Z', launchTimeZone: 'America/New_York',
  launchVenue: 'pump_fun', launchMethod: 'sumo', chain: 'solana', quoteToken: 'SOL',
  referrerStatus: 'none', feeConfigurationConfirmed: true, dailyTradingFeeEnabled: true,
  dailyTradingFeeUsd: 500, launchFeeUsd: 1000,
}
async function draft(id, changes = {}) {
  await db.collection('opsAiActions').insertOne({ _id: id, actionType: 'create_project', telegramId: 1, chatId: String(chatId), permissionScope: 'launch', allowedActionTypes: ['create_project'], status: 'pending', payload: clone(payload), ...changes })
}
async function callback(user, data, sourceChat = chatId) {
  messages.length = 0
  await webhook.handleCallback('test', sourceChat, user, data, req, { message_id: 100, chat: { id: sourceChat } })
  return messages.map(message => message.text).join('\n')
}

await draft('shared')
for (const user of [memberId, adminId]) {
  assert.match(await callback(user, 'launchsetup:noref:shared'), /No referrer confirmed/)
}
await callback(memberId, 'launchsetup:name:shared')
assert.equal((await db.collection('opsBotStates').findOne({ telegramId: memberId })).action, 'launch_setup_name')
await webhook.processState('test', chatId, memberId, 'Renamed Shared Launch', Date.now(), { message_id: 101 })
assert.equal((await db.collection('opsAiActions').findOne({ _id: 'shared' })).payload.name, 'Renamed Shared Launch')
assert.equal((await db.collection('opsAiActions').findOne({ _id: 'shared' })).telegramId, 1, 'Editing must preserve the creator')
assert.match(await callback(adminId, 'launchsetup:create:shared'), /Launch scheduled successfully/)
assert.equal((await db.collection('opsAiActions').findOne({ _id: 'shared' })).executedByTelegramId, adminId)
const projectCount = rows.get('opsProjects').length
assert.match(await callback(memberId, 'launchsetup:create:shared'), /already confirmed/)
assert.equal(rows.get('opsProjects').length, projectCount, 'Replaying confirmation must not create a duplicate')
assert.match(await ops.rejectOpsAiAction('shared', memberId, { currentChatId: chatId }), /already confirmed/)

// Open launches and reminder buttons must use the same contextual timing flow.
const timingProjectId = 'timing-launch'
await db.collection('opsProjects').insertOne({ ...payload, _id: timingProjectId, status: 'scheduled', launchTimingStatus: 'confirmed', scheduleVersion: 1 })
const timingProject = () => db.collection('opsProjects').findOne({ _id: timingProjectId })
const lastButtons = () => messages.at(-1)?.options?.replyMarkup?.inline_keyboard?.flat() || []
function buttonWithText(label) {
  const button = lastButtons().find(item => item.text === label)
  assert.ok(button?.callback_data, `Missing ${label}: ${JSON.stringify(messages.at(-1))}`)
  return button.callback_data
}
async function timingReply(text, user = memberId, sourceChat = chatId) {
  messages.length = 0
  await webhook.routeText('test', sourceChat, user, text, req, Date.now(), { message_id: 101, chat: { id: sourceChat } })
  return messages.map(message => message.text).join('\n')
}
async function editTiming(user = memberId, sourceChat = chatId) {
  const project = await timingProject()
  await callback(user, `calendar:launch:${project._id}:${project.scheduleVersion}`, sourceChat)
  assert.match(await callback(user, buttonWithText('Change launch timing'), sourceChat), /Send the launch timing/)
}
function assertTimingCard() {
  assert.equal(messages.at(-1).messageId, 100, 'Saving must update the existing card')
  assert.match(messages.at(-1).text, /Notes\nNo notes yet/)
  assert.match(buttonWithText('Change launch timing'), /^calendar:timing:/)
}

// Calendar chain edits recover blank-chain launches and preserve unrelated settings.
const chainProjectId = 'chain-launch'
const chainProject = () => db.collection('opsProjects').findOne({ _id: chainProjectId })
await db.collection('opsProjects').insertOne({
  ...payload, _id: chainProjectId, status: 'scheduled', scheduleVersion: 1,
  chain: '', quoteToken: '', launchVenue: '', launchVenueLabel: '',
  notes: 'Keep this note', dailyTradingFeeEnabled: false, launchFeeUsd: 1250,
})
await callback(memberId, `calendar:launch:${chainProjectId}:1`)
assert.ok(buttonWithText('Change chain'))
assert.match(await callback(memberId, buttonWithText('Change launch venue / DEX')), /Choose the chain/)
const selectSolana = buttonWithText('Solana')
assert.match(await callback(memberId, selectSolana), /Chain updated to Solana/)
assert.equal(messages.at(-1).messageId, 100, 'Chain changes must edit the existing card')
assert.equal((await chainProject()).chain, 'solana')
assert.equal((await chainProject()).revenueChain, 'solana')
assert.equal((await chainProject()).quoteToken, 'SOL')
assert.deepEqual((await chainProject()).acceptedRevenueAssets, ['SOL', 'USDC'])
assert.match(await callback(memberId, buttonWithText('Stonks')), /Solana\/Stonks/)
const stonksProject = await chainProject()
assert.equal(stonksProject.launchVenue, 'stonks')
assert.equal(stonksProject.launchVenueLabel, 'Stonks')
assert.equal(stonksProject.launchFundingAsset, 'SOL')
assert.equal(stonksProject.launchAt, payload.launchAt)
assert.equal(stonksProject.notes, 'Keep this note')
assert.equal(stonksProject.dailyTradingFeeEnabled, false)
assert.equal(stonksProject.launchFeeUsd, 1250)
assert.match(await callback(memberId, selectSolana), /no longer available/)
assert.deepEqual(await chainProject(), stonksProject, 'Old chain buttons must not change the project')

// Selecting the current chain keeps custom quotes and multi-asset revenue settings.
await db.collection('opsProjects').updateOne({ _id: chainProjectId }, { $set: {
  quoteToken: 'CUSTOM', quoteAssets: ['CUSTOM'], quoteTokenAddress: 'original-contract', quoteTokenDecimals: 6,
  acceptedRevenueAssets: ['CUSTOM', 'SOL', 'USDC'],
} })
const customChainProject = await chainProject()
await callback(dmId, `calendar:chain:${chainProjectId}:${customChainProject.scheduleVersion}`, dmId)
await callback(dmId, buttonWithText('Solana'), dmId)
assert.deepEqual(await chainProject(), customChainProject)
await callback(memberId, `calendar:chain:${chainProjectId}:${customChainProject.scheduleVersion}`)
assert.match(await callback(memberId, buttonWithText('BNB Chain')), /Chain updated to BNB Chain/)
assert.equal(lastButtons().some(button => button.text === 'Stonks'), false)
const bnbProject = await chainProject()
assert.equal(bnbProject.chain, 'bnb')
assert.equal(bnbProject.launchVenue, '')
assert.equal(bnbProject.launchVenueLabel, '')
assert.equal(bnbProject.quoteToken, 'BNB')
assert.equal(bnbProject.quoteTokenAddress, '')
assert.equal(bnbProject.quoteTokenDecimals, null)
assert.deepEqual(bnbProject.acceptedRevenueAssets, ['BNB', 'USDC'])
assert.equal(bnbProject.launchAt, payload.launchAt)
assert.match(await callback(memberId, `calendar:setvenue:${chainProjectId}:stonks~${bnbProject.scheduleVersion}`), /no longer available/)
assert.match(await callback(memberId, `calendar:setchain:${chainProjectId}:invalid~${bnbProject.scheduleVersion}`), /no longer available/)
assert.match(await callback(memberId, `calendar:setchain:${chainProjectId}:sol~${bnbProject.scheduleVersion}`, memberId), /launch scheduling access/)
assert.deepEqual(await chainProject(), bnbProject)
await db.collection('opsProjects').updateOne({ _id: chainProjectId }, { $set: { status: 'inactive' } })
assert.match(await callback(memberId, `calendar:setchain:${chainProjectId}:sol~${bnbProject.scheduleVersion}`), /no longer available/)
assert.equal((await chainProject()).chain, 'bnb')
const venues = load('lib/launch-venues.ts')
assert.equal(venues.operationalLaunchVenue('stonks').calculatorSupported, false)
assert.equal(load('lib/project-lifecycle.ts').inferLaunchConfiguration('Mcdonalds on Stonks').launchVenue, 'stonks')

await timingReply('/calendar 2030-09-09')
await callback(memberId, buttonWithText('Open launches'))
const launchButton = lastButtons().find(button => button.callback_data.startsWith(`calendar:launch:${timingProjectId}:`))
assert.ok(launchButton, 'Open launches must include the scheduled project')
await callback(memberId, launchButton.callback_data)
assert.match(messages.at(-1).text, /Sep 9/)
await callback(memberId, buttonWithText('Change launch timing'))
const staleTimingCallback = `calendar:timing:${timingProjectId}:1`
assert.equal((await db.collection('opsBotStates').findOne({ telegramId: memberId })).returnToCalendar, true)
assert.match(await timingReply('3:30'), /AM or PM/)
assert.equal((await timingProject()).launchAt, payload.launchAt, 'Ambiguous input must not change the schedule')
assert.match(await timingReply('3:30 PM ET'), /rescheduled/)
assert.equal((await timingProject()).launchAt, '2030-09-09T19:30:00.000Z', 'A time alone must retain the launch date')
assert.equal(await db.collection('opsBotStates').findOne({ telegramId: memberId }), null)
assertTimingCard()
assert.match(await callback(memberId, staleTimingCallback), /already updated/)

await editTiming()
await timingReply('September 12, 2030')
assert.equal((await timingProject()).launchAt, '2030-09-12T19:30:00.000Z', 'A day alone must retain the launch time')
assert.equal(buttonWithText('Back to launches'), 'calendar:edit:2030-09-12')
assertTimingCard()

await editTiming()
assert.match(await timingReply('time TBD'), /is tentative/)
assert.equal((await timingProject()).launchAt, null)
assert.equal((await timingProject()).tentativeLaunchDate, '2030-09-12')
assertTimingCard()
await editTiming()
assert.match(await timingReply('September 13, 2030'), /What time should it launch/)
await timingReply('noon')
assert.equal((await timingProject()).launchAt, '2030-09-13T16:00:00.000Z', 'A follow-up time must use the requested day')
assert.equal((await timingProject()).launchTimingStatus, 'confirmed')
assertTimingCard()

await editTiming()
await callback(memberId, buttonWithText('Set time to TBD'))
assert.equal((await timingProject()).tentativeLaunchDate, '2030-09-13')
assertTimingCard()
await editTiming()
const beforeCancel = await timingProject()
assert.match(await timingReply('/cancel'), /Timing edit cancelled/)
assert.deepEqual(await timingProject(), beforeCancel)
assertTimingCard()

await editTiming()
await timingReply('/calendar 2030-09-13')
assert.equal(await db.collection('opsBotStates').findOne({ telegramId: memberId }), null, 'Calendar commands must leave timing entry')
await editTiming(dmId, dmId)
assert.match(await timingReply('2 PM PT', dmId, dmId), /rescheduled/)
assert.equal((await timingProject()).launchAt, '2030-09-13T21:00:00.000Z')
assertTimingCard()

// Existing reminder and older calendar buttons remain valid.
let currentTimingProject = await timingProject()
await callback(memberId, `lifecycle:delay:${timingProjectId}:${currentTimingProject.scheduleVersion}`)
assert.equal((await db.collection('opsBotStates').findOne({ telegramId: memberId })).returnToCalendar, false)
await timingReply('4 PM ET')
assert.equal((await timingProject()).launchAt, '2030-09-13T20:00:00.000Z')
assert.equal(lastButtons().length, 0, 'Reminder replies retain their completion message')
currentTimingProject = await timingProject()
await callback(memberId, `lifecycle:settime:${timingProjectId}:${currentTimingProject.scheduleVersion}`)
await callback(memberId, buttonWithText('Set time to TBD'))
assert.equal((await timingProject()).launchTimingStatus, 'tentative')
assert.equal(lastButtons().length, 0)
assert.match(await callback(memberId, `calendar:timing:${timingProjectId}:${(await timingProject()).scheduleVersion}`, -200), /not available/)

await editTiming()
await db.collection('opsProjects').updateOne({ _id: timingProjectId }, { $set: { scheduleVersion: (await timingProject()).scheduleVersion + 1 } })
assert.match(await timingReply('5 PM ET'), /already updated/, 'Another member’s timing update must not be overwritten')
assert.equal((await timingProject()).launchTimingStatus, 'tentative')
await db.collection('opsProjects').updateOne({ _id: timingProjectId }, { $set: { status: 'active' } })
await callback(memberId, `calendar:launch:${timingProjectId}:${(await timingProject()).scheduleVersion}`)
assert.ok(!lastButtons().some(button => button.text === 'Change launch timing'), 'Activated launches must not be rescheduled')

await draft('cancel-shared')
assert.match(await callback(memberId, 'launchsetup:cancel:cancel-shared'), /Refused/)
assert.equal((await db.collection('opsAiActions').findOne({ _id: 'cancel-shared' })).rejectedByTelegramId, memberId)
await draft('private', { chatId: '1' })
assert.match(await callback(memberId, 'launchsetup:noref:private'), /chat where it was started/)
assert.match(await callback(memberId, 'ai:confirm:private'), /chat where it was started/)
assert.match(await callback(memberId, 'launchsetup:noref:private', 1), /creator/)
await draft('other-chat', { chatId: '-300' })
assert.match(await callback(memberId, 'launchsetup:noref:other-chat'), /chat where it was started/)
assert.match(await callback(memberId, 'launchsetup:noref:other-chat', -200), /not available/)
await draft('not-launch', { actionType: 'create_payroll' })
assert.match(await ops.executeOpsAiAction('not-launch', memberId, { currentChatId: chatId, dataScope: 'launch', allowedActionTypes: ['create_project'] }), /could not find/)
assert.match(await ops.rejectOpsAiAction('not-launch', memberId, { currentChatId: chatId }), /could not find/)

const dmContext = await permissions.getBotPermissionContext({ telegramId: dmId, chatId: dmId })
assert.equal(dmContext.profile, 'launch')
assert.equal(dmContext.role, 'member')
assert.equal(permissions.canEditLaunchSchedule(dmContext), true)
for (const capability of ['finance', 'management', 'trade']) assert.equal(permissions.canUseBotCapability(dmContext, capability), false)
assert.equal(webhook.aiPermissionPolicy(dmContext).dataScope, 'launch')
assert.ok(webhook.aiPermissionPolicy(dmContext).allowedActionTypes.includes('create_project'))
assert.ok(!webhook.aiPermissionPolicy(dmContext).allowedActionTypes.includes('create_payroll'))
assert.equal((await permissions.getBotPermissionContext({ telegramId: dmId, chatId: -200 })).profile, 'trade', 'DM grant must not change group profiles')
await draft('dm-launch', { telegramId: dmId, chatId: String(dmId) })
assert.match(await callback(dmId, 'launchsetup:create:dm-launch', dmId), /Launch scheduled successfully/)

for (const command of ['/payroll', '/profit', '/report', '/fees', '/log test']) {
  reads.length = 0
  messages.length = 0
  await webhook.routeText('test', dmId, dmId, command, req, Date.now(), { chat: { id: dmId, type: 'private' } })
  assert.match(messages.map(message => message.text).join('\n'), /Financial, revenue, receipt, and payroll information is not available/)
  assert.ok(!reads.some(name => /payroll|revenue|treasury/i.test(name)), `${command} must be denied before reading financial data`)
}
for (const question of ['What is our treasury balance?', '/ai What is our payroll total?']) {
  reads.length = 0
  messages.length = 0
  await webhook.routeText('test', dmId, dmId, question, req, Date.now())
  assert.match(messages.map(message => message.text).join('\n'), /I can add, update, reschedule/)
  assert.ok(!reads.some(name => /payroll|revenue|treasury|opsSheets/i.test(name)), 'Financial questions must never reach the finance data reader')
}
messages.length = 0
await webhook.routeText('test', dmId, dmId, '/schedulelaunch', req, Date.now())
assert.match(messages.map(message => message.text).join('\n'), /Send the launch in natural language/)
const scheduledProject = rows.get('opsProjects')[0]
assert.match(await callback(dmId, `lifecycle:settime:${scheduledProject._id}:${scheduledProject.scheduleVersion}`, dmId), /Send the launch timing/)
assert.equal((await db.collection('opsBotStates').findOne({ telegramId: dmId })).action, 'reschedule_launch')
for (const data of ['payroll:add', 'payroll:paid:secret', 'receipt:confirm:secret', 'consol:confirm:secret', 'fee:confirm:secret']) {
  reads.length = 0
  assert.match(await callback(dmId, data, dmId), /Financial, revenue, receipt, and payroll information is not available/)
  assert.ok(!reads.some(name => /payroll|revenue|treasury/i.test(name)), 'Forged callbacks must not read finance data')
}
await db.collection('opsBotStates').updateOne({ telegramId: dmId }, { $set: { action: 'add_payroll', telegramChatId: String(dmId) } }, { upsert: true })
messages.length = 0
await webhook.processState('test', dmId, dmId, 'Secret | 100', Date.now())
assert.match(messages.map(message => message.text).join('\n'), /not available/)
assert.equal(await db.collection('opsBotStates').findOne({ telegramId: dmId }), null)

await access.updateGuardMemberLaunchDmAccess(`member-${dmId}`, false, 'test-admin')
assert.equal(permissions.canEditLaunchSchedule(await permissions.getBotPermissionContext({ telegramId: dmId, chatId: dmId })), false)
assert.equal((await access.getTeamAccess(dmId)).member.accessRole, 'member')
await access.updateGuardMemberLaunchDmAccess(`member-${dmId}`, true, 'test-admin')
await access.deactivateGuardMember(`member-${dmId}`)
const deactivated = await permissions.getBotPermissionContext({ telegramId: dmId, chatId: dmId })
assert.equal(permissions.canEditLaunchSchedule(deactivated), false)
assert.equal(permissions.canUseBotCapability(deactivated, 'launch'), false)
assert.equal(permissions.canUseBotCapability(await permissions.getBotPermissionContext({ telegramId: 999, chatId }), 'launch'), false)

let adminCookie = ''
overrides['next/headers'] = { cookies: () => ({ get: () => adminCookie ? { value: adminCookie } : undefined }) }
overrides['@/lib/auth'] = { verifyAdminToken: async token => {
  if (token !== 'valid-admin') throw new Error('Invalid admin token')
  return { sub: 'test-admin', role: 'admin' }
} }
const adminRoute = load('app/api/admin/guard-team/route.ts')
const grantRequest = { json: async () => ({ action: 'update-member-launch-dm-access', id: 'member-2', enabled: true }) }
assert.equal((await adminRoute.GET()).status, 401)
assert.equal((await adminRoute.POST(grantRequest)).status, 401)
adminCookie = 'invalid'
assert.equal((await adminRoute.POST(grantRequest)).status, 401)
adminCookie = 'valid-admin'
assert.equal((await adminRoute.POST(grantRequest)).status, 200)
assert.equal((await access.getTeamAccess(memberId)).member.launchDmAccess, true)
assert.equal((await access.getTeamAccess(memberId)).member.accessRole, 'member')
assert.equal(rows.get('opsPermissionAudit').at(-1).actor, 'test-admin')
assert.equal((await adminRoute.POST({ json: async () => ({ action: 'update-member-launch-dm-access', id: 'member-2', enabled: 'true' }) })).status, 400)
console.log('PASS: shared drafts, calendar chain/venue edits, Stonks, calendar/reminder timing edits, TBD, stale schedules, chat isolation, launch DMs, financial denials, revocation, and admin-only access changes.')
