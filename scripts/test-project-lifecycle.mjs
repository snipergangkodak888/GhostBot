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
  if (id === "@/lib/launch-math") return { LAUNCH_PADS: [
    { id: "pumpfun", name: "Pump.fun", chainId: "sol", symbol: "SOL" },
    { id: "aero", name: "Aerodrome", chainId: "base", symbol: "ETH" },
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
assert.equal(lifecycle.cleanLaunchProjectName("add KOLCOIN"), "KOLCOIN")
assert.equal(lifecycle.cleanLaunchProjectName("please schedule the project alpha coin"), "Alpha Coin")

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

const previewInput = [{ _id: "future", name: "Future legacy", status: "active", launchDate: "2026-09-01T18:00:00.000Z" }]
const preview = lifecycle.launchLifecycleMigrationPreview(previewInput, new Date("2026-08-24T18:00:00.000Z"))
assert.equal(preview[0].proposedStatus, "scheduled")
assert.equal(previewInput[0].status, "active")

console.log("PASS: lifecycle readiness, KOLcoin on-time activation, next-day fees, delay versioning, cancellation, and migration preview.")
