#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const source = fs.readFileSync("lib/organic-channel-setup.ts", "utf8")
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(`(function (exports, require, module) { ${output}\n})(module.exports, require, module)`, {
  module,
  require: () => { throw new Error("The organic setup helper must not import runtime dependencies") },
})
const setup = module.exports

assert.equal(setup.normalizeOrganicTicker(" $sumo "), "SUMO")
assert.equal(setup.validOrganicTicker("SUMO"), true)
assert.equal(setup.validOrganicTicker("SUMO COIN"), false)
assert.equal(setup.organicChannelTitle("sumo"), "$SUMO - Organic Trade Notifications")
assert.equal(setup.validSumoProfileId("67f9d846-8d06-47ed-b6e0-63380ed7d1d3"), true)
assert.equal(setup.validSumoProfileId("not-a-profile"), false)
assert.equal(
  setup.sumoSubscribeCommand("-1004496689738", "67f9d846-8d06-47ed-b6e0-63380ed7d1d3"),
  "/subscribe_channel -1004496689738 67f9d846-8d06-47ed-b6e0-63380ed7d1d3",
)
assert.equal(
  setup.sumoBotChannelUrl(),
  "https://t.me/sumo_trade_bot?startchannel&admin=post_messages",
)

console.log("Organic channel setup helpers passed")
