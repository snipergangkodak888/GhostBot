#!/usr/bin/env node

import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const nodeRequire = createRequire(import.meta.url)

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function evaluate(source, localRequire) {
  const module = { exports: {} }
  vm.runInNewContext(`(function (exports, require, module) { ${source}\n})(module.exports, require, module)`, {
    module,
    require: localRequire,
    Intl,
    Date,
  })
  return module.exports
}

const timeZoneModule = evaluate(
  transpile("lib/team-timezone.ts"),
  (id) => id === "chrono-node" ? nodeRequire("chrono-node") : nodeRequire(id),
)
const reminderModule = evaluate(
  transpile("lib/reminder-parser.ts"),
  (id) => id === "@/lib/team-timezone"
    ? timeZoneModule
    : id === "chrono-node"
      ? nodeRequire("chrono-node")
      : nodeRequire(id),
)

const { isReminderRequest, parseReminderRequest } = reminderModule
const now = new Date("2026-08-27T16:55:00.000Z") // Thursday, 12:55 PM ET
const parse = (text, options = {}) => parseReminderRequest(text, { timeZone: "America/New_York", now, ...options })

const compact = parse("WWR injection 8pm ET today")
assert.equal(compact.ok, true)
assert.equal(compact.title, "WWR injection")
assert.equal(compact.dueAt, "2026-08-28T00:00:00.000Z")
assert.equal(compact.timeZone, "America/New_York")
assert.equal(compact.recurrence, "none")

const teamRequest = parse("remind us at 8pm ET today for WWR injection")
assert.equal(teamRequest.ok, true)
assert.equal(teamRequest.title, "WWR injection")
assert.equal(teamRequest.dueAt, "2026-08-28T00:00:00.000Z")
assert.equal(teamRequest.targetMode, "everyone")

const personalRequest = parse("remind me today at 8pm ET about WWR injection")
assert.equal(personalRequest.ok, true)
assert.equal(personalRequest.title, "WWR injection")
assert.equal(personalRequest.dueAt, "2026-08-28T00:00:00.000Z")
assert.equal(personalRequest.targetMode, "creator")

const targetedRequest = parse("remind @alex and @sam at 8pm ET today about WWR injection")
assert.equal(targetedRequest.ok, true)
assert.equal(targetedRequest.title, "WWR injection")
assert.equal(targetedRequest.targetMode, "specific")
assert.deepEqual(Array.from(targetedRequest.targetUsernames), ["alex", "sam"])

const actionRequest = parse("remind us to do WWR injection at 8pm ET today")
assert.equal(actionRequest.ok, true)
assert.equal(actionRequest.title, "WWR injection")

const recurring = parse("remind us every day at 2pm PT to post the risk check")
assert.equal(recurring.ok, true)
assert.equal(recurring.title, "post the risk check")
assert.equal(recurring.dueAt, "2026-08-27T21:00:00.000Z")
assert.equal(recurring.timeZone, "America/Los_Angeles")
assert.equal(recurring.recurrence, "daily")

const recurringAfterTodaysTime = parse("remind us every day at 9am ET to post the morning risk check")
assert.equal(recurringAfterTodaysTime.ok, true)
assert.equal(recurringAfterTodaysTime.title, "post the morning risk check")
assert.equal(recurringAfterTodaysTime.dueAt, "2026-08-28T13:00:00.000Z")
assert.equal(recurringAfterTodaysTime.recurrence, "daily")

const relative = parse("remind me in 20 minutes to check WWR")
assert.equal(relative.ok, true)
assert.equal(relative.title, "check WWR")
assert.equal(relative.dueAt, "2026-08-27T17:15:00.000Z")

const conversationalRelative = parse("remind me in half an hour to check WWR")
assert.equal(conversationalRelative.ok, true)
assert.equal(conversationalRelative.title, "check WWR")
assert.equal(conversationalRelative.dueAt, "2026-08-27T17:25:00.000Z")

const contextualClock = parse("remind us tomorrow morning at 9 to post the update")
assert.equal(contextualClock.ok, true)
assert.equal(contextualClock.title, "post the update")
assert.equal(contextualClock.dueAt, "2026-08-28T13:00:00.000Z")

const legacy = parse("WWR injection | 2026-08-28 20:00 | Open WWR injection | daily")
assert.equal(legacy.ok, true)
assert.equal(legacy.title, "WWR injection")
assert.equal(legacy.message, "Open WWR injection")
assert.equal(legacy.dueAt, "2026-08-29T00:00:00.000Z")
assert.equal(legacy.recurrence, "daily")

const missingTime = parse("WWR injection")
assert.equal(missingTime.ok, false)
assert.equal(missingTime.issue, "missing_time")

const pastTime = parse("WWR injection today at 9am ET")
assert.equal(pastTime.ok, false)
assert.equal(pastTime.issue, "past_time")

assert.equal(isReminderRequest("remind us at 8pm ET today for WWR injection"), true)
assert.equal(isReminderRequest("set a reminder for tomorrow at noon"), true)
assert.equal(isReminderRequest("remind @alex tomorrow at noon about WWR"), true)
assert.equal(isReminderRequest("delete the WWR reminder"), false)

console.log("PASS: reminder input parses natural me/us phrasing, compact title-first phrasing, timezones, relative times, recurrence, and legacy pipe input without inventing a fallback time.")
