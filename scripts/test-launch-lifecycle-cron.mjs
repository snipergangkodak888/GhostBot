#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const deliveries = new Map()
const messages = []
let resumedActivations = 0
const projects = [{
  _id: "kolcoin",
  name: "KOLcoin",
  status: "scheduled",
  launchAt: "2026-08-24T18:00:00.000Z",
  launchTimeZone: "America/New_York",
  launchChatId: "-1001",
  scheduleVersion: 1,
  activationPromptCount: 0,
  launchVenue: "pumpfun",
  chain: "solana",
  quoteToken: "SOL",
}]

const cursor = (items) => ({ toArray: async () => items })
const db = { collection(name) { return {
  find: () => cursor(name === "opsProjects" ? projects : []),
  findOne: async (filter) => name === "opsProjects"
    ? projects.find((row) => Object.entries(filter || {}).every(([key, value]) => String(row[key]) === String(value))) || null
    : deliveries.get(filter?.key) || null,
  insertOne: async (row) => { if (name === "opsCronDeliveries") deliveries.set(row.key, row); return { insertedId: row.key || "1" } },
  deleteOne: async ({ key }) => { const deleted = deliveries.delete(key); return { deletedCount: deleted ? 1 : 0 } },
  updateOne: async (filter, update) => {
    const project = projects.find((row) => String(row._id) === String(filter._id))
    if (project) Object.assign(project, update.$set || {})
    return { modifiedCount: project ? 1 : 0 }
  },
} } }

const source = fs.readFileSync("lib/ops-cron.ts", "utf8")
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
function localRequire(id) {
  if (id === "@/lib/db") return { getDb: async () => db }
  if (id === "@/lib/telegram-bot") return {
    getTelegramBotToken: async () => "test",
    sendTelegramText: async () => true,
    sendTelegramMessage: async (_token, chatId, text, options) => { messages.push({ chatId: String(chatId), text, options }); return messages.length },
  }
  if (id === "@/lib/team-timezone") return { TEAM_TIME_ZONE: "America/New_York", formatTeamDateTime: () => "Aug 24, 2:00 PM ET", nextRecurringDueAt: () => null }
  if (id === "@/lib/chat-subscriptions") return { getSubscribedChats: async () => [] }
  if (id === "@/lib/launch-calendar") return { LAUNCH_TIME_ZONE: "America/New_York", formatLaunchDaySchedule: async () => "schedule", getLaunchesForDay: async () => [], launchDateKey: () => "2026-08-24" }
  if (id === "@/lib/revenue-service") return { ensureDailyTradingFeeExpectations: async () => ({}), valuePendingRevenueReceipts: async () => ({}) }
  if (id === "@/lib/project-lifecycle") return {
    projectLaunchAt: (project) => project.launchAt ? new Date(project.launchAt) : null,
    projectActivationReadiness: (project) => project.referrerStatus === "pending"
      ? ({ ready: false, missing: ["referrer decision"], chain: "solana", quoteToken: "SOL" })
      : ({ ready: true, missing: [], chain: "solana", quoteToken: "SOL" }),
    activateScheduledProject: async ({ projectId }) => {
      const project = projects.find((row) => String(row._id) === String(projectId))
      if (!project) return { ok: false, error: "Project not found" }
      project.status = "active"
      project.nextActivationPromptAt = null
      resumedActivations += 1
      return { ok: true, project }
    },
  }
  throw new Error(`Unexpected import: ${id}`)
}
vm.runInNewContext(`(function (exports, require, module, process) { ${output}\n})(module.exports, require, module, process)`, { module, require: localRequire, process, Intl, Date })

await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T18:00:00.000Z"))
assert.equal(messages.length, 1)
assert.match(messages[0].text, /KOLcoin/)
const buttons = messages[0].options.replyMarkup.inline_keyboard.flat().map((button) => button.callback_data)
assert.deepEqual(JSON.parse(JSON.stringify(buttons)), [
  "lifecycle:ontime:kolcoin:1",
  "lifecycle:now:kolcoin:1",
  "lifecycle:delay:kolcoin:1",
  "lifecycle:cancel:kolcoin:1",
])

await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T18:10:00.000Z"))
assert.equal(messages.length, 1)
await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T18:16:00.000Z"))
await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T19:02:00.000Z"))
assert.equal(messages.length, 3)
assert.equal(projects[0].activationOverdue, true)
await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T22:00:00.000Z"))
assert.equal(messages.length, 3)

projects.push({ _id: "pending-ready", name: "Pending ready", status: "scheduled", launchAt: "2026-08-24T18:00:00.000Z", launchTimeZone: "America/New_York", launchChatId: "-1001", scheduleVersion: 1, activationPromptCount: 1, referrerStatus: "none", pendingActivationIntent: "scheduled", pendingActivationRequestedByTelegramId: 101 })
await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T22:01:00.000Z"))
assert.equal(messages.length, 3)
assert.equal(projects.find((project) => project._id === "pending-ready").status, "active")
assert.equal(resumedActivations, 1)

projects.push({ _id: "needs-setup", name: "Needs setup", status: "scheduled", launchAt: "2026-08-25T19:30:00.000Z", launchTimeZone: "America/New_York", launchChatId: "-1001", scheduleVersion: 1, activationPromptCount: 0, referrerStatus: "pending" })
await module.exports.processUpcomingLaunchReadiness("test", new Date("2026-08-24T20:00:00.000Z"))
assert.equal(messages.length, 4)
assert.match(messages.at(-1).text, /referrer decision/)
assert.equal(messages.at(-1).options.replyMarkup.inline_keyboard[0][0].callback_data, "lifecycle:refnone:needs-setup:1")

console.log("PASS: pre-launch readiness and launch-time confirmation prompts target Launch Chat, repeat twice, and stop in overdue state.")
