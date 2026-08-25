#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

const source = fs.readFileSync("lib/launch-method.ts", "utf8")
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
vm.runInNewContext(`(function (exports, require, module) { ${output}\n})(module.exports, require, module)`, { module, require: () => ({}) })
const methods = module.exports

assert.equal(methods.inferLaunchMethod("this is a sumo launch"), "sumo")
assert.equal(methods.inferLaunchMethod("use the senzu plugin"), "senzu_plugin")
assert.equal(methods.inferLaunchMethod("using a launch dev plugin"), "senzu_plugin")
assert.equal(methods.inferLaunchMethod("use another other mm plugin"), "other_mm_plugin")
assert.equal(methods.normalizeLaunchMethod("Other MM Plugin"), "other_mm_plugin")
assert.equal(methods.launchMethodLabel("senzu_plugin"), "Senzu plugin")

console.log("PASS: launch methods normalize, infer, and label all three supported options.")
