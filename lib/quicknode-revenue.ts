import { createHmac, timingSafeEqual } from "node:crypto"
import type { RevenueChain, RevenueReceipt } from "@/lib/revenue-types"
import { REVENUE_CHAINS } from "@/lib/revenue-types"

type ReceiptInput = Omit<RevenueReceipt, "_id" | "createdAt" | "updatedAt">

const EVM_REVENUE_WALLET = String(process.env.REVENUE_EVM_WALLET || "").trim().toLowerCase()
const SOLANA_REVENUE_WALLET = String(process.env.REVENUE_SOLANA_WALLET || "").trim()

function safeEqualHex(left: string, right: string) {
  try {
    const a = Buffer.from(left.replace(/^sha256=/i, ""), "hex")
    const b = Buffer.from(right.replace(/^sha256=/i, ""), "hex")
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function verifyQuickNodeSignature(params: {
  body: string
  nonce?: string | null
  timestamp?: string | null
  signature?: string | null
  secret?: string | null
  now?: number
}) {
  const secret = String(params.secret || "")
  const nonce = String(params.nonce || "")
  const timestamp = String(params.timestamp || "")
  const signature = String(params.signature || "")
  if (!secret || !nonce || !timestamp || !signature) return { ok: false as const, error: "Missing webhook signature configuration or headers" }
  const timestampMs = Number(timestamp) * (String(timestamp).length <= 10 ? 1_000 : 1)
  if (!Number.isFinite(timestampMs)) return { ok: false as const, error: "Invalid webhook timestamp" }
  const now = params.now ?? Date.now()
  if (Math.abs(now - timestampMs) > 10 * 60 * 1_000) return { ok: false as const, error: "Webhook timestamp is outside the replay window" }
  const expected = createHmac("sha256", Buffer.from(secret)).update(Buffer.from(`${nonce}${timestamp}${params.body}`)).digest("hex")
  return safeEqualHex(expected, signature) ? { ok: true as const } : { ok: false as const, error: "Invalid webhook signature" }
}

export function cleanWebhookChain(value: unknown): RevenueChain | null {
  const normalized = String(value || "").trim().toLowerCase()
  const aliases: Record<string, RevenueChain> = {
    eth: "ethereum",
    ethereum: "ethereum",
    "ethereum-mainnet": "ethereum",
    base: "base",
    "base-mainnet": "base",
    bnb: "bnb",
    bsc: "bnb",
    "bsc-mainnet": "bnb",
    "bnb-smart-chain": "bnb",
    robinhood: "robinhood",
    "robinhood-mainnet": "robinhood",
    sol: "solana",
    solana: "solana",
    "solana-mainnet": "solana",
  }
  return aliases[normalized] || (REVENUE_CHAINS.includes(normalized as RevenueChain) ? normalized as RevenueChain : null)
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function numeric(value: unknown, decimals?: number | null) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const raw = String(value ?? "").trim()
  if (!raw) return null
  let number = raw.startsWith("0x") ? Number(BigInt(raw)) : Number(raw)
  if (!Number.isFinite(number)) return null
  if (decimals && decimals > 0) number /= 10 ** decimals
  return number
}

function eventItems(payload: any) {
  const root = payload?.data ?? payload?.result ?? payload?.events ?? payload
  return asArray(root).flatMap((item) => {
    if (Array.isArray(item?.transfers)) return item.transfers.map((transfer: any, index: number) => ({ ...item, ...transfer, eventIndex: transfer.eventIndex ?? transfer.index ?? index }))
    if (Array.isArray(item?.events)) return item.events.map((event: any, index: number) => ({ ...item, ...event, eventIndex: event.eventIndex ?? event.index ?? index }))
    return [item]
  })
}

function timeValue(item: any) {
  const raw = item.blockTime ?? item.blockTimestamp ?? item.timestamp ?? item.time ?? null
  if (raw == null) return null
  if (typeof raw === "number" || /^\d+$/.test(String(raw))) {
    const number = Number(raw)
    const date = new Date(number * (String(Math.trunc(number)).length <= 10 ? 1_000 : 1))
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizedAddress(value: unknown, chain: RevenueChain) {
  const address = String(value || "").trim()
  return chain === "solana" ? address : address.toLowerCase()
}

function monitoredWallet(chain: RevenueChain) {
  return chain === "solana" ? SOLANA_REVENUE_WALLET : EVM_REVENUE_WALLET
}

function itemReceipt(item: any, chain: RevenueChain, fallbackIndex: number): ReceiptInput | null {
  const configuredWallet = normalizedAddress(monitoredWallet(chain), chain)
  const wallet = normalizedAddress(item.wallet ?? item.account ?? item.monitoredWallet ?? configuredWallet, chain)
  if (!wallet) return null
  if (configuredWallet && wallet !== configuredWallet) return null
  const from = normalizedAddress(item.from ?? item.sender ?? item.source ?? item.fromAddress, chain)
  const to = normalizedAddress(item.to ?? item.receiver ?? item.destination ?? item.toAddress, chain)
  const direction = String(item.direction || "").toLowerCase() === "outgoing" || (from && from === wallet)
    ? "outgoing"
    : String(item.direction || "").toLowerCase() === "incoming" || (to && to === wallet)
      ? "incoming"
      : null
  if (!direction) return null
  const transactionHash = String(item.transactionHash ?? item.transaction_hash ?? item.txHash ?? item.hash ?? item.signature ?? "").trim()
  if (!transactionHash) return null
  const decimals = item.decimals == null ? null : Number(item.decimals)
  const rawAmount = item.amount ?? item.changeAmount ?? item.uiAmount ?? item.tokenAmount ?? item.value
  const asset = String(item.asset ?? item.symbol ?? item.tokenSymbol ?? item.currency ?? (item.mint ? "TOKEN" : chain === "solana" ? "SOL" : chain === "bnb" ? "BNB" : "ETH")).trim().toUpperCase()
  const valueIsRaw = item.rawAmount != null || item.valueIsRaw === true || (typeof rawAmount === "string" && rawAmount.startsWith("0x"))
  const fallbackDecimals = asset === "USDC" ? 6 : chain === "solana" && asset === "SOL" ? 9 : chain !== "solana" && ["ETH", "BNB"].includes(asset) ? 18 : null
  const amount = numeric(item.rawAmount ?? rawAmount, valueIsRaw ? decimals ?? fallbackDecimals : null)
  if (amount == null || amount <= 0) return null
  const eventIndex = Number(item.eventIndex ?? item.logIndex ?? item.instructionIndex ?? item.index ?? fallbackIndex)
  const tokenAddress = String(item.tokenAddress ?? item.contractAddress ?? item.mint ?? "").trim() || null
  const eventKey = `${chain}:${transactionHash.toLowerCase()}:${Number.isFinite(eventIndex) ? eventIndex : fallbackIndex}:${direction}:${asset}:${wallet}`
  return {
    eventKey,
    provider: "quicknode",
    chain,
    wallet,
    direction,
    transactionHash,
    eventIndex: Number.isFinite(eventIndex) ? eventIndex : fallbackIndex,
    blockNumber: item.blockNumber ?? item.block_number ?? item.slot ?? null,
    blockTime: timeValue(item),
    counterparty: direction === "incoming" ? from || null : to || null,
    asset,
    tokenAddress,
    decimals,
    amount,
    amountUsd: numeric(item.amountUsd ?? item.usdValue ?? item.valueUsd),
    status: "unclassified",
    allocations: [],
    raw: item,
    valuationStatus: numeric(item.amountUsd ?? item.usdValue ?? item.valueUsd) == null ? "pending" : "valued",
  }
}

/**
 * Normalizes the canonical transfer payload emitted by our QuickNode filter and
 * common wallet-webhook transfer shapes. Unknown shapes are retained in the
 * delivery audit but intentionally do not become accounting receipts.
 */
export function normalizeQuickNodeRevenuePayload(payload: any, chainInput?: unknown) {
  const chain = cleanWebhookChain(chainInput ?? payload?.metadata?.chain ?? payload?.metadata?.network ?? payload?.network)
  if (!chain) return { chain: null, receipts: [] as ReceiptInput[], rejected: eventItems(payload).length }
  const items = eventItems(payload)
  const receipts = items.map((item, index) => itemReceipt(item, chain, index)).filter(Boolean) as ReceiptInput[]
  return { chain, receipts, rejected: items.length - receipts.length }
}

export function revenueWalletsConfigured() {
  return { evm: EVM_REVENUE_WALLET, solana: SOLANA_REVENUE_WALLET }
}
