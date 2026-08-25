import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const deliveries = new Map()
const sentMessages = []
const subscriptions = [{ chatId: "-100200300", kind: "group", label: "Finance Chat" }]
const launchSubscriptions = [{ chatId: "-100400500", kind: "group", label: "Launch Chat" }]

function cursor(rows) {
  return {
    toArray: async () => rows,
  }
}

const collections = {
  guardMembers: [{ telegramId: 111, status: "active", username: "member" }],
  opsHostedGroups: [{ chatId: "-999", status: "active", title: "Unsubscribed Group" }],
  opsProjects: [{ status: "active" }],
  opsReminders: [],
  opsPayroll: [],
  opsSheets: [],
}

const db = {
  collection(name) {
    return {
      find: () => cursor(collections[name] || []),
      findOne: async ({ key }) => deliveries.get(key) || null,
      insertOne: async (row) => {
        if (name === "opsCronDeliveries") deliveries.set(row.key, row)
        return { insertedId: row.key || "test" }
      },
      updateOne: async () => ({ modifiedCount: 1 }),
    }
  },
}

const source = fs.readFileSync("lib/ops-cron.ts", "utf8")
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }

function localRequire(id) {
  if (id === "@/lib/db") return { getDb: async () => db }
  if (id === "@/lib/ops-sheets") {
    return { calculateSheetFinancials: () => ({ incomeToday: 100, expenseToday: 10, payrollToday: 5, profitToday: 85, profitThisWeek: 85, profitThisMonth: 85 }) }
  }
  if (id === "@/lib/telegram-bot") {
    return {
      getTelegramBotToken: async () => "test-token",
      sendTelegramText: async (_token, chatId, text) => {
        sentMessages.push({ chatId: String(chatId), text })
        return true
      },
      sendTelegramMessage: async () => 1,
    }
  }
  if (id === "@/lib/team-timezone") {
    return { TEAM_TIME_ZONE: "America/New_York", formatTeamDateTime: () => "test time", nextRecurringDueAt: () => null }
  }
  if (id === "@/lib/chat-subscriptions") {
    return { getSubscribedChats: async (purpose) => purpose === "finance" ? subscriptions : purpose === "launches" ? launchSubscriptions : [] }
  }
  if (id === "@/lib/launch-calendar") {
    return { LAUNCH_TIME_ZONE: "America/New_York", formatLaunchDaySchedule: async () => "Today’s Launches — Saturday, Aug 22\n\nTBD — Test · Solana · Other MM plugin", getLaunchesForDay: async () => [{ name: "Test" }], launchDateKey: () => "2026-08-22" }
  }
  if (id === "@/lib/revenue-service") {
    return { ensureDailyTradingFeeExpectations: async () => ({}), valuePendingRevenueReceipts: async () => ({}) }
  }
  if (id === "@/lib/project-lifecycle") {
    return { projectActivationReadiness: () => ({ ready: true, missing: [], chain: "", quoteToken: "" }), projectLaunchAt: () => null }
  }
  if (id === "@/lib/launch-method") {
    return { launchMethodLabel: () => "Other MM plugin", normalizeLaunchMethod: () => "other_mm_plugin" }
  }
  if (id === "@/lib/launch-math") {
    return { launchPad: () => null }
  }
  throw new Error(`Unexpected import: ${id}`)
}

vm.runInNewContext(`(function (exports, require, module, process) { ${output}\n})(module.exports, require, module, process)`, {
  module,
  require: localRequire,
  process,
})

const now = new Date("2026-08-22T15:00:00.000Z")
const first = await module.exports.runOpsSuperCron(now)
assert.equal(Object.hasOwn(first, "financeSummary"), false)
assert.deepEqual(sentMessages, [])
assert.equal(sentMessages.some((message) => message.chatId === "111"), false)
assert.equal(sentMessages.some((message) => message.chatId === "-999"), false)

const second = await module.exports.runOpsSuperCron(now)
assert.equal(Object.hasOwn(second, "financeSummary"), false)
assert.equal(sentMessages.length, 0)

const eightAmEt = await module.exports.runOpsSuperCron(new Date("2026-08-22T12:00:00.000Z"))
assert.equal(eightAmEt.calendar.hourEt, 8)
assert.equal(eightAmEt.calendar.sent, 1)
assert.deepEqual(sentMessages, [{ chatId: "-100400500", text: "Today’s Launches — Saturday, Aug 22\n\nTBD — Test · Solana · Other MM plugin" }])
const eightAmEtRepeat = await module.exports.runOpsSuperCron(new Date("2026-08-22T12:05:00.000Z"))
assert.equal(eightAmEtRepeat.calendar.skipped, 1)
assert.equal(sentMessages.length, 1)

subscriptions.length = 0
const nextDay = await module.exports.runOpsSuperCron(new Date("2026-08-23T15:00:00.000Z"))
assert.equal(Object.hasOwn(nextDay, "financeSummary"), false)
assert.equal(sentMessages.length, 1)

console.log("PASS: no automatic Trade Floor or Finance Chat report is sent, while Launch Chat receives one compact 8 AM ET calendar.")
