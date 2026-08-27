#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const deliveries = new Map()
const messages = []
const reminderTexts = []
let resumedActivations = 0
let telegramTextSucceeds = true
const reminders = []
const dailyProjectReviews = []
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
  find: (filter = {}) => {
    const items = name === "opsProjects" ? projects : name === "opsReminders" ? reminders : name === "opsDailyProjectReviews" ? dailyProjectReviews : []
    return cursor(filter.status === "active" ? items.filter((row) => row.status === "active") : items)
  },
  findOne: async (filter) => name === "opsProjects"
    ? projects.find((row) => Object.entries(filter || {}).every(([key, value]) => String(row[key]) === String(value))) || null
    : name === "opsDailyProjectReviews"
      ? dailyProjectReviews.find((row) => Object.entries(filter || {}).every(([key, value]) => String(row[key]) === String(value))) || null
    : deliveries.get(filter?.key) || null,
  insertOne: async (row) => {
    if (name === "opsCronDeliveries") deliveries.set(row.key, row)
    if (name === "opsDailyProjectReviews") dailyProjectReviews.push(row)
    return { insertedId: row.key || row._id || "1" }
  },
  deleteOne: async ({ key }) => { const deleted = deliveries.delete(key); return { deletedCount: deleted ? 1 : 0 } },
  updateOne: async (filter, update) => {
    const project = projects.find((row) => String(row._id) === String(filter._id))
    const reminder = reminders.find((row) => String(row._id) === String(filter._id))
    const dailyProjectReview = dailyProjectReviews.find((row) => String(row._id) === String(filter._id))
    if (project) Object.assign(project, update.$set || {})
    if (reminder) Object.assign(reminder, update.$set || {})
    if (dailyProjectReview) Object.assign(dailyProjectReview, update.$set || {})
    return { modifiedCount: project || reminder || dailyProjectReview ? 1 : 0 }
  },
} } }

const source = fs.readFileSync("lib/ops-cron.ts", "utf8")
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
function localRequire(id) {
  if (id === "@/lib/db") return { getDb: async () => db }
  if (id === "@/lib/telegram-bot") return {
    getTelegramBotToken: async () => "test",
    sendTelegramText: async (_token, _chatId, text) => { if (telegramTextSucceeds) reminderTexts.push(text); return telegramTextSucceeds },
    sendTelegramMessage: async (_token, chatId, text, options) => { messages.push({ chatId: String(chatId), text, options }); return messages.length },
  }
  if (id === "@/lib/team-timezone") return { TEAM_TIME_ZONE: "America/New_York", formatTeamDateTime: () => "Aug 24, 2:00 PM ET", nextRecurringDueAt: () => null }
  if (id === "@/lib/chat-subscriptions") return {
    getSubscribedChats: async () => [],
    getProfileChats: async (profile) => profile === "trade" ? [{ chatId: "-1002", kind: "group", label: "Trade Floor" }] : [],
  }
  if (id === "@/lib/launch-calendar") return { LAUNCH_TIME_ZONE: "America/New_York", formatLaunchDaySchedule: async () => "schedule", getLaunchesForDay: async () => [], launchDateKey: () => "2026-08-24" }
  if (id === "@/lib/revenue-service") return { ensureDailyTradingFeeExpectations: async () => ({}), valuePendingRevenueReceipts: async () => ({}) }
  if (id === "@/lib/launch-method") return {
    normalizeLaunchMethod: (value) => ["sumo", "senzu_plugin", "other_mm_plugin"].includes(String(value)) ? String(value) : "",
    launchMethodLabel: (value) => value === "sumo" ? "Sumo" : value === "senzu_plugin" ? "Senzu plugin" : value === "other_mm_plugin" ? "Other MM plugin" : "Not selected",
  }
  if (id === "@/lib/launch-venues") return {
    operationalLaunchVenue: (id) => id === "pumpfun" ? { name: "Pump.fun" } : id === "uni-rh-v2" ? { name: "Uniswap V2" } : null,
  }
  if (id === "@/lib/daily-project-review") return {
    DAILY_PROJECT_REVIEW_HOUR_ET: 20,
    activeProjectReviewStart: (project) => project.activatedAt || project.actualLaunchAt || project.launchAt || project.createdAt || null,
    dailyProjectReviewDateKey: () => "2026-08-26",
    dailyProjectReviewId: (chatId, dateKey) => `daily-project-review:${chatId}:${dateKey}`,
    dailyProjectReviewText: ({ review }) => `End-of-day project check\n${review.projects.map((project) => project.name).join("\n")}`,
    dailyProjectReviewButtons: (review) => [[{ text: "All still active", callback_data: `eod:keep:${review.dateKey}` }]],
  }
  if (id === "@/lib/project-lifecycle") return {
    projectLaunchAt: (project) => project.launchAt ? new Date(project.launchAt) : null,
    projectLaunchTimingStatus: (project) => project.tentativeLaunchDate && !project.launchAt ? "tentative" : "confirmed",
    projectLaunchDateKey: (project) => project.tentativeLaunchDate || (project.launchAt ? "2026-08-24" : ""),
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

projects.push(
  { _id: "tentative", name: "Tentative today", status: "scheduled", launchAt: null, tentativeLaunchDate: "2026-08-24", launchTimingStatus: "tentative", launchTimeZone: "America/New_York", launchChatId: "-1001", scheduleVersion: 1, launchVenue: "pumpfun", chain: "solana", quoteToken: "SOL", launchMethod: "sumo" },
  { _id: "tentative-two", name: "Second TBD", status: "scheduled", launchAt: null, tentativeLaunchDate: "2026-08-24", launchTimingStatus: "tentative", launchTimeZone: "America/New_York", launchChatId: "-1001", scheduleVersion: 2, launchVenue: "uni-rh-v2", chain: "robinhood", quoteToken: "ETH", launchMethod: "senzu_plugin" },
)
await module.exports.processDueLaunchConfirmations("test", new Date("2026-08-24T21:00:00.000Z"))
assert.equal(messages.length, 4, "tentative launches must not receive launch-time activation prompts")
const followup = await module.exports.processTentativeLaunchTimingFollowups("test", new Date("2026-08-24T16:00:00.000Z"))
assert.equal(followup.due, 2)
assert.equal(messages.length, 5)
assert.match(messages.at(-1).text, /Today’s launches with time TBD/)
assert.match(messages.at(-1).text, /Tentative today · Solana\/Pump.fun · Sumo/)
assert.match(messages.at(-1).text, /Second TBD · Robinhood\/Uni V2 · Senzu plugin/)
assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).options.replyMarkup.inline_keyboard.flat().map((button) => button.callback_data))), [
  "tentative:ack:2026-08-24",
  "calendar:edit:2026-08-24",
])
await module.exports.processTentativeLaunchTimingFollowups("test", new Date("2026-08-24T16:05:00.000Z"))
assert.equal(messages.length, 5, "the same tentative follow-up must only send once")

reminders.push({ _id: "daily-risk", title: "Morning risk check", message: "Post the morning risk check", dueAt: "2026-08-25T13:00:00.000Z", timeZone: "America/New_York", recurrence: "daily", deliveryScope: "chat", telegramChatId: "-1002", targetChatTitle: "Trade Floor", targetMode: "specific", targetMembers: [{ telegramId: 101, username: "alex", displayName: "Alex" }, { telegramId: 102, username: "", displayName: "Sam Trader" }], status: "scheduled" })
telegramTextSucceeds = false
const failedReminderRun = await module.exports.processDueReminders("test", new Date("2026-08-25T13:00:00.000Z"))
assert.equal(failedReminderRun.failed, 1)
assert.equal(reminders[0].status, "scheduled", "a failed Telegram delivery must remain scheduled for retry")
assert.equal(deliveries.has("reminder:daily-risk:2026-08-25T13:00:00.000Z"), false, "a failed delivery claim must be released")

telegramTextSucceeds = true
const successfulReminderRun = await module.exports.processDueReminders("test", new Date("2026-08-25T13:01:00.000Z"))
assert.equal(successfulReminderRun.sent, 1)
assert.equal(reminders[0].status, "done", "the mock recurrence helper returns no next occurrence after a successful delivery")
assert.match(reminderTexts.at(-1), /@alex/)
assert.match(reminderTexts.at(-1), /tg:\/\/user\?id=102/)

projects.push(
  { _id: "active-one", name: "One-day launch", status: "active", activatedAt: "2026-08-26T17:00:00.000Z" },
  { _id: "active-old", name: "Older launch", status: "active", activatedAt: "2026-08-23T17:00:00.000Z" },
)
const beforeReviewMessages = messages.length
const waitingReview = await module.exports.processDailyActiveProjectReview("test", new Date("2026-08-26T23:55:00.000Z"))
assert.equal(waitingReview.waiting, true, "the Trade Floor review must wait until 8 PM ET")
assert.equal(messages.length, beforeReviewMessages)
const projectReview = await module.exports.processDailyActiveProjectReview("test", new Date("2026-08-27T00:00:00.000Z"))
assert.equal(projectReview.sent, 1)
const expectedActiveProjectIds = projects.filter((project) => project.status === "active").map((project) => project._id).sort()
assert.equal(projectReview.projects, expectedActiveProjectIds.length, "every active project should be reviewed")
assert.equal(messages.at(-1).chatId, "-1002")
assert.match(messages.at(-1).text, /End-of-day project check/)
assert.match(messages.at(-1).text, /One-day launch/)
assert.equal(dailyProjectReviews.length, 1)
assert.deepEqual(dailyProjectReviews[0].projects.map((project) => project.projectId).sort(), expectedActiveProjectIds)
await module.exports.processDailyActiveProjectReview("test", new Date("2026-08-27T00:05:00.000Z"))
assert.equal(messages.length, beforeReviewMessages + 1, "the daily active-project card must only be sent once per Trade Floor")

console.log("PASS: launch prompts target Launch Chat, reminders retry safely, and the 8 PM ET Trade Floor project review sends once with every active project.")
