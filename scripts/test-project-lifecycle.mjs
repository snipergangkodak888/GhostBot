#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const rows = {
  opsProjects: [],
  opsProjectLifecycleEvents: [],
}

function matches(row, filter) {
  return Object.entries(filter || {}).every(([key, value]) => String(row[key]) === String(value))
}

const db = {
  collection(name) {
    return {
      findOne: async (filter) => rows[name]?.find((row) => matches(row, filter)) || null,
      updateOne: async (filter, update) => {
        const row = rows[name]?.find((item) => matches(item, filter))
        if (!row) return { modifiedCount: 0 }
        Object.assign(row, update.$set || update)
        return { modifiedCount: 1 }
      },
      insertOne: async (row) => {
        rows[name] ||= []
        rows[name].push(row)
        return { insertedId: row._id || String(rows[name].length) }
      },
    }
  },
}

const source = fs.readFileSync("lib/project-lifecycle.ts", "utf8")
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }

function localRequire(id) {
  if (id === "@/lib/db") return { getDb: async () => db }
  if (id === "@/lib/launch-venues") return { OPERATIONAL_LAUNCH_VENUES: [
    { id: "pumpfun", name: "Pump.fun", chainId: "sol", symbol: "SOL" },
    { id: "aero", name: "Aerodrome", chainId: "base", symbol: "ETH" },
    { id: "uni-rh-v4", name: "Uniswap V4", chainId: "rh", symbol: "ETH" },
    { id: "pons", name: "Pons V2", chainId: "rh", symbol: "ETH" },
  ] }
  if (id === "@/lib/revenue-projects") return { cleanRevenueChain: (value) => ["solana", "base", "ethereum", "bnb", "robinhood"].includes(String(value)) ? String(value) : "" }
  if (id === "@/lib/team-timezone") return {
    TEAM_TIME_ZONE: "America/New_York",
    dateKeyInTimeZone: (date, timeZone) => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(date))
      const part = (type) => parts.find((item) => item.type === type)?.value || ""
      return `${part("year")}-${part("month")}-${part("day")}`
    },
  }
  throw new Error(`Unexpected import: ${id}`)
}

vm.runInNewContext(`(function (exports, require, module) { ${output}\n})(module.exports, require, module)`, { module, require: localRequire, Intl, Date })
const lifecycle = module.exports

const inferred = lifecycle.inferLaunchConfiguration("Schedule KOLcoin on Pump.fun / Solana with SOL quote token")
assert.deepEqual(JSON.parse(JSON.stringify(inferred)), { launchVenue: "pumpfun", launchVenueLabel: "Pump.fun", launchFundingAsset: "SOL", chain: "solana", quoteToken: "SOL" })
const exactRequestConfig = lifecycle.inferLaunchConfiguration("add KOLCOIN launch today at 2pm et to the calendar, its solana/pumpfun")
assert.deepEqual(JSON.parse(JSON.stringify(exactRequestConfig)), { launchVenue: "pumpfun", launchVenueLabel: "Pump.fun", launchFundingAsset: "SOL", chain: "solana", quoteToken: "SOL" })
assert.deepEqual(JSON.parse(JSON.stringify(lifecycle.inferLaunchConfiguration("Weave on Robinhood Uniswap V4 with ETH quote"))), { launchVenue: "uni-rh-v4", launchVenueLabel: "Uniswap V4", launchFundingAsset: "ETH", chain: "robinhood", quoteToken: "ETH" })
assert.deepEqual(JSON.parse(JSON.stringify(lifecycle.inferLaunchConfiguration("Test launch on Pons V2 Robinhood with custom quote token AAPL, CA 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"))), { launchVenue: "pons", launchVenueLabel: "Pons V2", launchFundingAsset: "ETH", chain: "robinhood", quoteToken: "AAPL", quoteTokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" })
assert.equal(lifecycle.cleanLaunchProjectName("add KOLCOIN"), "KOLCOIN")
assert.equal(lifecycle.cleanLaunchProjectName("please schedule the project alpha coin"), "Alpha Coin")
assert.equal(lifecycle.cleanLaunchProjectNameFromRequest("SnapGame pumpfun sol", "SnapGame pumpfun sol launch at 5:10 pm ET today"), "SnapGame")

const launchAt = "2026-08-24T18:00:00.000Z" // 2 PM ET
const kolcoin = {
  _id: "kolcoin",
  name: "KOLcoin",
  ...lifecycle.scheduledLifecycleFields({ launchAt, launchTimeZone: "America/New_York", launchChatId: "-1001", telegramId: 101 }),
  launchVenue: "pumpfun",
  launchFundingAsset: "SOL",
  chain: "solana",
  quoteToken: "SOL",
  quoteAssets: ["SOL"],
  dailyTradingFeeEnabled: true,
  dailyTradingFeeUsd: 500,
  launchFeeUsd: 1000,
  feeConfigurationConfirmed: true,
  referrerStatus: "pending",
}
rows.opsProjects.push(kolcoin)

assert.deepEqual(JSON.parse(JSON.stringify(lifecycle.projectActivationReadiness(kolcoin).missing)), ["referrer decision"])
assert.equal((await lifecycle.confirmNoProjectReferrer("kolcoin", 202)).ok, true)
assert.equal(lifecycle.projectActivationReadiness(kolcoin).ready, true)

const activated = await lifecycle.activateScheduledProject({ projectId: "kolcoin", telegramId: 303, actual: "scheduled", now: new Date("2026-08-24T18:05:00.000Z"), expectedScheduleVersion: 1 })
assert.equal(activated.ok, true)
assert.equal(activated.project.status, "active")
assert.equal(activated.project.actualLaunchAt, launchAt)
assert.equal(activated.dailyFeeStartDate, "2026-08-25")
assert.equal((await lifecycle.activateScheduledProject({ projectId: "kolcoin", telegramId: 404, actual: "now" })).alreadyActive, true)

const gated = {
  _id: "gated",
  name: "Gated launch",
  ...lifecycle.scheduledLifecycleFields({ launchAt, launchTimeZone: "America/New_York", launchChatId: "-1001", telegramId: 101 }),
  launchVenue: "pumpfun",
  chain: "solana",
  quoteToken: "SOL",
  quoteAssets: ["SOL"],
  dailyTradingFeeEnabled: true,
  dailyTradingFeeUsd: 500,
  feeConfigurationConfirmed: false,
  referrerStatus: "pending",
}
rows.opsProjects.push(gated)
const blockedActivation = await lifecycle.activateScheduledProject({ projectId: "gated", telegramId: 505, actual: "scheduled", now: new Date("2026-08-24T18:01:00.000Z"), expectedScheduleVersion: 1 })
assert.equal(blockedActivation.ok, false)
assert.equal(gated.pendingActivationIntent, "scheduled")
assert.deepEqual(JSON.parse(JSON.stringify(blockedActivation.readiness.missing)), ["fee configuration", "referrer decision"])
const feesCompleted = await lifecycle.confirmStandardProjectFees("gated", 505, 1)
assert.equal(feesCompleted.ok, true)
assert.equal(feesCompleted.activated, false)
assert.equal(gated.status, "scheduled")
assert.deepEqual(JSON.parse(JSON.stringify(feesCompleted.readiness.missing)), ["referrer decision"])
const readinessCompleted = await lifecycle.confirmNoProjectReferrer("gated", 505, 1)
assert.equal(readinessCompleted.ok, true)
assert.equal(readinessCompleted.activated, true)
assert.equal(gated.status, "active")
assert.equal(gated.actualLaunchAt, launchAt)
assert.equal(gated.pendingActivationIntent, null)
assert.equal(readinessCompleted.dailyFeeStartDate, "2026-08-25")
const gatedActivationEvents = rows.opsProjectLifecycleEvents.filter((event) => event.projectId === "gated" && event.action === "activated")
assert.equal(gatedActivationEvents.length, 1)
const repeatedReadinessClick = await lifecycle.confirmNoProjectReferrer("gated", 505, 1)
assert.equal(repeatedReadinessClick.alreadyActive, true)
assert.equal(rows.opsProjectLifecycleEvents.filter((event) => event.projectId === "gated" && event.action === "activated").length, 1)

const concurrent = {
  _id: "concurrent",
  name: "Concurrent launch",
  ...lifecycle.scheduledLifecycleFields({ launchAt, launchTimeZone: "America/New_York", launchChatId: "-1001", telegramId: 101 }),
  chain: "solana",
  quoteToken: "SOL",
  quoteAssets: ["SOL"],
  dailyTradingFeeEnabled: true,
  dailyTradingFeeUsd: 500,
  feeConfigurationConfirmed: true,
  referrerStatus: "pending",
}
rows.opsProjects.push(concurrent)
assert.equal((await lifecycle.activateScheduledProject({ projectId: "concurrent", telegramId: 606, actual: "now", expectedScheduleVersion: 1 })).ok, false)
const concurrentConfirmations = await Promise.all([
  lifecycle.confirmNoProjectReferrer("concurrent", 606, 1),
  lifecycle.confirmNoProjectReferrer("concurrent", 606, 1),
])
assert.equal(concurrent.status, "active")
assert.equal(concurrentConfirmations.filter((result) => result.activated).length, 2)
assert.equal(concurrentConfirmations.filter((result) => result.alreadyActive).length, 1)
assert.equal(rows.opsProjectLifecycleEvents.filter((event) => event.projectId === "concurrent" && event.action === "activated").length, 1)

const delayed = {
  _id: "delayed",
  name: "Delayed launch",
  ...lifecycle.scheduledLifecycleFields({ launchAt, launchTimeZone: "America/New_York", telegramId: 101 }),
  chain: "solana", quoteToken: "SOL", quoteAssets: ["SOL"], dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500,
  feeConfigurationConfirmed: true, referrerStatus: "none",
}
rows.opsProjects.push(delayed)
const moved = await lifecycle.rescheduleProject({ projectId: "delayed", launchAt: "2026-08-25T19:00:00.000Z", telegramId: 202, expectedScheduleVersion: 1 })
assert.equal(moved.ok, true)
assert.equal(moved.project.scheduleVersion, 2)
assert.equal(moved.project.launchScheduleHistory.length, 1)
const stale = await lifecycle.activateScheduledProject({ projectId: "delayed", telegramId: 303, actual: "now", expectedScheduleVersion: 1 })
assert.equal(stale.ok, false)
assert.match(stale.error, /updated|newest/i)

const cancelled = { _id: "cancelled", name: "Cancelled", ...lifecycle.scheduledLifecycleFields({ launchAt, telegramId: 101 }) }
rows.opsProjects.push(cancelled)
assert.equal((await lifecycle.cancelScheduledProject("cancelled", 202, new Date("2026-08-24T18:10:00.000Z"), 1)).project.status, "inactive")

const tentative = {
  _id: "tentative",
  name: "Tentative launch",
  ...lifecycle.tentativeLifecycleFields({ tentativeLaunchDate: "2026-08-24", launchTimeZone: "America/New_York", launchChatId: "-1001", telegramId: 101 }),
  chain: "solana", quoteToken: "SOL", quoteAssets: ["SOL"], dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500,
  feeConfigurationConfirmed: true, referrerStatus: "none",
}
rows.opsProjects.push(tentative)
assert.equal(lifecycle.projectLaunchTimingStatus(tentative), "tentative")
assert.equal(lifecycle.projectLaunchAt(tentative), null)
assert.equal(lifecycle.projectLaunchDateKey(tentative, "America/New_York"), "2026-08-24")
const movedTentative = await lifecycle.setTentativeProjectLaunchDate({ projectId: "tentative", tentativeLaunchDate: "2026-08-25", telegramId: 202, expectedScheduleVersion: 1 })
assert.equal(movedTentative.ok, true)
assert.equal(movedTentative.project.scheduleVersion, 2)
assert.equal(movedTentative.project.launchAt, null)
assert.equal(movedTentative.project.tentativeLaunchDate, "2026-08-25")
const confirmedTentative = await lifecycle.rescheduleProject({ projectId: "tentative", launchAt: "2026-08-25T21:10:00.000Z", telegramId: 202, expectedScheduleVersion: 2, timeZone: "America/New_York" })
assert.equal(confirmedTentative.ok, true)
assert.equal(confirmedTentative.project.scheduleVersion, 3)
assert.equal(confirmedTentative.project.launchTimingStatus, "confirmed")
assert.equal(confirmedTentative.project.tentativeLaunchDate, null)
assert.equal(confirmedTentative.project.launchAt, "2026-08-25T21:10:00.000Z")

const previewInput = [{ _id: "future", name: "Future legacy", status: "active", launchDate: "2026-09-01T18:00:00.000Z" }]
const preview = lifecycle.launchLifecycleMigrationPreview(previewInput, new Date("2026-08-24T18:00:00.000Z"))
assert.equal(preview[0].proposedStatus, "scheduled")
assert.equal(previewInput[0].status, "active")

console.log("PASS: lifecycle handles activation, next-day fees, delays, cancellation, and tentative-to-confirmed launch timing without fake timestamps.")
