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

const telegramId = 990000299
const config = botLabConfig({ telegramId, chatId: telegramId, chatType: "group" })
const telegramChatId = String(-Math.abs(config.chatId))
const memberId = `codex-reminder-member-${telegramId}`
const userId = `codex-reminder-user-${telegramId}`
const profileId = `codex-reminder-profile-${telegramId}`
const alexTelegramId = telegramId + 1
const samTelegramId = telegramId + 2
const alexMemberId = `codex-reminder-member-${alexTelegramId}`
const samMemberId = `codex-reminder-member-${samTelegramId}`
const creatorMembershipId = `codex-reminder-membership-${telegramId}`
const alexMembershipId = `codex-reminder-membership-${alexTelegramId}`
const samMembershipId = `codex-reminder-membership-${samTelegramId}`
let server

function responseText(data) {
  return (data.messages || []).map((message) => message.text || "").join("\n")
}

function callbackStartingWith(data, prefix) {
  for (const message of data.messages || []) {
    for (const row of message.replyMarkup?.inline_keyboard || []) {
      const button = row.find((item) => String(item.callback_data || "").startsWith(prefix))
      if (button) return button.callback_data
    }
  }
  return ""
}

function assertEditedInPlace(data, messageId, label) {
  assert.ok(
    data.calls?.some((call) => call.method === "editMessageText" && Number(call.body?.message_id) === Number(messageId)),
    `${label} should edit the current reminder card.`,
  )
  assert.equal(
    data.calls?.some((call) => call.method === "sendMessage"),
    false,
    `${label} should not leave an intermediary bot message behind.`,
  )
}

function supabaseCredentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required for the reminder workflow test.")
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }
}

async function upsertDocument(collection, id, data) {
  const { url, headers } = supabaseCredentials()
  const now = new Date().toISOString()
  const response = await fetch(`${url}/rest/v1/documents?on_conflict=collection,id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ collection, id, data: { _id: id, ...data }, updated_at: now }),
  })
  if (!response.ok) throw new Error(`Test setup failed for ${collection}: ${response.status} ${await response.text()}`)
}

async function setup() {
  const now = new Date().toISOString()
  await upsertDocument("guardMembers", memberId, { telegramId, firstName: "Reminder", username: "reminder_lab", accessRole: "member", status: "active", timeZone: "America/New_York", createdAt: now, updatedAt: now })
  await upsertDocument("guardMembers", alexMemberId, { telegramId: alexTelegramId, firstName: "Alex", username: "alex_lab", accessRole: "member", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("guardMembers", samMemberId, { telegramId: samTelegramId, firstName: "Sam", username: "sam_lab", accessRole: "member", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("users", userId, { telegramId, guardAccess: "active", timeZone: "America/New_York", createdAt: now, updatedAt: now })
  await upsertDocument("opsChatProfiles", profileId, { chatId: telegramChatId, profile: "trade", title: "Codex Trade Reminder Test", chatType: "group", status: "active", createdAt: now, updatedAt: now })
  await upsertDocument("guardChatMembers", creatorMembershipId, { chatId: telegramChatId, telegramId, membershipStatus: "active", firstName: "Reminder", username: "reminder_lab", createdAt: now, updatedAt: now })
  await upsertDocument("guardChatMembers", alexMembershipId, { chatId: telegramChatId, telegramId: alexTelegramId, membershipStatus: "active", firstName: "Alex", username: "alex_lab", createdAt: now, updatedAt: now })
  await upsertDocument("guardChatMembers", samMembershipId, { chatId: telegramChatId, telegramId: samTelegramId, membershipStatus: "active", firstName: "Sam", username: "sam_lab", createdAt: now, updatedAt: now })
}

async function documents(collections) {
  const { url, key } = supabaseCredentials()
  const query = new URLSearchParams({ select: "id,data,collection", collection: `in.(${collections.join(",")})`, limit: "1000" })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Verification lookup failed: ${response.status} ${await response.text()}`)
  return response.json()
}

async function cleanup() {
  const { url, key } = supabaseCredentials()
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const rows = await documents(["opsReminders", "opsAiActions", "opsBotLogs", "opsBotStates", "opsChatProfiles", "guardMembers", "guardChatMembers", "users"])
  const ids = rows.filter((row) => {
    if ([profileId, memberId, alexMemberId, samMemberId, creatorMembershipId, alexMembershipId, samMembershipId, userId].includes(row.id)) return true
    return Number(row.data?.telegramId) === telegramId || String(row.data?.telegramChatId || "") === telegramChatId
  }).map((row) => row.id)
  for (const id of ids) {
    const response = await fetch(`${url}/rest/v1/documents?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    if (!response.ok) throw new Error(`Cleanup failed: ${response.status} ${await response.text()}`)
  }
}

function reminderDayWord() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0)
  return hour < 20 ? "today" : "tomorrow"
}

async function confirmProposal(proposal) {
  const callbackData = callbackStartingWith(proposal, "ai:confirm:")
  assert.ok(callbackData, `Reminder proposal did not include Confirm. Response: ${responseText(proposal)}`)
  const previewMessageId = proposal.messages?.[0]?.messageId
  const confirmed = await sendBotLabUpdate(config, { callbackData, messageId: previewMessageId })
  assert.ok(
    confirmed.calls?.some((call) => call.method === "deleteMessage" && Number(call.body?.message_id) === Number(previewMessageId)),
    "Successful reminder confirmation should delete its preview message.",
  )
  return confirmed
}

try {
  await cleanup().catch(() => null)
  await setup()
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  const day = reminderDayWord()

  const list = await sendBotLabUpdate(config, { text: "/reminders" })
  const addCallback = callbackStartingWith(list, "reminder:add")
  assert.ok(addCallback, `Reminder list did not offer Add Reminder. Response: ${responseText(list)}`)
  const prompt = await sendBotLabUpdate(config, { callbackData: addCallback, messageId: list.messages?.[0]?.messageId })
  assert.match(responseText(prompt), /Write it naturally/)
  assert.doesNotMatch(responseText(prompt), /YYYY-MM-DD HH:mm/)

  const manual = await sendBotLabUpdate(config, { text: `WWR injection 8pm ET ${day}` })
  assert.match(responseText(manual), /Who should be notified/)
  const alexToggle = callbackStartingWith(manual, `reminderto:toggle:${alexTelegramId}`)
  assert.ok(alexToggle, `Reminder audience picker did not include Alex. Response: ${responseText(manual)}`)
  const selectedAlex = await sendBotLabUpdate(config, { callbackData: alexToggle, messageId: manual.messages?.[0]?.messageId })
  assert.match(responseText(selectedAlex), /Selected: Alex/)
  const saveSelected = callbackStartingWith(selectedAlex, "reminderto:save")
  const manualSaved = await sendBotLabUpdate(config, { callbackData: saveSelected, messageId: selectedAlex.messages?.[0]?.messageId })
  assert.match(responseText(manualSaved), /✅ Reminder set/)
  assert.match(responseText(manualSaved), /🔔 WWR injection/)
  assert.match(responseText(manualSaved), /8:00 PM ET/)
  assert.match(responseText(manualSaved), /Notify: Alex/)

  const commandProposal = await sendBotLabUpdate(config, { text: `/setreminder WWR injection command test ${day} at 8:10pm ET` })
  assert.match(responseText(commandProposal), /WWR injection command test/)
  assert.match(responseText(commandProposal), /8:10 PM ET/)
  const commandConfirmed = await confirmProposal(commandProposal)
  assert.match(responseText(commandConfirmed), /✅ Reminder created: WWR injection command test/)

  const aiProposal = await sendBotLabUpdate(config, { text: `@ghostbot_local_lab remind @alex_lab and @sam_lab at 8:20pm ET ${day} about WWR injection AI test` })
  assert.match(responseText(aiProposal), /WWR injection AI test/)
  assert.match(responseText(aiProposal), /8:20 PM ET/)
  assert.match(responseText(aiProposal), /Notify: Alex, Sam/)
  const aiConfirmed = await confirmProposal(aiProposal)
  assert.match(responseText(aiConfirmed), /✅ Reminder created: WWR injection AI test/)

  const rows = await documents(["opsReminders"])
  const reminders = rows.map((row) => row.data).filter((row) => String(row.telegramChatId || "") === telegramChatId)
  assert.deepEqual(reminders.map((row) => row.title).sort(), ["WWR injection", "WWR injection AI test", "WWR injection command test"])
  assert.ok(reminders.every((row) => new Date(row.dueAt).getTime() > Date.now()), "Every saved reminder must have a future due time.")
  assert.equal(reminders.find((row) => row.title === "WWR injection")?.targetMembers?.[0]?.username, "alex_lab")
  assert.deepEqual(reminders.find((row) => row.title === "WWR injection AI test")?.targetMembers?.map((member) => member.username), ["alex_lab", "sam_lab"])

  const navigationList = await sendBotLabUpdate(config, { text: "/reminders" })
  const navigationMessageId = navigationList.messages?.[0]?.messageId
  const openReminder = callbackStartingWith(navigationList, "reminder:view:")
  assert.ok(openReminder, `Reminder list did not include an Open button. Response: ${responseText(navigationList)}`)

  const detail = await sendBotLabUpdate(config, { callbackData: openReminder, messageId: navigationMessageId })
  assertEditedInPlace(detail, navigationMessageId, "Opening a reminder")
  const backToReminders = callbackStartingWith(detail, "reminders:list")
  assert.ok(backToReminders, `Reminder detail did not include a Back button. Response: ${responseText(detail)}`)

  const returnedList = await sendBotLabUpdate(config, { callbackData: backToReminders, messageId: navigationMessageId })
  assertEditedInPlace(returnedList, navigationMessageId, "Returning to the reminder list")
  const reopenReminder = callbackStartingWith(returnedList, "reminder:view:")
  const reopenedDetail = await sendBotLabUpdate(config, { callbackData: reopenReminder, messageId: navigationMessageId })
  assertEditedInPlace(reopenedDetail, navigationMessageId, "Reopening a reminder")
  const removeReminder = callbackStartingWith(reopenedDetail, "reminder:delete:")
  assert.ok(removeReminder, `Reminder detail did not include Remove. Response: ${responseText(reopenedDetail)}`)

  const removed = await sendBotLabUpdate(config, { callbackData: removeReminder, messageId: navigationMessageId })
  assertEditedInPlace(removed, navigationMessageId, "Removing a reminder")
  assert.match(responseText(removed), /🔔 Reminders/)

  console.log("PASS: Trade Chat reminders support member targeting and natural language, clean up confirmed previews, and reuse one bot card while members browse or remove reminders.")
} finally {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`))
  stopBotLabServer(server)
}
