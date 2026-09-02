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
const customQuoteProjectName = `CustomQuote${suffix}`
const wizardProjectName = `WizardLaunch${suffix}`
const parsedProjectName = `Pathelous${suffix}`
const testProjectNames = new Set([projectName, tentativeProjectName, customQuoteProjectName, wizardProjectName])
const aaplAddress = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"
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

function callbackMatching(data, prefix, suffix) {
  for (const message of data.messages || []) {
    for (const row of message.replyMarkup?.inline_keyboard || []) {
      const button = row.find((item) => String(item.callback_data || "").startsWith(prefix) && String(item.callback_data || "").endsWith(suffix))
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
    collection: "in.(opsProjects,opsProjectNotes,opsSheets,opsAiActions,opsBotLogs)",
    limit: "1000",
  })
  const response = await fetch(`${url}/rest/v1/documents?${query}`, { headers })
  if (!response.ok) throw new Error(`Cleanup lookup failed: ${response.status} ${await response.text()}`)
  const rows = await response.json()
  const projectIds = new Set(rows.filter((row) => row.collection === "opsProjects" && testProjectNames.has(row.data?.name)).map((row) => String(row.data?._id || "")))
  const ids = rows.filter((row) => {
    if (row.collection === "opsProjects") return testProjectNames.has(row.data?.name)
    if (row.collection === "opsProjectNotes") return testProjectNames.has(row.data?.projectName) || projectIds.has(String(row.data?.projectId || ""))
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
  const required = [`✅ Launch scheduled successfully: ${projectName}`, "Today’s Launches —", projectName, "5:10 PM ET", "Solana/Pump.fun", "Sumo"]
  const missing = required.filter((value) => !text.includes(value))
  if (missing.length) throw new Error(`Confirmed response is missing ${missing.join(", ")}. Response: ${text}`)
  const project = await lookupTestProject()
  if (!project) throw new Error("The scheduled project was not stored.")
  const expectedFields = { status: "scheduled", launchVenue: "pumpfun", launchVenueLabel: "Pump.fun", chain: "solana", quoteToken: "SOL", launchMethod: "sumo", feeConfigurationConfirmed: true, dailyTradingFeeEnabled: true }
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
  const acknowledged = await sendBotLabUpdate(config, { callbackData: `tentative:ack:${tentativeProject.tentativeLaunchDate}`, messageId: tentativeCreated.messages?.[0]?.messageId })
  if (!responseText(acknowledged).includes(`Still TBD confirmed for today: ${tentativeProjectName}`)) throw new Error(`Still-TBD acknowledgement failed. Response: ${responseText(acknowledged)}`)
  const acknowledgedProject = await lookupTestProject(tentativeProjectName)
  if (acknowledgedProject.tentativeTimingAcknowledgedDate !== tentativeProject.tentativeLaunchDate || Number(acknowledgedProject.tentativeTimingAcknowledgedByTelegramId) !== telegramId) throw new Error(`Still-TBD acknowledgement was not recorded: ${JSON.stringify(acknowledgedProject)}`)

  const calendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const calendarText = responseText(calendar)
  for (const expected of ["Today’s Launches —", `TBD — ${tentativeProjectName} · Solana/Pump.fun · Senzu plugin`]) {
    if (!calendarText.includes(expected)) throw new Error(`Calendar is missing ${expected}. Response: ${calendarText}`)
  }
  const calendarDates = calendarText.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g) || []
  if (calendarText.includes("🚀") || calendarText.includes("· Scheduled") || calendarDates.length !== 1) throw new Error(`Calendar was not reduced to the compact one-day format. Response: ${calendarText}`)
  const calendarButtons = (calendar.messages || []).flatMap((message) => message.replyMarkup?.inline_keyboard || []).flat()
  if (calendarButtons.length !== 1 || calendarButtons[0]?.text !== "Open launches" || !String(calendarButtons[0]?.callback_data || "").startsWith("calendar:edit:")) throw new Error(`Calendar should contain only one Open launches button. Buttons: ${JSON.stringify(calendarButtons)}`)
  const editPicker = await sendBotLabUpdate(config, { callbackData: calendarButtons[0].callback_data, messageId: calendar.messages?.[0]?.messageId })
  if (!responseText(editPicker).includes("Choose a launch:")) throw new Error(`Edit launches did not open the launch picker. Response: ${responseText(editPicker)}`)
  const tentativeLaunchCallback = callbackStartingWith(editPicker, `calendar:launch:${tentativeProject._id}:`)
  if (!tentativeLaunchCallback) throw new Error(`Launch picker did not include the tentative launch. Response: ${responseText(editPicker)}`)
  const launchEditor = await sendBotLabUpdate(config, { callbackData: tentativeLaunchCallback, messageId: editPicker.messages?.[0]?.messageId || calendar.messages?.[0]?.messageId })
  const venueCallback = callbackStartingWith(launchEditor, `calendar:venue:${tentativeProject._id}:`)
  if (!venueCallback || !responseText(launchEditor).includes("Notes\nNo notes yet.")) throw new Error(`Tentative launch details did not include venue editing and notes. Response: ${responseText(launchEditor)}`)
  const venuePicker = await sendBotLabUpdate(config, { callbackData: venueCallback, messageId: launchEditor.messages?.[0]?.messageId || calendar.messages?.[0]?.messageId })
  const meteoraCallback = (venuePicker.messages || []).flatMap((message) => message.replyMarkup?.inline_keyboard || []).flat().find((button) => String(button.callback_data || "").includes(":meteora~"))?.callback_data
  if (!meteoraCallback || !responseText(venuePicker).includes("Choose the launch venue / DEX")) throw new Error(`Venue picker did not include Meteora. Response: ${responseText(venuePicker)}`)
  const venueUpdated = await sendBotLabUpdate(config, { callbackData: meteoraCallback, messageId: venuePicker.messages?.[0]?.messageId || calendar.messages?.[0]?.messageId })
  if (!responseText(venueUpdated).includes("Launch venue updated to Meteora DAMM v2")) throw new Error(`Venue update was not confirmed. Response: ${responseText(venueUpdated)}`)
  const venueUpdatedProject = await lookupTestProject(tentativeProjectName)
  if (venueUpdatedProject.launchVenue !== "meteora" || venueUpdatedProject.quoteToken !== "SOL") throw new Error(`Venue editing did not preserve the configured quote token: ${JSON.stringify(venueUpdatedProject)}`)
  const setTimeCallback = callbackStartingWith(venueUpdated, `lifecycle:settime:${tentativeProject._id}:`)
  if (!setTimeCallback) throw new Error(`Updated launch editor did not retain Set exact time. Response: ${responseText(venueUpdated)}`)
  const setTimePrompt = await sendBotLabUpdate(config, { callbackData: setTimeCallback, messageId: venueUpdated.messages?.[0]?.messageId || calendar.messages?.[0]?.messageId })
  if (!responseText(setTimePrompt).includes("Send the launch timing") || !responseText(setTimePrompt).includes("A time by itself applies to")) throw new Error(`Set-time action did not explain the contextual timing flow. Response: ${responseText(setTimePrompt)}`)
  const calendarDuringTiming = await sendBotLabUpdate(config, { text: "/calendar" })
  if (!responseText(calendarDuringTiming).includes("Today’s Launches —") || responseText(calendarDuringTiming).includes("could not read that timing")) throw new Error(`/calendar did not escape the pending timing prompt. Response: ${responseText(calendarDuringTiming)}`)
  const reopenPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(calendarDuringTiming, "calendar:edit:"), messageId: calendarDuringTiming.messages?.[0]?.messageId })
  const reopenLaunch = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(reopenPicker, `calendar:launch:${tentativeProject._id}:`), messageId: reopenPicker.messages?.[0]?.messageId })
  const reopenTime = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(reopenLaunch, `lifecycle:settime:${tentativeProject._id}:`), messageId: reopenLaunch.messages?.[0]?.messageId })
  if (!responseText(reopenTime).includes("Send the launch timing")) throw new Error(`Could not reopen the timing flow after /calendar. Response: ${responseText(reopenTime)}`)
  const exactTime = await sendBotLabUpdate(config, { text: "/time 6:20 PM ET" })
  if (!responseText(exactTime).includes("rescheduled") || !responseText(exactTime).includes("6:20 PM")) throw new Error(`Tentative launch did not accept an exact time. Response: ${responseText(exactTime)}`)
  const confirmedTentativeProject = await lookupTestProject(tentativeProjectName)
  if (confirmedTentativeProject.launchTimingStatus !== "confirmed" || !confirmedTentativeProject.launchAt || confirmedTentativeProject.tentativeLaunchDate) throw new Error(`Tentative launch was not converted cleanly to confirmed timing: ${JSON.stringify(confirmedTentativeProject)}`)

  const confirmedCalendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const confirmedPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(confirmedCalendar, "calendar:edit:"), messageId: confirmedCalendar.messages?.[0]?.messageId })
  const confirmedLaunch = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(confirmedPicker, `calendar:launch:${tentativeProject._id}:`), messageId: confirmedPicker.messages?.[0]?.messageId })
  const changeTimingCallback = callbackStartingWith(confirmedLaunch, `lifecycle:delay:${tentativeProject._id}:`)
  const changeTimingPrompt = await sendBotLabUpdate(config, { callbackData: changeTimingCallback, messageId: confirmedLaunch.messages?.[0]?.messageId })
  const makeTbdCallback = callbackStartingWith(changeTimingPrompt, `lifecycle:maketbd:${tentativeProject._id}:`)
  if (!makeTbdCallback || !responseText(changeTimingPrompt).includes("· TBD")) throw new Error(`Change-timing flow did not offer Set time to TBD. Response: ${responseText(changeTimingPrompt)}`)
  const madeTbd = await sendBotLabUpdate(config, { callbackData: makeTbdCallback, messageId: changeTimingPrompt.messages?.[0]?.messageId })
  if (!responseText(madeTbd).includes("is tentative") || !responseText(madeTbd).includes("Time TBD")) throw new Error(`Set time to TBD button did not update the launch. Response: ${responseText(madeTbd)}`)
  const buttonTbdProject = await lookupTestProject(tentativeProjectName)
  if (buttonTbdProject.launchAt || buttonTbdProject.launchTimingStatus !== "tentative" || buttonTbdProject.tentativeLaunchDate !== tentativeProject.tentativeLaunchDate) throw new Error(`Set time to TBD did not preserve the launch day: ${JSON.stringify(buttonTbdProject)}`)

  const tbdCalendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const tbdPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(tbdCalendar, "calendar:edit:"), messageId: tbdCalendar.messages?.[0]?.messageId })
  const tbdLaunch = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(tbdPicker, `calendar:launch:${tentativeProject._id}:`), messageId: tbdPicker.messages?.[0]?.messageId })
  const restoreTimePrompt = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(tbdLaunch, `lifecycle:settime:${tentativeProject._id}:`), messageId: tbdLaunch.messages?.[0]?.messageId })
  const restoredTime = await sendBotLabUpdate(config, { text: "6:25 PM ET" })
  if (!responseText(restoredTime).includes("rescheduled")) throw new Error(`Could not restore an exact time before testing natural-language TBD. Response: ${responseText(restoredTime)}`)
  const restoredCalendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const restoredPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(restoredCalendar, "calendar:edit:"), messageId: restoredCalendar.messages?.[0]?.messageId })
  const restoredLaunch = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(restoredPicker, `calendar:launch:${tentativeProject._id}:`), messageId: restoredPicker.messages?.[0]?.messageId })
  const naturalTbdPrompt = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(restoredLaunch, `lifecycle:delay:${tentativeProject._id}:`), messageId: restoredLaunch.messages?.[0]?.messageId })
  const naturalTbd = await sendBotLabUpdate(config, { text: "time TBD" })
  if (!responseText(naturalTbd).includes("is tentative") || !responseText(naturalTbd).includes("Time TBD")) throw new Error(`Natural-language TBD did not update the launch. Response: ${responseText(naturalTbd)}`)
  const naturalTbdProject = await lookupTestProject(tentativeProjectName)
  if (naturalTbdProject.launchAt || naturalTbdProject.launchTimingStatus !== "tentative" || naturalTbdProject.tentativeLaunchDate !== tentativeProject.tentativeLaunchDate) throw new Error(`Natural-language TBD did not preserve the launch day: ${JSON.stringify(naturalTbdProject)}`)

  const notesCalendar = await sendBotLabUpdate(config, { text: "/calendar" })
  const notesPicker = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(notesCalendar, "calendar:edit:"), messageId: notesCalendar.messages?.[0]?.messageId })
  const notesLaunch = await sendBotLabUpdate(config, { callbackData: callbackStartingWith(notesPicker, `calendar:launch:${tentativeProject._id}:`), messageId: notesPicker.messages?.[0]?.messageId })
  const addNoteCallback = callbackStartingWith(notesLaunch, `calendar:addnote:${tentativeProject._id}:`)
  if (!addNoteCallback) throw new Error(`Launch details did not expose Add note. Response: ${responseText(notesLaunch)}`)
  const notePrompt = await sendBotLabUpdate(config, { callbackData: addNoteCallback, messageId: notesLaunch.messages?.[0]?.messageId })
  if (!responseText(notePrompt).includes(`Send one note for ${tentativeProjectName}`)) throw new Error(`Add-note prompt was not shown in place. Response: ${responseText(notePrompt)}`)
  const noteAdded = await sendBotLabUpdate(config, { text: "Staircase chart; waiting on final team parameters." })
  if (!responseText(noteAdded).includes("Note added.") || !responseText(noteAdded).includes("• Staircase chart; waiting on final team parameters.")) throw new Error(`Launch note was not returned as an individual bullet. Response: ${responseText(noteAdded)}`)
  const naturalNote = await sendBotLabUpdate(config, { text: `/ai add a note to ${tentativeProjectName}: Client needs the final chart image.` })
  const naturalNoteConfirm = callbackStartingWith(naturalNote, "ai:confirm:")
  if (!naturalNoteConfirm || !responseText(naturalNote).includes("Action: Add project note")) throw new Error(`Natural-language note request was not proposed safely. Response: ${responseText(naturalNote)}`)
  const naturalNoteAdded = await sendBotLabUpdate(config, { callbackData: naturalNoteConfirm, messageId: naturalNote.messages?.[0]?.messageId })
  if (!responseText(naturalNoteAdded).includes(`Note added: ${tentativeProjectName}`)) throw new Error(`Natural-language note was not saved after confirmation. Response: ${responseText(naturalNoteAdded)}`)
  const noteQuestion = await sendBotLabUpdate(config, { text: `/ai show notes for ${tentativeProjectName}` })
  for (const expectedNote of ["• Client needs the final chart image.", "• Staircase chart; waiting on final team parameters."]) {
    if (!responseText(noteQuestion).includes(expectedNote)) throw new Error(`Natural-language note lookup is missing ${expectedNote}. Response: ${responseText(noteQuestion)}`)
  }

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

  const v4Draft = await sendBotLabUpdate(config, { text: `/schedulelaunch V4Choice${suffix} on Robinhood Uniswap V4 with ETH quote, launch tomorrow at noon - senzu plugin - no referrer` })
  const v4DraftText = responseText(v4Draft)
  for (const expected of ["Launchpad / DEX: <b>Uniswap V4</b>", "Chain: <b>Robinhood Chain</b>", "Quote token: <b>ETH</b>"]) {
    if (!v4DraftText.includes(expected)) throw new Error(`Uniswap V4 launch setup is missing ${expected}. Response: ${v4DraftText}`)
  }
  const cancelV4Draft = callbackStartingWith(v4Draft, "launchsetup:cancel:")
  if (cancelV4Draft) await sendBotLabUpdate(config, { callbackData: cancelV4Draft, messageId: v4Draft.messages?.[0]?.messageId })

  const parsedNameDraft = await sendBotLabUpdate(config, { text: `/schedulelaunch add ${parsedProjectName} launch today 4pm et on pumpfun, sol - sumo - no referrer` })
  const parsedNameText = responseText(parsedNameDraft)
  if (!parsedNameText.includes(`Project name: <b>${parsedProjectName}</b>`) || parsedNameText.includes(`Project name: <b>Add ${parsedProjectName} Launch`)) {
    throw new Error(`Natural-language launch name was not isolated correctly. Response: ${parsedNameText}`)
  }
  const cancelParsedDraft = callbackStartingWith(parsedNameDraft, "launchsetup:cancel:")
  if (cancelParsedDraft) await sendBotLabUpdate(config, { callbackData: cancelParsedDraft, messageId: parsedNameDraft.messages?.[0]?.messageId })

  const wizardStart = await sendBotLabUpdate(config, { text: "/addlaunch" })
  if (!responseText(wizardStart).includes("exact project name")) throw new Error(`The /addlaunch wizard did not request a name. Response: ${responseText(wizardStart)}`)
  const wizardTiming = await sendBotLabUpdate(config, { text: wizardProjectName })
  if (!responseText(wizardTiming).includes(`When is ${wizardProjectName} launching?`)) throw new Error(`The /addlaunch wizard did not request timing. Response: ${responseText(wizardTiming)}`)
  const wizardChain = await sendBotLabUpdate(config, { text: "today at 4:40 PM ET" })
  const wizardSolChain = callbackMatching(wizardChain, "launchsetup:setchain:", ":sol")
  if (!wizardSolChain || !responseText(wizardChain).includes("Choose the chain")) throw new Error(`The /addlaunch wizard did not request a chain. Response: ${responseText(wizardChain)}`)
  const wizardVenue = await sendBotLabUpdate(config, { callbackData: wizardSolChain, messageId: wizardChain.messages?.[0]?.messageId })
  const wizardPumpfun = callbackMatching(wizardVenue, "launchsetup:setvenue:", ":pumpfun")
  if (!wizardPumpfun || !responseText(wizardVenue).includes("Choose the launchpad / DEX")) throw new Error(`The /addlaunch wizard did not request a venue. Response: ${responseText(wizardVenue)}`)
  const wizardQuote = await sendBotLabUpdate(config, { callbackData: wizardPumpfun, messageId: wizardVenue.messages?.[0]?.messageId })
  const wizardSolQuote = callbackMatching(wizardQuote, "launchsetup:setquote:", ":SOL")
  if (!wizardSolQuote || !responseText(wizardQuote).includes("Choose the quote token")) throw new Error(`The /addlaunch wizard did not request a quote token. Response: ${responseText(wizardQuote)}`)
  const wizardMethod = await sendBotLabUpdate(config, { callbackData: wizardSolQuote, messageId: wizardQuote.messages?.[0]?.messageId })
  const wizardSumo = callbackMatching(wizardMethod, "launchsetup:setmethod:", ":sumo")
  if (!wizardSumo || !responseText(wizardMethod).includes("Choose the launch method")) throw new Error(`The /addlaunch wizard did not request a method. Response: ${responseText(wizardMethod)}`)
  const wizardReferrer = await sendBotLabUpdate(config, { callbackData: wizardSumo, messageId: wizardMethod.messages?.[0]?.messageId })
  const wizardNoReferrer = callbackStartingWith(wizardReferrer, "launchsetup:noref:")
  if (!wizardNoReferrer || !responseText(wizardReferrer).includes("have a referrer")) throw new Error(`The /addlaunch wizard did not request a referrer decision. Response: ${responseText(wizardReferrer)}`)
  const wizardReview = await sendBotLabUpdate(config, { callbackData: wizardNoReferrer, messageId: wizardReferrer.messages?.[0]?.messageId })
  const wizardCreate = callbackStartingWith(wizardReview, "launchsetup:create:")
  if (!wizardCreate || !responseText(wizardReview).includes("Everything is ready")) throw new Error(`The /addlaunch wizard did not reach final review. Response: ${responseText(wizardReview)}`)
  const wizardCreated = await sendBotLabUpdate(config, { callbackData: wizardCreate, messageId: wizardReview.messages?.[0]?.messageId })
  if (!responseText(wizardCreated).includes(`Launch scheduled successfully: ${wizardProjectName}`)) throw new Error(`The /addlaunch wizard did not create its launch. Response: ${responseText(wizardCreated)}`)
  const wizardProject = await lookupTestProject(wizardProjectName)
  if (!wizardProject || wizardProject.launchVenue !== "pumpfun" || wizardProject.chain !== "solana" || wizardProject.quoteToken !== "SOL" || wizardProject.launchMethod !== "sumo" || wizardProject.referrerStatus !== "none") {
    throw new Error(`The /addlaunch wizard stored incorrect fields: ${JSON.stringify(wizardProject)}`)
  }

  const customDraft = await sendBotLabUpdate(config, { text: `/schedulelaunch ${customQuoteProjectName} on Pons V2 Robinhood with custom quote token AAPL, CA ${aaplAddress}, launch today at 1 PM ET - other MM plugin - no referrer` })
  const customDraftText = responseText(customDraft)
  for (const expected of [
    `Project name: <b>${customQuoteProjectName}</b>`,
    "Launchpad / DEX: <b>Pons V2</b>",
    "Chain: <b>Robinhood Chain</b>",
    "Quote token: <b>AAPL</b>",
    `Quote token CA: <code>${aaplAddress}</code>`,
    "Everything is ready",
  ]) {
    if (!customDraftText.includes(expected)) throw new Error(`Custom-quote launch review is missing ${expected}. Response: ${customDraftText}`)
  }
  const createCustomCallback = callbackStartingWith(customDraft, "launchsetup:create:")
  if (!createCustomCallback) throw new Error(`Custom-quote launch was not ready to create. Response: ${customDraftText}`)
  const customCreated = await sendBotLabUpdate(config, { callbackData: createCustomCallback, messageId: customDraft.messages?.[0]?.messageId })
  if (!responseText(customCreated).includes(`Launch scheduled successfully: ${customQuoteProjectName}`)) throw new Error(`Custom-quote launch was not created. Response: ${responseText(customCreated)}`)
  const customProject = await lookupTestProject(customQuoteProjectName)
  if (!customProject) throw new Error("The custom-quote launch was not stored.")
  if (customProject.launchVenue !== "pons" || customProject.chain !== "robinhood" || customProject.quoteToken !== "AAPL" || customProject.quoteTokenAddress !== aaplAddress || customProject.quoteTokenDecimals !== 18) {
    throw new Error(`Custom-quote fields were not stored correctly: ${JSON.stringify(customProject)}`)
  }

  console.log(text)
  console.log(tentativeCreatedText)
  console.log("\nPASS: launch setup handles the /addlaunch wizard, clean natural-language names, time-only and TBD edits, command escape from pending prompts, tentative launches, notes, custom contract quote tokens, Uniswap V4, venue edits, and the compact /calendar flow.")
} finally {
  const deleted = await cleanup().catch((error) => {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`)
    return 0
  })
  console.log(`Cleanup: removed ${deleted} test records.`)
  stopBotLabServer(server)
}
