#!/usr/bin/env node

import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const nodeRequire = createRequire(import.meta.url)
const source = fs.readFileSync("lib/team-timezone.ts", "utf8")
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const module = { exports: {} }
const localRequire = (id) => id === "chrono-node" ? nodeRequire("chrono-node") : nodeRequire(id)
vm.runInNewContext(`(function (exports, require, module) { ${output}\n})(module.exports, require, module)`, { module, require: localRequire, Intl, Date })

const { parseContextualTeamDateTime } = module.exports
const now = new Date("2026-08-25T17:15:00.000Z") // Tuesday, 1:15 PM ET
const defaults = {
  timeZone: "America/New_York",
  now,
  defaultDate: "2026-08-25",
  defaultTime: "2026-08-25T19:30:00.000Z", // 3:30 PM ET
}

const parsedIso = (text, options = defaults) => parseContextualTeamDateTime(text, options).date?.toISOString()

assert.equal(parsedIso("12:30 PM ET"), "2026-08-25T16:30:00.000Z", "time-only input should retain the launch day")
assert.equal(parsedIso("tomorrow at 2 PM"), "2026-08-26T18:00:00.000Z")
assert.equal(parsedIso("Thursday at noon"), "2026-08-27T16:00:00.000Z")
assert.equal(parsedIso("Thursday this time"), "2026-08-27T19:30:00.000Z", "this time should retain the current launch clock")
assert.equal(parsedIso("same time tomorrow"), "2026-08-26T19:30:00.000Z")
assert.equal(parsedIso("tomorrow at this time"), "2026-08-26T19:30:00.000Z")
assert.equal(parsedIso("next Thursday at noon"), "2026-09-03T16:00:00.000Z")
assert.equal(parsedIso("Thursday"), "2026-08-27T19:30:00.000Z", "day-only input should retain an existing launch time")
assert.equal(parsedIso("15:30"), "2026-08-25T19:30:00.000Z", "24-hour time should be accepted")
assert.equal(parsedIso("12:30 PM PT"), "2026-08-25T19:30:00.000Z", "an explicit timezone should override the launch timezone")

const ambiguous = parseContextualTeamDateTime("3:30", defaults)
assert.equal(ambiguous.date, null)
assert.equal(ambiguous.issue, "ambiguous_meridiem")

const dayOnlyTbd = parseContextualTeamDateTime("Thursday", { ...defaults, defaultTime: null })
assert.equal(dayOnlyTbd.date, null)
assert.equal(dayOnlyTbd.issue, "missing_time")
assert.equal(dayOnlyTbd.resolvedDateKey, "2026-08-27")
assert.equal(parsedIso("2 PM", { ...defaults, defaultDate: dayOnlyTbd.resolvedDateKey, defaultTime: null }), "2026-08-27T18:00:00.000Z", "a follow-up time should use the previously resolved day")

console.log("PASS: contextual launch timing understands time-only, relative days, weekdays, same-time phrases, explicit zones, slot filling, and ambiguity safeguards.")
