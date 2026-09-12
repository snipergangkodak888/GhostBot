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
const receiptIds = [`codex-fee-receipt-a-${telegramId}`, `codex-fee-receipt-b-${telegramId}`]
let server

function credentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service credentials are required for the Fee Inbox workflow test.")
  if (new URL(url).hostname !== "ozkaxwdrbvsimmrrjaox.supabase.co") throw new Error("Fee workflow test is restricted to the configured test database, never production.")
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
  const rows = await documents(["revenueFeeEvents", "revenueReceipts", "opsProjects", "opsChatProfiles", "opsHostedGroups", "guardMembers", "guardChatMembers", "opsBotLogs", "opsBotStates"])
  const ids = rows.filter((row) => {
    if ([memberId, membershipId, profileId, projectId, feeId, ...receiptIds].includes(row.id)) return true
    if (String(row.data?.telegram?.chatId || "") === telegramChatId) return true
    if (row.collection === "opsHostedGroups" && row.data?.chatId === telegramChatId) return true
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
  assert.match(responseText(assigned), /Confirm these fee details/)
  assert.match(responseText(assigned), /Expected USD:.*\$1,000/s)

  const confirmed = await sendBotLabUpdate(config, { callbackData: `fee:confirm:${feeId}`, messageId })
  assertEditedOnly(confirmed, messageId, "Confirming the fee expectation")
  assert.match(responseText(confirmed), /Waiting for a matching receipt or batch/)
  assert.match(buttonText(confirmed), /Search receipts/)

  const rows = await documents(["revenueFeeEvents"])
  const fee = rows.find((row) => row.id === feeId)?.data
  assert.equal(fee?.status, "awaiting_receipt")
  assert.equal(fee?.projectId, projectId)
  assert.equal(fee?.feeType, "launch")
  assert.equal(fee?.quoteAsset, "SOL")

  // Replay the reported sequence: receipts first, cashout forward later, then
  // project search, repeat forward, and a single two-receipt proposal.
  for (let i = 0; i < receiptIds.length; i += 1) {
    const value = [213.497478, 210.375758][i]
    await upsertDocument("revenueReceipts", receiptIds[i], {
      date: "2026-09-12", chain: "solana", walletRole: "revenue", direction: "incoming", asset: "USDC",
      tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: value, amountUsd: value,
      status: "unclassified", allocations: [], transactionHash: `lab-signature-${i}`, eventKey: `lab-${receiptIds[i]}`,
      blockTime: `2026-09-12T15:${i ? "51:22" : "50:52"}.000Z`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
  }
  const forwardInput = {
    text: "Cashout Summary:\nA total of 8,502 USDC was withdrawn from the MM balance.\n8,000 USDC was sent here via Husher.\n502 USDC was taken for the 5% liquidation + privacy swap fee.",
    forwardOrigin: { type: "hidden_user", sender_user_name: "Bands test", date: Math.floor(new Date("2026-09-12T15:51:31Z").getTime() / 1000) },
  }
  const forwarded = await sendBotLabUpdate(config, { ...forwardInput, messageId: 820 })
  const sourceRows = await documents(["revenueFeeEvents"])
  const forwardedFee = sourceRows.find((row) => row.data?.telegram?.messageId === 820 && row.data?.telegram?.chatId === telegramChatId)
  assert.ok(forwardedFee, responseText(forwarded))
  const forwardedId = forwardedFee.id
  await sendBotLabUpdate(config, { callbackData: `fee:search:${forwardedId}`, messageId: 821 })
  const wrongAsset = await sendBotLabUpdate(config, { text: "Fee Flow Project", messageId: 822 })
  assert.match(responseText(wrongAsset), /is active, but accepts SOL revenue, not USDC/)
  const projectRows = await documents(["opsProjects"])
  await upsertDocument("opsProjects", projectId, { ...projectRows.find((row) => row.id === projectId).data, acceptedRevenueAssets: ["SOL", "USDC"] })
  const retriedForward = await sendBotLabUpdate(config, { ...forwardInput, messageId: 823 })
  assert.match(responseText(retriedForward), /already recorded/)
  assert.match(buttonText(retriedForward), /Fee Flow Project/)
  const selectedProject = await sendBotLabUpdate(config, { callbackData: `fee:project:${forwardedId}:${projectId}`, messageId: 824 })
  assert.match(responseText(selectedProject), /425.1 USDC/)
  const proposed = await sendBotLabUpdate(config, { callbackData: `fee:confirm:${forwardedId}`, messageId: 824 })
  assertEditedOnly(proposed, 824, "Proposing the receipt batch")
  assert.match(responseText(proposed), /423.873236 USDC/)
  assert.match(responseText(proposed), /1.226764 USDC/)
  assert.match(responseText(proposed), /30 seconds/)
  assert.match(buttonText(proposed), /Accept 2 receipts as one fee/)
  const repeatedProposal = await sendBotLabUpdate(config, { ...forwardInput, messageId: 825 })
  assert.match(buttonText(repeatedProposal), /Accept 2 receipts as one fee/)
  const accepted = await sendBotLabUpdate(config, { callbackData: `fee:match:${forwardedId}`, messageId: 824 })
  assert.match(responseText(accepted), /Fee verified and ready for payroll/)
  const repeatedAccepted = await sendBotLabUpdate(config, { ...forwardInput, messageId: 826 })
  assert.match(responseText(repeatedAccepted), /Status:.*confirmed/)
  assert.doesNotMatch(buttonText(repeatedAccepted), /Confirm expectation|Accept .*receipts|Choose/)
  const finalRows = await documents(["revenueFeeEvents", "revenueReceipts"])
  assert.equal(finalRows.filter((row) => row.data?.telegram?.chatId === telegramChatId).length, 1)
  assert.equal(finalRows.find((row) => row.id === forwardedId)?.data.matchedReceiptIds.length, 2)
  assert.ok(finalRows.filter((row) => receiptIds.includes(row.id)).every((row) => row.data.status === "allocated" && row.data.allocations.length === 1))

  console.log("PASS: Fee Inbox card editing, honest project-search errors, multi-asset project selection, repeated forwards, and two-receipt batch acceptance. All Telegram calls were captured, not sent.")
} finally {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`))
  stopBotLabServer(server)
}
