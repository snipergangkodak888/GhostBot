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
const tentativeProjectName = `Tentative${suffix}`
const testProjectNames = new Set([projectName, tentativeProjectName])
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

async function lookupTestProject(name = projectName) {
  const { url, key } = supabaseCredentials()
  const query = new URLSearchParams({ select: "id,data,collection", collection: "eq.opsProjects", limit: "1000" })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Project verification failed: ${response.status} ${await response.text()}`)
  const rows = await response.json()
  return rows.find((row) => row.data?.name === name)?.data || null
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
  const projectIds = new Set(rows.filter((row) => row.collection === "opsProjects" && testProjectNames.has(row.data?.name)).map((row) => String(row.data?._id || "")))
  const ids = rows.filter((row) => {
    if (row.collection === "opsProjects") return testProjectNames.has(row.data?.name)
    if (row.collection === "opsSheets") return testProjectNames.has(row.data?.projectName) || projectIds.has(String(row.data?.projectId || ""))
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
  const proposed = await sendBotLabUpdate(config, { text: `/schedulelaunch ${projectName} pumpfun sol launch at 5:10 pm ET today - sumo` })
  const proposedText = responseText(proposed)
  const reviewFields = ["Review launch", `Project name: <b>${projectName}</b>`, "Pump.fun", "Solana", "Quote token: <b>SOL</b>", "Launch method: <b>Sumo</b>", "Choose before creating", "Nothing is saved until you tap Create launch"]
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
  const expectedFields = { status: "scheduled", launchVenue: "pumpfun", chain: "solana", quoteToken: "SOL", launchMethod: "sumo", feeConfigurationConfirmed: true, dailyTradingFeeEnabled: true }
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (project[field] !== expected) throw new Error(`Expected stored ${field}=${expected}, received ${project[field]}`)
  }
  if (project.referrerStatus !== "none") throw new Error(`Expected no-referrer decision to be stored, received ${project.referrerStatus}`)

  const tentativeProposed = await sendBotLabUpdate(config, { text: `/schedulelaunch ${tentativeProjectName} pumpfun sol launch today time TBD - senzu plugin` })
  const tentativeReview = responseText(tentativeProposed)
  for (const requiredField of ["Review launch", `Project name: <b>${tentativeProjectName}</b>`, "Time TBD (tentative)", "Pump.fun", "Solana", "Quote token: <b>SOL</b>", "Launch method: <b>Senzu plugin</b>"]) {
    if (!tentativeReview.includes(requiredField)) throw new Error(`Tentative review is missing ${requiredField}. Response: ${tentativeReview}`)
  }
  const tentativeNoRefCallback = callbackStartingWith(tentativeProposed, "launchsetup:noref:")
  const tentativeNoRef = await sendBotLabUpdate(config, { callbackData: tentativeNoRefCallback, messageId: tentativeProposed.messages?.[0]?.messageId })
  const tentativeCreateCallback = callbackStartingWith(tentativeNoRef, "launchsetup:create:")
  if (!tentativeCreateCallback) throw new Error(`Tentative review did not become ready. Response: ${responseText(tentativeNoRef)}`)
  const tentativeCreated = await sendBotLabUpdate(config, { callbackData: tentativeCreateCallback, messageId: tentativeNoRef.messages?.[0]?.messageId || tentativeProposed.messages?.[0]?.messageId })
  const tentativeCreatedText = responseText(tentativeCreated)
  for (const requiredField of [`✅ Tentative launch added: ${tentativeProjectName}`, "Time TBD", "Tentative"]) {
    if (!tentativeCreatedText.includes(requiredField)) throw new Error(`Tentative creation is missing ${requiredField}. Response: ${tentativeCreatedText}`)
  }
  const tentativeProject = await lookupTestProject(tentativeProjectName)
  if (!tentativeProject) throw new Error("The tentative project was not stored.")
  if (tentativeProject.launchAt || tentativeProject.launchDate) throw new Error("Tentative launch incorrectly stored a fake exact timestamp.")
  if (tentativeProject.launchMethod !== "senzu_plugin") throw new Error(`Expected Senzu launch method, received ${tentativeProject.launchMethod}`)
  if (tentativeProject.launchTimingStatus !== "tentative" || !/^\d{4}-\d{2}-\d{2}$/.test(String(tentativeProject.tentativeLaunchDate || ""))) throw new Error(`Tentative timing fields are invalid: ${JSON.stringify(tentativeProject)}`)

  const calendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const calendarText = responseText(calendar)
  for (const expected of ["Today’s Launches —", `TBD — ${tentativeProjectName} · Solana/Pump.fun · SOL · Senzu plugin`]) {
    if (!calendarText.includes(expected)) throw new Error(`Calendar is missing ${expected}. Response: ${calendarText}`)
  }
  if (calendarText.includes("🚀") || calendarText.includes("· Scheduled") || calendarText.match(/Aug \d{1,2}/g)?.length !== 1) throw new Error(`Calendar was not reduced to the compact one-day format. Response: ${calendarText}`)
  const setTimeCallback = callbackStartingWith(calendar, `lifecycle:settime:${tentativeProject._id}:`)
  if (!setTimeCallback) throw new Error(`Calendar did not include Set time for the tentative launch. Response: ${calendarText}`)
  const setTimePrompt = await sendBotLabUpdate(config, { callbackData: setTimeCallback, messageId: calendar.messages?.[0]?.messageId })
  if (!responseText(setTimePrompt).includes("Send the exact launch date and time")) throw new Error(`Set-time action did not prompt for an exact time. Response: ${responseText(setTimePrompt)}`)
  const exactTime = await sendBotLabUpdate(config, { text: "/time today at 6:20 PM ET" })
  if (!responseText(exactTime).includes("now has a confirmed launch time")) throw new Error(`Tentative launch did not accept an exact time. Response: ${responseText(exactTime)}`)
  const confirmedTentativeProject = await lookupTestProject(tentativeProjectName)
  if (confirmedTentativeProject.launchTimingStatus !== "confirmed" || !confirmedTentativeProject.launchAt || confirmedTentativeProject.tentativeLaunchDate) throw new Error(`Tentative launch was not converted cleanly to confirmed timing: ${JSON.stringify(confirmedTentativeProject)}`)

  const methodDraft = await sendBotLabUpdate(config, { text: `/schedulelaunch MethodChoice${suffix} pumpfun sol launch tomorrow at 2 PM ET no referrer` })
  const methodDraftText = responseText(methodDraft)
  if (!methodDraftText.includes("launch method") || !callbackStartingWith(methodDraft, "launchsetup:method:")) throw new Error(`A missing launch method did not expose the required picker. Response: ${methodDraftText}`)
  const methodPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(methodDraft, "launchsetup:method:"), messageId: methodDraft.messages?.[0]?.messageId })
  const otherMethodCallback = callbackStartingWith(methodPicker, "launchsetup:setmethod:") && (methodPicker.messages || []).flatMap((message) => message.replyMarkup?.inline_keyboard || []).flat().find((button) => String(button.callback_data || "").endsWith(":other_mm_plugin"))?.callback_data
  if (!otherMethodCallback) throw new Error(`The launch method picker did not include Other MM plugin. Response: ${responseText(methodPicker)}`)
  const selectedMethod = await sendBotLabUpdate(config, { callbackData: otherMethodCallback, messageId: methodPicker.messages?.[0]?.messageId })
  if (!responseText(selectedMethod).includes("Launch method: <b>Other MM plugin</b>")) throw new Error(`The selected launch method was not returned to review. Response: ${responseText(selectedMethod)}`)
  const cancelMethodDraft = callbackStartingWith(selectedMethod, "launchsetup:cancel:")
  if (cancelMethodDraft) await sendBotLabUpdate(config, { callbackData: cancelMethodDraft, messageId: selectedMethod.messages?.[0]?.messageId })

  console.log(text)
  console.log(tentativeCreatedText)
  console.log("\nPASS: guided launch setup handles exact and Time TBD launches, requires all three launch-method choices, exposes calendar timing controls, and confirms the exact time later.")
} finally {
  const deleted = await cleanup().catch((error) => {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`)
    return 0
  })
  console.log(`Cleanup: removed ${deleted} test records.`)
  stopBotLabServer(server)
}
