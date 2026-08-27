#!/usr/bin/env node

import assert from "node:assert/strict"
import dotenv from "dotenv"
import {
  botLabConfig,
  ensureBotLabServer,
  resetBotLab,
  sendBotLabUpdate,
  stopBotLabServer,
} from "./lib/bot-lab-client.mjs"

dotenv.config({ path: ".env.local" })

const telegramId = 990000499
const config = botLabConfig({ telegramId, chatId: telegramId, chatType: "group" })
const telegramChatId = String(-Math.abs(config.chatId))
const memberId = `codex-fee-member-${telegramId}`
const membershipId = `codex-fee-membership-${telegramId}`
const profileId = `codex-fee-profile-${telegramId}`
const projectId = `codex-fee-project-${telegramId}`
const feeId = `codex-fee-event-${telegramId}`
let server

function credentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required for the Fee Inbox workflow test.")
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }
}

async function upsertDocument(collection, id, data) {
  const { url, headers } = credentials()
  const response = await fetch(`${url}/rest/v1/documents?on_conflict=collection,id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ collection, id, data: { _id: id, ...data }, updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`Test setup failed for ${collection}: ${response.status} ${await response.text()}`)
}

async function documents(collections) {
  const { url, key } = credentials()
  const query = new URLSearchParams({ select: "id,data,collection", collection: `in.(${collections.join(",")})`, limit: "1000" })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Verification lookup failed: ${response.status} ${await response.text()}`)
  return response.json()
}

async function cleanup() {
  const { url, key } = credentials()
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const rows = await documents(["revenueFeeEvents", "opsProjects", "opsChatProfiles", "guardMembers", "guardChatMembers", "opsBotLogs", "opsBotStates"])
  const ids = rows.filter((row) => {
    if ([memberId, membershipId, profileId, projectId, feeId].includes(row.id)) return true
    return Number(row.data?.telegramId) === telegramId || String(row.data?.telegramChatId || "") === telegramChatId
  }).map((row) => row.id)
  for (const id of ids) {
    const response = await fetch(`${url}/rest/v1/documents?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    if (!response.ok) throw new Error(`Cleanup failed: ${response.status} ${await response.text()}`)
  }
}

function responseText(data) {
  return (data.messages || []).map((message) => message.text || "").join("\n")
}

function buttonText(data) {
  return (data.messages || []).flatMap((message) => message.replyMarkup?.inline_keyboard || []).flat().map((button) => button.text || "").join("\n")
}

function assertEditedOnly(data, messageId, label) {
  assert.ok(
    data.calls?.some((call) => call.method === "editMessageText" && Number(call.body?.message_id) === Number(messageId)),
    `${label} should edit the current Fee Inbox card.`,
  )
  assert.equal(
    data.calls?.some((call) => call.method === "sendMessage"),
    false,
    `${label} should not leave an intermediary bot message behind.`,
  )
}

async function setup() {
  const now = new Date().toISOString()
  await upsertDocument("guardMembers", memberId, { telegramId, firstName: "Finance", lastName: "Admin", username: "fee_admin_lab", accessRole: "admin", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("guardChatMembers", membershipId, { chatId: telegramChatId, telegramId, membershipStatus: "active", firstName: "Finance", lastName: "Admin", username: "fee_admin_lab", createdAt: now, updatedAt: now })
  await upsertDocument("opsChatProfiles", profileId, { chatId: telegramChatId, profile: "fee", title: "Codex Fee Inbox Flow Test", chatType: "group", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("opsProjects", projectId, {
    name: "Fee Flow Project",
    status: "active",
    chain: "solana",
    quoteToken: "SOL",
    quoteAssets: ["SOL"],
    dailyTradingFeeEnabled: true,
    dailyTradingFeeUsd: 500,
    launchFeeUsd: 1000,
    feeConfigurationConfirmed: true,
    createdAt: now,
    updatedAt: now,
  })
  await upsertDocument("revenueFeeEvents", feeId, {
    date: "2026-08-27",
    source: "telegram_forward",
    sourceKey: `codex-fee-flow:${telegramId}`,
    feeType: null,
    grossAmount: 100,
    grossAsset: "SOL",
    expectedAssetAmount: null,
    expectedUsd: null,
    status: "awaiting_type",
    matchedReceiptIds: [],
    proposedReceiptIds: [],
    parse: {},
    createdByTelegramId: telegramId,
    createdAt: now,
    updatedAt: now,
  })
}

try {
  await cleanup().catch(() => null)
  await setup()
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  const messageId = 800

  const typed = await sendBotLabUpdate(config, { callbackData: `fee:type:${feeId}:launch`, messageId })
  assertEditedOnly(typed, messageId, "Choosing the fee type")
  assert.match(responseText(typed), /Now choose the existing project/)
  assert.match(buttonText(typed), /Fee Flow Project/)

  const assigned = await sendBotLabUpdate(config, { callbackData: `fee:project:${feeId}:${projectId}`, messageId })
  assertEditedOnly(assigned, messageId, "Choosing the project")
  assert.match(responseText(assigned), /Confirm this expectation/)
  assert.match(responseText(assigned), /Expected USD:.*\$1,000/s)

  const confirmed = await sendBotLabUpdate(config, { callbackData: `fee:confirm:${feeId}`, messageId })
  assertEditedOnly(confirmed, messageId, "Confirming the fee expectation")
  assert.match(responseText(confirmed), /No exact receipt combination is available yet/)
  assert.match(responseText(confirmed), /keep it waiting/)

  const rows = await documents(["revenueFeeEvents"])
  const fee = rows.find((row) => row.id === feeId)?.data
  assert.equal(fee?.status, "awaiting_receipt")
  assert.equal(fee?.projectId, projectId)
  assert.equal(fee?.feeType, "launch")
  assert.equal(fee?.quoteAsset, "SOL")

  console.log("PASS: Fee Inbox classification edits one card from type through confirmation and leaves no intermediary bot messages.")
} finally {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`))
  stopBotLabServer(server)
}
