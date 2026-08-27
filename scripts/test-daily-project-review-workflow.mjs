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

const telegramId = 990000399
const config = botLabConfig({ telegramId, chatId: telegramId, chatType: "group" })
const telegramChatId = String(-Math.abs(config.chatId))
const dateKey = "2026-08-27"
const memberId = `codex-eod-member-${telegramId}`
const membershipId = `codex-eod-membership-${telegramId}`
const profileId = `codex-eod-profile-${telegramId}`
const firstProjectId = `codex-eod-project-one-${telegramId}`
const secondProjectId = `codex-eod-project-two-${telegramId}`
const reviewId = `daily-project-review:${telegramChatId}:${dateKey}`
let server

function credentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required for the daily project review test.")
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
  const rows = await documents(["opsProjects", "opsDailyProjectReviews", "opsProjectLifecycleEvents", "opsChatProfiles", "guardMembers", "guardChatMembers", "opsBotLogs"])
  const ids = rows.filter((row) => {
    if ([memberId, membershipId, profileId, firstProjectId, secondProjectId, reviewId].includes(row.id)) return true
    return Number(row.data?.telegramId) === telegramId || String(row.data?.chatId || "") === telegramChatId && String(row.data?.reviewDate || "") === dateKey
  }).map((row) => row.id)
  for (const id of ids) {
    const response = await fetch(`${url}/rest/v1/documents?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    if (!response.ok) throw new Error(`Cleanup failed: ${response.status} ${await response.text()}`)
  }
}

function responseText(data) {
  return (data.messages || []).map((message) => message.text || "").join("\n")
}

function assertEditedOnly(data, messageId, label) {
  assert.ok(data.calls?.some((call) => call.method === "editMessageText" && Number(call.body?.message_id) === Number(messageId)), `${label} should edit the existing checklist card.`)
  assert.equal(data.calls?.some((call) => call.method === "sendMessage"), false, `${label} should not create an intermediary bot message.`)
}

async function setup() {
  const now = new Date().toISOString()
  await upsertDocument("guardMembers", memberId, { telegramId, firstName: "Night", lastName: "Trader", username: "night_trader", accessRole: "member", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("guardChatMembers", membershipId, { chatId: telegramChatId, telegramId, membershipStatus: "active", firstName: "Night", lastName: "Trader", username: "night_trader", createdAt: now, updatedAt: now })
  await upsertDocument("opsChatProfiles", profileId, { chatId: telegramChatId, profile: "trade", title: "Codex Trade Floor Review Test", chatType: "group", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("opsProjects", firstProjectId, { name: "One-day launch", status: "active", activatedAt: "2026-08-27T14:00:00.000Z", dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500, createdAt: now, updatedAt: now })
  await upsertDocument("opsProjects", secondProjectId, { name: "Keep trading", status: "active", activatedAt: "2026-08-25T14:00:00.000Z", dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500, createdAt: now, updatedAt: now })
  await upsertDocument("opsDailyProjectReviews", reviewId, {
    chatId: telegramChatId,
    chatTitle: "Codex Trade Floor Review Test",
    dateKey,
    projects: [
      { projectId: firstProjectId, name: "One-day launch", activeSince: "2026-08-27T14:00:00.000Z" },
      { projectId: secondProjectId, name: "Keep trading", activeSince: "2026-08-25T14:00:00.000Z" },
    ],
    selectedProjectIds: [],
    status: "pending",
    createdAt: now,
    updatedAt: now,
  })
}

try {
  await cleanup().catch(() => null)
  await setup()
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  const messageId = 700

  const selected = await sendBotLabUpdate(config, { callbackData: `eod:pick:${dateKey}:0`, messageId })
  assertEditedOnly(selected, messageId, "Selecting a finished project")
  assert.match(responseText(selected), /1 selected to deactivate/)
  assert.match(responseText(selected), /One-day launch/)

  const confirmation = await sendBotLabUpdate(config, { callbackData: `eod:review:${dateKey}`, messageId })
  assertEditedOnly(confirmation, messageId, "Reviewing the deactivation")
  assert.match(responseText(confirmation), /Deactivate selected projects/)
  assert.match(responseText(confirmation), /Revenue history, files, and notes stay intact/)

  const completed = await sendBotLabUpdate(config, { callbackData: `eod:confirm:${dateKey}`, messageId })
  assertEditedOnly(completed, messageId, "Confirming the daily cleanup")
  assert.match(responseText(completed), /End-of-day project check complete/)
  assert.match(responseText(completed), /Deactivated \(1\)/)
  assert.match(responseText(completed), /Still active \(1\)/)
  assert.match(responseText(completed), /Reviewed by Night Trader/)

  const rows = await documents(["opsProjects", "opsDailyProjectReviews", "opsProjectLifecycleEvents"])
  const firstProject = rows.find((row) => row.id === firstProjectId)?.data
  const secondProject = rows.find((row) => row.id === secondProjectId)?.data
  const review = rows.find((row) => row.id === reviewId)?.data
  const lifecycleEvent = rows.find((row) => row.collection === "opsProjectLifecycleEvents" && row.data?.projectId === firstProjectId)?.data
  assert.equal(firstProject?.status, "inactive")
  assert.equal(firstProject?.inactivationSource, "daily_trade_review")
  assert.equal(secondProject?.status, "active")
  assert.equal(review?.status, "completed")
  assert.deepEqual(review?.deactivatedProjectIds, [firstProjectId])
  assert.equal(lifecycleEvent?.action, "deactivated")
  assert.equal(lifecycleEvent?.source, "daily_trade_review")

  console.log("PASS: the Trade Floor checklist edits one card, confirms bulk cleanup, deactivates only selected projects, and records an audit event without deleting project history.")
} finally {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`))
  stopBotLabServer(server)
}
