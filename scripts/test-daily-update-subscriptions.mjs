import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const deliveries = new Map()
const sentMessages = []
const subscriptions = [{ chatId: "-100200300", kind: "group", label: "Daily Updates" }]

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
    }
  }
  if (id === "@/lib/team-timezone") {
    return { TEAM_TIME_ZONE: "America/New_York", formatTeamDateTime: () => "test time", nextRecurringDueAt: () => null }
  }
  if (id === "@/lib/chat-subscriptions") {
    return { getSubscribedChats: async (purpose) => purpose === "performance" ? subscriptions : [] }
  }
  if (id === "@/lib/launch-calendar") {
    return { LAUNCH_TIME_ZONE: "America/New_York", formatLaunchDaySchedule: async () => "launches", getLaunchesForDay: async () => [], launchDateKey: () => "2026-08-22" }
  }
  if (id === "@/lib/revenue-service") {
    return { ensureDailyTradingFeeExpectations: async () => ({}), valuePendingRevenueReceipts: async () => ({}) }
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
assert.equal(first.dailyPerformance.recipients, 1)
assert.equal(first.dailyPerformance.sent, 1)
assert.deepEqual(sentMessages.map((message) => message.chatId), ["-100200300"])
assert.match(sentMessages[0].text, /Daily Project Performance/)
assert.equal(sentMessages.some((message) => message.chatId === "111"), false)
assert.equal(sentMessages.some((message) => message.chatId === "-999"), false)

const second = await module.exports.runOpsSuperCron(now)
assert.equal(second.dailyPerformance.sent, 0)
assert.equal(second.dailyPerformance.skipped, 1)
assert.equal(sentMessages.length, 1)

subscriptions.length = 0
const nextDay = await module.exports.runOpsSuperCron(new Date("2026-08-23T15:00:00.000Z"))
assert.equal(nextDay.dailyPerformance.recipients, 0)
assert.equal(nextDay.dailyPerformance.sent, 0)
assert.equal(sentMessages.length, 1)

console.log("PASS: daily project updates are sent once only to explicitly subscribed chats.")
