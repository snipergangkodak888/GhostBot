#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const source = fs.readFileSync("lib/organic-channel-policy.ts", "utf8")
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(`(function (exports, require, module, process) { ${output}\n})(module.exports, require, module, process)`, {
  module,
  require: () => { throw new Error("The organic policy helper must not import runtime dependencies") },
  process,
  Date,
})
const policy = module.exports

const limits = policy.organicChannelRatePolicy({
  ORGANIC_CHANNEL_AUTOMATION_ENABLED: "true",
  ORGANIC_CHANNEL_MIN_INTERVAL_MINUTES: "30",
  ORGANIC_CHANNEL_MAX_PER_2_HOURS: "2",
  ORGANIC_CHANNEL_MAX_PER_8_HOURS: "4",
  ORGANIC_CHANNEL_MAX_PER_24_HOURS: "10",
})
const now = new Date("2026-08-24T12:00:00.000Z")

assert.equal(policy.organicChannelRatePolicy({}).enabled, false)
assert.equal(policy.nextOrganicChannelEligibleAt([], now, limits).toISOString(), now.toISOString())
assert.equal(
  policy.nextOrganicChannelEligibleAt(["2026-08-24T11:45:00.000Z"], now, limits).toISOString(),
  "2026-08-24T12:15:00.000Z",
)
assert.equal(
  policy.nextOrganicChannelEligibleAt(["2026-08-24T10:30:00.000Z", "2026-08-24T11:30:00.000Z"], now, limits).toISOString(),
  "2026-08-24T12:30:00.000Z",
)
assert.equal(
  policy.nextOrganicChannelEligibleAt([
    "2026-08-24T04:30:00.000Z",
    "2026-08-24T06:30:00.000Z",
    "2026-08-24T08:30:00.000Z",
    "2026-08-24T10:30:00.000Z",
  ], now, limits).toISOString(),
  "2026-08-24T12:30:00.000Z",
)
assert.equal(
  policy.nextOrganicChannelEligibleAt(Array.from({ length: 10 }, (_, index) => (
    new Date(Date.parse("2026-08-23T13:00:00.000Z") + index * 2 * 60 * 60_000).toISOString()
  )), now, limits).toISOString(),
  "2026-08-24T13:00:00.000Z",
)

assert.equal(
  JSON.stringify(policy.classifyOrganicTelegramError({ message: "FLOOD_WAIT_120", seconds: 120, operation: "create_channel" })),
  JSON.stringify({
    kind: "flood_wait",
    message: "FLOOD_WAIT_120",
    operation: "create_channel",
    retryAfterSeconds: 120,
    openCircuit: false,
  }),
)
assert.equal(policy.classifyOrganicTelegramError({ message: "The current account is spamreported", operation: "add_sumo_admin" }).kind, "restriction")
assert.equal(policy.classifyOrganicTelegramError({ message: "Could not add participants", operation: "add_sumo_admin" }).openCircuit, true)
assert.equal(policy.classifyOrganicTelegramError({ message: "ETIMEDOUT", operation: "preflight" }).kind, "transient_read")
assert.equal(policy.classifyOrganicTelegramError({ message: "ETIMEDOUT", operation: "create_invite" }).kind, "ambiguous_write")

console.log("Organic channel policy passed: rolling limits, FLOOD_WAIT scheduling, safe read retries, and write circuit breaking")
