#!/usr/bin/env node

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../app/api/telegram/webhook/route.ts", import.meta.url), "utf8")
const callbackStart = source.indexOf("async function handleCallback(")
const callbackEnd = source.indexOf("async function routeText(", callbackStart)

assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, "Telegram callback handler could not be located.")

const callbackBody = source.slice(callbackStart, callbackEnd)
assert.doesNotMatch(
  callbackBody,
  /return\s+sendMessage\(token,\s*chatId,/,
  "Button callbacks must edit the current workflow card instead of returning a new intermediary message.",
)

const workflowHelperStart = source.indexOf("async function editOrSendWorkflowMessage(")
const workflowHelperEnd = source.indexOf("\nfunction botReplyMarkup", workflowHelperStart)
const workflowHelperBody = source.slice(workflowHelperStart, workflowHelperEnd)
assert.match(
  workflowHelperBody,
  /await deleteWorkflowMessages\(token, chatId, \[messageId\]\)/,
  "If Telegram cannot edit a workflow card, the old intermediary card must be removed before sending its replacement.",
)

const requiredSingleCardFlows = [
  "sendLaunchCalculatorStart",
  "sendProjects",
  "sendProjectDetail",
  "sendDataProjects",
  "sendProjectSheets",
  "sendSheetDetail",
  "sendPayroll",
  "sendReceiptProjectPicker",
  "sendReceiptConfirmation",
  "sendExistingExpectationPicker",
]

for (const functionName of requiredSingleCardFlows) {
  const start = source.indexOf(`async function ${functionName}(`)
  const end = source.indexOf("\nasync function ", start + 1)
  assert.ok(start >= 0, `${functionName} could not be located.`)
  const body = source.slice(start, end < 0 ? source.length : end)
  assert.match(body, /editOrSendWorkflowMessage\(/, `${functionName} must support the single-card workflow rule.`)
}

console.log("PASS: Telegram button workflows are guarded against direct intermediary replies, and all major flow renderers support in-place editing.")
