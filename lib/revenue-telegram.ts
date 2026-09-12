import { getDb } from "@/lib/db"
import { getSubscribedChats } from "@/lib/chat-subscriptions"
import { getTelegramBotToken, telegramApi } from "@/lib/telegram-bot"
import { CHAIN_LABELS, projectFeeConfig, searchFeeProjects } from "@/lib/revenue-projects"
import type { RevenueChain, RevenueFeeEvent, RevenueReceipt } from "@/lib/revenue-types"
import { revenueTransactionUrl } from "@/lib/revenue-explorer"
import { receiptMatchPreview } from "@/lib/revenue-match-preview"

export function escapeHtml(value: unknown) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function amount(value: unknown, asset: unknown) {
  return `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${String(asset || "")}`.trim()
}

function usd(value: unknown) {
  return value == null ? "Awaiting valuation" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

const CHAIN_COLOR_MARKERS: Record<RevenueChain, string> = {
  bnb: "🟡",
  ethereum: "🔵",
  base: "🔵",
  solana: "🟣",
  robinhood: "🟢",
}

export function revenueChainLabel(chain: RevenueChain) {
  return `${CHAIN_COLOR_MARKERS[chain]} ${CHAIN_LABELS[chain]}`
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
  const db = await getDb()
  return Boolean(await db.collection("opsChatProfiles").findOne({ chatId: String(chatId), profile: "fee", status: "active" }))
}

export async function feeProjectButtons(feeId: string, limit = 8) {
  const db = await getDb()
  const [fee, projects] = await Promise.all([
    db.collection("revenueFeeEvents").findOne({ _id: feeId }),
    db.collection("opsProjects").find({ status: { $ne: "inactive" } }).sort({ updatedAt: -1 }).toArray(),
  ])
  const configured = searchFeeProjects(projects, fee, "").matches.slice(0, limit)
  const rows = configured.map((project: any) => [{
    text: `${project.name} · ${revenueChainLabel(projectFeeConfig(project).chain as RevenueChain)}`.slice(0, 60),
    callback_data: `fee:project:${feeId}:${project._id}`,
  }])
  rows.push([{ text: "🔎 Search projects", callback_data: `fee:search:${feeId}` }])
  return rows
}

export function formatFeeExpectation(fee: RevenueFeeEvent) {
  const lines = [
    `<b>${fee.projectName ? `${escapeHtml(fee.projectName)} · ` : ""}${escapeHtml(String(fee.feeType || "Unclassified").replace(/_/g, " "))}</b>`,
    fee.chain ? `Chain: <b>${escapeHtml(revenueChainLabel(fee.chain))}</b>` : "",
    fee.grossAmount != null ? `Gross cashout: <b>${amount(fee.grossAmount, fee.grossAsset)}</b>` : "",
    fee.liquidationPercentage != null ? `Rule: <b>${fee.liquidationPercentage}% of gross cashout</b>` : "",
    fee.expectedAssetAmount != null ? `Expected fee: <b>${amount(fee.expectedAssetAmount, fee.quoteAsset || fee.grossAsset)}</b>` : "",
    fee.expectedUsd != null ? `Expected USD: <b>${usd(fee.expectedUsd)}</b>` : "",
    fee.parse?.ignoredSupplyPercentage != null ? `Supply allocation: <b>ignored</b>` : "",
    fee.parse?.warnings?.length ? `Needs review: ${escapeHtml(fee.parse.warnings.join("; "))}` : "",
  ].filter(Boolean)
  return lines.join("\n")
}

/** Shared by new forwards, repeated forwards, and callbacks so stale buttons cannot restart a completed fee. */
export async function feeWorkflowView(fee: RevenueFeeEvent) {
  const id = String(fee._id)
  const db = await getDb()
  const text = formatFeeExpectation(fee)
  if (["confirmed", "ignored", "waived"].includes(fee.status)) return { text: `${text}\n\nStatus: <b>${escapeHtml(fee.status)}</b>. No new fee was created.`, buttons: [] }
  if (fee.status === "match_proposed") {
    const receipts = await db.collection("revenueReceipts").find({ _id: { $in: fee.proposedReceiptIds || [] } }).toArray() as RevenueReceipt[]
    const preview = receiptMatchPreview(fee, receipts)
    const lines = preview.rows.slice(0, 12).map((row) => {
      const url = revenueTransactionUrl(row.chain, row.transactionHash)
      const label = `${amount(row.amount, row.asset)} · ${row.transactionHash.slice(0, 10)}…`
      return url ? `• <a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : `• ${escapeHtml(label)}`
    })
    if (preview.rows.length > 12) lines.push(`…plus ${preview.rows.length - 12} more; review all transactions in Revenue Inbox.`)
    lines.push(`Combined available: <b>${preview.total == null ? "needs review" : amount(preview.total, preview.asset)}</b>`)
    if (preview.difference != null) lines.push(`${preview.difference < 0 ? "Shortfall" : "Excess"}: <b>${amount(Math.abs(preview.difference), preview.asset)}</b>`)
    if (preview.rows.length > 1) lines.push(`Received over ${preview.spanSeconds < 60 ? `${preview.spanSeconds} seconds` : `${Math.round(preview.spanSeconds / 60)} minutes`}.`)
    lines.push("Amounts and timing suggest a match; they do not prove which project sent it. Review before accepting.")
    const buttons = preview.missingReceipts ? [] : [[{ text: `✅ Accept ${preview.rows.length} receipt${preview.rows.length === 1 ? "" : "s"} as one fee`, callback_data: `fee:match:${id}` }]]
    buttons.push([{ text: "🔄 Search receipts again", callback_data: `fee:receipts:${id}` }])
    return { text: `${text}\n\n<b>Suggested receipt batch</b>\n${lines.join("\n")}`, buttons }
  }
  if (["awaiting_receipt", "missing"].includes(fee.status)) return { text: `${text}\n\nWaiting for a matching receipt or batch. Receipts can arrive before or after this message.`, buttons: [[{ text: "🔄 Search receipts", callback_data: `fee:receipts:${id}` }]] }
  if (fee.status === "awaiting_asset") {
    const project = await db.collection("opsProjects").findOne({ _id: fee.projectId })
    return { text: `${text}\n\nWhich asset was received?`, buttons: projectFeeConfig(project).acceptedRevenueAssets.map((asset) => [{ text: asset, callback_data: `fee:asset:${id}:${asset}` }]) }
  }
  if (fee.status === "awaiting_confirmation") return { text: `${text}\n\nConfirm these fee details to search wallet receipts.`, buttons: [[{ text: "✅ Confirm expectation", callback_data: `fee:confirm:${id}` }]] }
  if (!fee.feeType) return { text: `${text}\n\nChoose the fee type:`, buttons: [
    [{ text: "Liquidation", callback_data: `fee:type:${id}:liquidation` }],
    [{ text: "Daily trading", callback_data: `fee:type:${id}:daily_trading` }, { text: "Launch / TGE cash", callback_data: `fee:type:${id}:launch` }],
    [{ text: "Dev allocation", callback_data: `fee:type:${id}:dev_allocation` }],
  ] }
  return { text: `${text}\n\nChoose the existing project:`, buttons: await feeProjectButtons(id) }
}

export async function notifyFeeInboxReceipt(receipt: RevenueReceipt) {
  const [token, chats] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  if (!token || !chats.length) return { sent: 0 }
  const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
  const text = [
    `<b>New revenue-wallet ${receipt.direction === "incoming" ? "receipt" : "movement"}</b>`,
    "",
    `Chain: <b>${escapeHtml(revenueChainLabel(receipt.chain))}</b>`,
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
  const [token, chats] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
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
  const [token, chats] = await Promise.all([getTelegramBotToken(), getSubscribedChats("fees")])
  if (!token || !chats.length) return { sent: 0 }
  const transactionUrl = revenueTransactionUrl(receipt.chain, receipt.transactionHash)
  const text = [
    "<b>Treasury consolidation received</b>",
    "",
    `Amount: <b>${escapeHtml(amount(receipt.amount, receipt.asset))}</b>`,
    `Chain: <b>${escapeHtml(revenueChainLabel(receipt.chain))}</b>`,
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
