#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

function load(code, requireFn) {
  const module = { exports: {} }
  vm.runInNewContext(`(function (exports, require, module) { ${code}\n})(module.exports, require, module)`, {
    module,
    require: requireFn,
    BigInt,
  })
  return module.exports
}

const setup = load(compile("lib/organic-channel-setup.ts"), () => {
  throw new Error("Unexpected helper dependency")
})
const automation = load(compile("lib/organic-channel-automation.ts"), (name) => {
  if (name === "./organic-channel-setup") return setup
  throw new Error(`Unexpected automation dependency: ${name}`)
})

const profileId = "67f9d846-8d06-47ed-b6e0-63380ed7d1d3"

function baseJob(overrides = {}) {
  return {
    _id: "job-123",
    ticker: "SUMO",
    profileId,
    sourceChatId: "10",
    requestedByTelegramId: 10,
    stage: "queued",
    status: "queued",
    ...overrides,
  }
}

function mocks(options = {}) {
  const events = []
  const checkpoints = []
  const channel = options.existingChannel || { id: "4496689738", accessHash: "987654321" }
  const gateway = {
    async preflight() { events.push("preflight"); if (options.preflightError) throw new Error(options.preflightError) },
    async findChannelByMarker(marker) { events.push(`find:${marker}`); return options.existingChannel || null },
    async createBroadcastChannel(title, about) { events.push(`create:${title}:${about}`); return channel },
    async setChannelPhoto() { events.push("photo") },
    async addSumoBotAsAdmin() { events.push("admin") },
    async createInviteLink() { events.push("invite"); return "https://t.me/+organic-test" },
  }
  return {
    events,
    checkpoints,
    gateway,
    checkpoint: async (changes) => checkpoints.push({ ...changes }),
  }
}

{
  const test = mocks()
  const result = await automation.processOrganicChannelJob(baseJob(), test)
  assert.equal(result.status, "complete")
  assert.equal(result.channelBotApiId, "-1004496689738")
  assert.equal(result.subscribeCommand, `/subscribe_channel -1004496689738 ${profileId}`)
  assert.deepEqual(test.events, [
    "preflight",
    "find:ghostbot-organic:job-123",
    "create:$SUMO - Organic Trade Notifications:GhostBot organic notifications · ghostbot-organic:job-123",
    "photo",
    "admin",
    "invite",
  ])
  assert.equal(test.events.some((event) => event.startsWith("subscribe:")), false, "the command must only be returned")
}

{
  const existing = { id: "4496689738", accessHash: "987654321" }
  const test = mocks({ existingChannel: existing })
  await automation.processOrganicChannelJob(baseJob(), test)
  assert.equal(test.events.some((event) => event.startsWith("create:")), false, "recovery must reuse the marker channel")
}

{
  const test = mocks()
  await automation.processOrganicChannelJob(baseJob({
    stage: "command_ready",
    channel: { id: "4496689738", accessHash: "987654321" },
    channelBotApiId: "-1004496689738",
    subscribeCommand: `/subscribe_channel -1004496689738 ${profileId}`,
  }), test)
  assert.deepEqual(test.events, ["preflight", "invite"])
}

{
  const test = mocks({ preflightError: "missing logo" })
  await assert.rejects(() => automation.processOrganicChannelJob(baseJob(), test), /missing logo/)
  assert.deepEqual(test.events, ["preflight"], "preflight failure must happen before Telegram side effects")
  assert.equal(test.checkpoints.length, 0)
}

assert.equal(automation.telegramChannelBotApiId("4496689738"), "-1004496689738")
assert.equal(automation.telegramChannelBotApiId("-4496689738"), "-1004496689738")

console.log("Organic channel automation passed: creation, recovery, resume, command-only output, invite generation, and preflight safety")
