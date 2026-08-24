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
const config = botLabConfig({ telegramId, chatId: telegramId })
const suffix = Date.now().toString().slice(-6)
const projectName = `Codex Workflow ${suffix}`
let server

function responseText(data) {
  return (data.messages || []).map((message) => message.text || "").join("\n")
}

function confirmationCallback(data) {
  for (const message of data.messages || []) {
    for (const row of message.replyMarkup?.inline_keyboard || []) {
      const button = row.find((item) => String(item.callback_data || "").startsWith("ai:confirm:"))
      if (button) return button.callback_data
    }
  }
  return ""
}

async function lookupTestProject() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required to verify the workflow test.")
  const query = new URLSearchParams({ select: "id,data,collection", collection: "eq.opsProjects", limit: "1000" })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Project verification failed: ${response.status} ${await response.text()}`)
  const rows = await response.json()
  return rows.find((row) => row.data?.name === projectName)?.data || null
}

async function cleanup() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required to clean up the workflow test.")
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
  return ids.length
}

try {
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  const proposed = await sendBotLabUpdate(config, { text: `add ${projectName} launch tomorrow at 9am ET to the calendar, its solana/pumpfun` })
  const callbackData = confirmationCallback(proposed)
  if (!callbackData) throw new Error(`The bot did not return a confirmation button. Response: ${responseText(proposed)}`)

  const confirmed = await sendBotLabUpdate(config, { callbackData })
  const text = responseText(confirmed)
  const required = [`✅ Launch scheduled successfully: ${projectName}`, "📅 Launch Schedule", projectName, "9:00 AM", "Scheduled"]
  const missing = required.filter((value) => !text.includes(value))
  if (missing.length) throw new Error(`Confirmed response is missing ${missing.join(", ")}. Response: ${text}`)
  const project = await lookupTestProject()
  if (!project) throw new Error("The scheduled project was not stored.")
  const expectedFields = { status: "scheduled", launchVenue: "pumpfun", chain: "solana", quoteToken: "SOL", feeConfigurationConfirmed: true, dailyTradingFeeEnabled: true }
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (project[field] !== expected) throw new Error(`Expected stored ${field}=${expected}, received ${project[field]}`)
  }
  if (project.referrerStatus !== "pending") throw new Error(`Expected referrer decision to remain pending, received ${project.referrerStatus}`)

  console.log(text)
  console.log("\nPASS: natural-language launch creation stored the lifecycle and launch configuration, then returned the complete schedule.")
} finally {
  const deleted = await cleanup().catch((error) => {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`)
    return 0
  })
  console.log(`Cleanup: removed ${deleted} test records.`)
  stopBotLabServer(server)
}
