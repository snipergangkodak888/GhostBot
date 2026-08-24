import { getDb } from "@/lib/db"
import { getSubscribedChats } from "@/lib/chat-subscriptions"
import { getTelegramBotToken, telegramApi } from "@/lib/telegram-bot"
import { CHAIN_LABELS, projectFeeConfig } from "@/lib/revenue-projects"
import type { RevenueFeeEvent, RevenueReceipt } from "@/lib/revenue-types"
import { revenueTransactionUrl } from "@/lib/revenue-explorer"

function escapeHtml(value: unknown) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function amount(value: unknown, asset: unknown) {
  return `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${String(asset || "")}`.trim()
}

function usd(value: unknown) {
  return value == null ? "Awaiting valuation" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

function feeInboxChats(subscribed: Array<{ chatId: string | number; kind?: string; label?: string }>) {
  const chats = [...subscribed]
  const configured = String(process.env.FEE_INBOX_CHAT_ID || "").trim()
  if (configured && !chats.some((chat) => String(chat.chatId) === configured)) chats.push({ chatId: configured, kind: configured.startsWith("-") ? "group" : "direct", label: "Fee Inbox" })
  return chats
}

export function receiptClassificationButtons(receiptId: string, transactionUrl?: string | null) {
  return [
    [{ text: "🏷 Classify revenue", callback_data: `receipt:classify:${receiptId}` }, { text: "↔️ Internal", callback_data: `fee:internal:${receiptId}` }],
    [{ text: "Ignore", callback_data: `fee:ignore:${receiptId}` }, ...(transactionUrl ? [{ text: "↗️ Transaction", url: transactionUrl }] : [])],
  ]
}

export function formatConsolidationCandidate(batch: any) {
  const receipts = Array.isArray(batch?.receipts) ? batch.receipts : []
  const sourceCount = (batch?.sourceReceiptIds || []).length
  const destinationCount = (batch?.destinationReceiptIds || []).length
  const swapCount = new Set(receipts.filter((receipt: any) => (batch?.swapReceiptIds || []).includes(String(receipt._id))).map((receipt: any) => receipt.transactionHash)).size
  return [
    "<b>Possible internal consolidation</b>",
    "",
    `Source movements: <b>${sourceCount}</b> · ${usd(batch?.sourceUsd || 0)}`,
    `Solana USDC arrivals: <b>${destinationCount}</b> · ${usd(batch?.destinationUsd || 0)}`,
    swapCount ? `Same-transaction swaps: <b>${swapCount}</b>` : "",
    batch?.estimatedCostUsd == null ? "Estimated bridge/swap cost: <b>waiting for both sides</b>" : `Estimated bridge/swap cost: <b>${usd(batch.estimatedCostUsd)}</b>`,
    `Confidence: <b>${escapeHtml(String(batch?.confidence || "low"))}</b>`,
    "",
    "Wait until the swaps finish, then review once. Nothing is counted as new revenue or moved automatically.",
  ].filter(Boolean).join("\n")
}

export async function isFeeInboxChat(chatId: number | string) {
  const configured = String(process.env.FEE_INBOX_CHAT_ID || "").trim()
  if (configured && configured === String(chatId)) return true
  const db = await getDb()
  return Boolean(await db.collection("opsChatSubscriptions").findOne({ chatId: String(chatId), purpose: "fees", status: "active" }))
}

export async function feeProjectButtons(feeId: string, limit = 8) {
  const db = await getDb()
  const [fee, projects] = await Promise.all([
    db.collection("revenueFeeEvents").findOne({ _id: feeId }),
    db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ updatedAt: -1 }).toArray(),
  ])
  const explicitAsset = String(fee?.grossAsset || fee?.quoteAsset || "").toUpperCase()
  const configured = projects.filter((project: any) => {
    const config = projectFeeConfig(project)
    return config.chain && (!explicitAsset || explicitAsset === "USD" || config.quoteAssets.includes(explicitAsset))
  }).slice(0, limit)
  const rows = configured.map((project: any) => [{
    text: `${project.name} · ${CHAIN_LABELS[projectFeeConfig(project).chain as keyof typeof CHAIN_LABELS]}`.slice(0, 60),
    callback_data: `fee:project:${feeId}:${project._id}`,
  }])
  rows.push([{ text: "🔎 Search projects", callback_data: `fee:search:${feeId}` }])
  return rows
}

export function formatFeeExpectation(fee: RevenueFeeEvent) {
  const lines = [
    `<b>${fee.projectName ? `${escapeHtml(fee.projectName)} · ` : ""}${escapeHtml(String(fee.feeType || "Unclassified").replace(/_/g, " "))}</b>`,
    fee.chain ? `Chain: <b>${escapeHtml(CHAIN_LABELS[fee.chain])}</b>` : "",
    fee.grossAmount != null ? `Gross cashout: <b>${amount(fee.grossAmount, fee.grossAsset)}</b>` : "",
    fee.liquidationPercentage != null ? `Rule: <b>${fee.liquidationPercentage}% of gross cashout</b>` : "",
    fee.expectedAssetAmount != null ? `Expected fee: <b>${amount(fee.expectedAssetAmount, fee.quoteAsset || fee.grossAsset)}</b>` : "",
    fee.expectedUsd != null ? `Expected USD: <b>${usd(fee.expectedUsd)}</b>` : "",
    fee.parse?.ignoredSupplyPercentage != null ? `Supply allocation: <b>ignored</b>` : "",
    fee.parse?.warnings?.length ? `Needs review: ${escapeHtml(fee.parse.warnings.join("; "))}` : "",
  ].filter(Boolean)
  return lines.join("\n")
}

export async function notifyFeeInboxReceipt(receipt: RevenueReceipt) {
  const [token, subscribed] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  const chats = feeInboxChats(subscribed)
  if (!token || !chats.length) return { sent: 0 }
  const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
  const text = [
    `<b>New revenue-wallet ${receipt.direction === "incoming" ? "receipt" : "movement"}</b>`,
    "",
    `Chain: <b>${escapeHtml(CHAIN_LABELS[receipt.chain])}</b>`,
    `Amount: <b>${escapeHtml(amount(receipt.amount, receipt.asset))}</b>`,
    `Direction: <b>${escapeHtml(receipt.direction)}</b>`,
    `USD value: <b>${escapeHtml(usd(receipt.amountUsd))}</b>`,
    transactionUrl ? `Transaction: <a href="${escapeHtml(transactionUrl)}">${escapeHtml(receipt.transactionHash.slice(0, 16))}…</a>` : `Transaction: <code>${escapeHtml(receipt.transactionHash.slice(0, 16))}…</code>`,
    "",
    "This receipt is unclassified until it is matched or reviewed.",
  ].join("\n")
  let sent = 0
  for (const chat of chats) {
    const response = await telegramApi(token, "sendMessage", {
      chat_id: chat.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: receiptClassificationButtons(String(receipt._id || ""), transactionUrl),
      },
    }).catch(() => null)
    if (response) sent += 1
  }
  return { sent }
}

export async function notifyConsolidationCandidate(batch: any) {
  const [token, subscribed] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  const chats = feeInboxChats(subscribed)
  if (!token || !chats.length || !batch?._id) return { sent: 0 }
  let sent = 0
  for (const chat of chats) {
    const response = await telegramApi(token, "sendMessage", {
      chat_id: chat.chatId,
      text: formatConsolidationCandidate(batch),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "🔎 Review batch", callback_data: `consol:view:${batch._id}` }]] },
    }).catch(() => null)
    if (response) sent += 1
  }
  return { sent }
}

export async function notifyFeeInboxTreasuryReceipt(receipt: RevenueReceipt, reconciliation?: { matched?: boolean } | null) {
  const [token, subscribed] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  const chats = feeInboxChats(subscribed)
  if (!token || !chats.length) return { sent: 0 }
  const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
  const text = [
    "<b>Treasury consolidation received</b>",
    "",
    `Amount: <b>${escapeHtml(amount(receipt.amount, receipt.asset))}</b>`,
    `Chain: <b>${escapeHtml(CHAIN_LABELS[receipt.chain])}</b>`,
    `Revenue-wallet send matched: <b>${reconciliation?.matched ? "yes" : "waiting"}</b>`,
    transactionUrl ? `Transaction: <a href="${escapeHtml(transactionUrl)}">${escapeHtml(receipt.transactionHash.slice(0, 16))}…</a>` : `Transaction: <code>${escapeHtml(receipt.transactionHash.slice(0, 16))}…</code>`,
    "",
    "This is an internal arrival, not new client revenue. No funds were moved by the bot.",
  ].join("\n")
  let sent = 0
  for (const chat of chats) {
    const response = await telegramApi(token, "sendMessage", { chat_id: chat.chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(transactionUrl ? { reply_markup: { inline_keyboard: [[{ text: "↗️ View transaction", url: transactionUrl }]] } } : {}) }).catch(() => null)
    if (response) sent += 1
  }
  return { sent }
}
