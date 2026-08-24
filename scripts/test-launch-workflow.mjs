#!/usr/bin/env node

import dotenv from "dotenv"
import {
  botLabConfig,
  ensureBotLabServer,
  resetBotLab,
  sendBotLabUpdate,
  stopBotLabServer,
} from "./lib/bot-lab-client.mjs"

dotenv.config({ path: ".env.local" })

const telegramId = 990000199
const config = botLabConfig({ telegramId, chatId: telegramId, chatType: "group" })
const suffix = Date.now().toString().slice(-6)
const projectName = `SnapGame${suffix}`
const launchChatId = String(-Math.abs(config.chatId))
const launchProfileId = `codex-launch-profile-${telegramId}`
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

function supabaseCredentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required for the launch workflow test.")
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }
}

async function seedLaunchChatProfile() {
  const { url, headers } = supabaseCredentials()
  const now = new Date().toISOString()
  const response = await fetch(`${url}/rest/v1/documents?on_conflict=collection,id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      collection: "opsChatProfiles",
      id: launchProfileId,
      data: { _id: launchProfileId, chatId: launchChatId, profile: "launch", title: "Codex Launch Test", chatType: "group", status: "active", createdAt: now, updatedAt: now },
      updated_at: now,
    }),
  })
  if (!response.ok) throw new Error(`Launch Chat profile setup failed: ${response.status} ${await response.text()}`)
}

async function lookupTestProject() {
  const { url, key } = supabaseCredentials()
  const query = new URLSearchParams({ select: "id,data,collection", collection: "eq.opsProjects", limit: "1000" })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Project verification failed: ${response.status} ${await response.text()}`)
  const rows = await response.json()
  return rows.find((row) => row.data?.name === projectName)?.data || null
}

async function cleanup() {
  const { url, key } = supabaseCredentials()
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const query = new URLSearchParams({
    select: "id,data,collection",
    collection: "in.(opsProjects,opsSheets,opsAiActions,opsBotLogs)",
    limit: "1000",
  })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers })
  if (!response.ok) throw new Error(`Cleanup lookup failed: ${response.status} ${await response.text()}`)
  const rows = await response.json()
  const project = rows.find((row) => row.collection === "opsProjects" && row.data?.name === projectName)
  const projectId = String(project?.data?._id || "")
  const ids = rows.filter((row) => {
    if (row.collection === "opsProjects") return row.data?.name === projectName
    if (row.collection === "opsSheets") return row.data?.projectName === projectName || (projectId && String(row.data?.projectId) === projectId)
    return Number(row.data?.telegramId) === telegramId
  }).map((row) => row.id)
  for (const id of ids) {
    const deleted = await fetch(`${url}/rest/v1/documents?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    if (!deleted.ok) throw new Error(`Cleanup delete failed: ${deleted.status} ${await deleted.text()}`)
  }
  const profileDeleted = await fetch(`${url}/rest/v1/documents?collection=eq.opsChatProfiles&id=eq.${encodeURIComponent(launchProfileId)}`, { method: "DELETE", headers })
  if (!profileDeleted.ok) throw new Error(`Launch Chat profile cleanup failed: ${profileDeleted.status} ${await profileDeleted.text()}`)
  return ids.length
}

try {
  await seedLaunchChatProfile()
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  const proposed = await sendBotLabUpdate(config, { text: `/schedulelaunch ${projectName} pumpfun sol launch at 5:10 pm ET today` })
  const proposedText = responseText(proposed)
  const reviewFields = ["Review launch", `Project name: <b>${projectName}</b>`, "Pump.fun", "Solana", "Quote token: <b>SOL</b>", "Choose before creating", "Nothing is saved until you tap Create launch"]
  const missingReviewFields = reviewFields.filter((value) => !proposedText.includes(value))
  if (missingReviewFields.length) throw new Error(`Launch review is missing ${missingReviewFields.join(", ")}. Response: ${proposedText}`)
  if (await lookupTestProject()) throw new Error("The project was created before the final Create launch confirmation.")
  const noReferrerCallback = callbackStartingWith(proposed, "launchsetup:noref:")
  if (!noReferrerCallback) throw new Error(`The launch review did not include the no-referrer choice. Response: ${proposedText}`)

  const noReferrer = await sendBotLabUpdate(config, { callbackData: noReferrerCallback, messageId: proposed.messages?.[0]?.messageId })
  const noReferrerText = responseText(noReferrer)
  if (!noReferrerText.includes("No referrer confirmed") || !noReferrerText.includes("Everything is ready")) throw new Error(`No-referrer selection did not produce a ready review. Response: ${noReferrerText}`)
  const createCallback = callbackStartingWith(noReferrer, "launchsetup:create:")
  if (!createCallback) throw new Error(`The ready launch review did not include Create launch. Response: ${noReferrerText}`)

  const confirmed = await sendBotLabUpdate(config, { callbackData: createCallback, messageId: noReferrer.messages?.[0]?.messageId || proposed.messages?.[0]?.messageId })
  const text = responseText(confirmed)
  const required = [`✅ Launch scheduled successfully: ${projectName}`, "📅 Launch Schedule", projectName, "5:10 PM", "Scheduled"]
  const missing = required.filter((value) => !text.includes(value))
  if (missing.length) throw new Error(`Confirmed response is missing ${missing.join(", ")}. Response: ${text}`)
  const project = await lookupTestProject()
  if (!project) throw new Error("The scheduled project was not stored.")
  const expectedFields = { status: "scheduled", launchVenue: "pumpfun", chain: "solana", quoteToken: "SOL", feeConfigurationConfirmed: true, dailyTradingFeeEnabled: true }
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (project[field] !== expected) throw new Error(`Expected stored ${field}=${expected}, received ${project[field]}`)
  }
  if (project.referrerStatus !== "none") throw new Error(`Expected no-referrer decision to be stored, received ${project.referrerStatus}`)

  console.log(text)
  console.log("\nPASS: guided launch review corrected the name, preserved launch configuration, required the referrer decision, and created only after final confirmation.")
} finally {
  const deleted = await cleanup().catch((error) => {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`)
    return 0
  })
  console.log(`Cleanup: removed ${deleted} test records.`)
  stopBotLabServer(server)
}
