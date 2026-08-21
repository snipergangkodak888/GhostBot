import { getDb } from "@/lib/db"
import { getSubscribedChats } from "@/lib/chat-subscriptions"
import { getTelegramBotToken, telegramApi } from "@/lib/telegram-bot"
import { CHAIN_LABELS, projectFeeConfig } from "@/lib/revenue-projects"
import type { RevenueFeeEvent, RevenueReceipt } from "@/lib/revenue-types"

function escapeHtml(value: unknown) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function amount(value: unknown, asset: unknown) {
  return `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${String(asset || "")}`.trim()
}

function usd(value: unknown) {
  return value == null ? "Awaiting valuation" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

export async function isFeeInboxChat(chatId: number | string) {
  const configured = String(process.env.FEE_INBOX_CHAT_ID || "").trim()
  if (configured && configured === String(chatId)) return true
  const db = await getDb()
  return Boolean(await db.collection("opsChatSubscriptions").findOne({ chatId: String(chatId), purpose: "fees", status: "active" }))
}

export async function feeProjectButtons(feeId: string, limit = 8) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ updatedAt: -1 }).toArray()
  const configured = projects.filter((project: any) => projectFeeConfig(project).chain).slice(0, limit)
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
  const chats = [...subscribed]
  const configured = String(process.env.FEE_INBOX_CHAT_ID || "").trim()
  if (configured && !chats.some((chat) => String(chat.chatId) === configured)) chats.push({ chatId: configured, kind: configured.startsWith("-") ? "group" : "direct", label: "Fee Inbox" })
  if (!token || !chats.length) return { sent: 0 }
  const text = [
    `<b>New revenue-wallet ${receipt.direction === "incoming" ? "receipt" : "movement"}</b>`,
    "",
    `Chain: <b>${escapeHtml(CHAIN_LABELS[receipt.chain])}</b>`,
    `Amount: <b>${escapeHtml(amount(receipt.amount, receipt.asset))}</b>`,
    `Direction: <b>${escapeHtml(receipt.direction)}</b>`,
    `USD value: <b>${escapeHtml(usd(receipt.amountUsd))}</b>`,
    `Transaction: <code>${escapeHtml(receipt.transactionHash.slice(0, 16))}…</code>`,
    "",
    "This receipt is unclassified until it is matched or reviewed.",
  ].join("\n")
  let sent = 0
  for (const chat of chats) {
    const response = await telegramApi(token, "sendMessage", {
      chat_id: chat.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔎 Review", callback_data: `fee:receipt:${receipt._id}` }],
          [{ text: "↔️ Internal transfer", callback_data: `fee:internal:${receipt._id}` }, { text: "Ignore", callback_data: `fee:ignore:${receipt._id}` }],
        ],
      },
    }).catch(() => null)
    if (response) sent += 1
  }
  return { sent }
}

export async function notifyFeeInboxTreasuryReceipt(receipt: RevenueReceipt, reconciliation?: { matched?: boolean } | null) {
  const [token, subscribed] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  const chats = [...subscribed]
  const configured = String(process.env.FEE_INBOX_CHAT_ID || "").trim()
  if (configured && !chats.some((chat) => String(chat.chatId) === configured)) chats.push({ chatId: configured, kind: configured.startsWith("-") ? "group" : "direct", label: "Fee Inbox" })
  if (!token || !chats.length) return { sent: 0 }
  const text = [
    "<b>Treasury consolidation received</b>",
    "",
    `Amount: <b>${escapeHtml(amount(receipt.amount, receipt.asset))}</b>`,
    `Chain: <b>${escapeHtml(CHAIN_LABELS[receipt.chain])}</b>`,
    `Revenue-wallet send matched: <b>${reconciliation?.matched ? "yes" : "waiting"}</b>`,
    `Transaction: <code>${escapeHtml(receipt.transactionHash.slice(0, 16))}…</code>`,
    "",
    "This is an internal arrival, not new client revenue. No funds were moved by the bot.",
  ].join("\n")
  let sent = 0
  for (const chat of chats) {
    const response = await telegramApi(token, "sendMessage", { chat_id: chat.chatId, text, parse_mode: "HTML" }).catch(() => null)
    if (response) sent += 1
  }
  return { sent }
}
