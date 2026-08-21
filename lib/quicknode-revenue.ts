import { createHmac, timingSafeEqual } from "node:crypto"
import type { RevenueChain, RevenueReceipt, RevenueReceiptStatus, RevenueWalletRole } from "@/lib/revenue-types"
import { REVENUE_CHAINS, REVENUE_WALLET_ROLES } from "@/lib/revenue-types"

type ReceiptInput = Omit<RevenueReceipt, "_id" | "createdAt" | "updatedAt">

const EVM_REVENUE_WALLET = String(process.env.REVENUE_EVM_WALLET || "").trim().toLowerCase()
const SOLANA_REVENUE_WALLET = String(process.env.REVENUE_SOLANA_WALLET || "").trim()
const SOLANA_TREASURY_WALLET = String(process.env.REVENUE_SOLANA_TREASURY_WALLET || "").trim()
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

type TokenMetadata = { asset: string; decimals: number }
type TokenRegistry = Partial<Record<RevenueChain, Record<string, TokenMetadata>>>

// Circle's canonical mainnet USDC contracts/mint. Other accepted tokens must be
// explicitly allowlisted through REVENUE_TOKEN_REGISTRY_JSON so spam tokens do
// not become accounting receipts.
const DEFAULT_TOKEN_REGISTRY: TokenRegistry = {
  ethereum: {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { asset: "USDC", decimals: 6 },
  },
  base: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { asset: "USDC", decimals: 6 },
  },
  solana: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { asset: "USDC", decimals: 6 },
  },
}

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

export function cleanRevenueWalletRole(value: unknown): RevenueWalletRole | null {
  const normalized = String(value || "revenue").trim().toLowerCase()
  return REVENUE_WALLET_ROLES.includes(normalized as RevenueWalletRole) ? normalized as RevenueWalletRole : null
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
  let number: number
  try {
    number = raw.startsWith("0x") ? Number(BigInt(raw)) : Number(raw)
  } catch {
    return null
  }
  if (!Number.isFinite(number)) return null
  if (decimals && decimals > 0) number /= 10 ** decimals
  return number
}

function integer(value: unknown) {
  try {
    if (typeof value === "bigint") return value
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value)
    const raw = String(value ?? "").trim()
    return raw ? BigInt(raw) : null
  } catch {
    return null
  }
}

function integerNumber(value: unknown) {
  const parsed = integer(value)
  if (parsed == null) return null
  const number = Number(parsed)
  return Number.isFinite(number) ? number : null
}

function scaledInteger(value: bigint, decimals: number) {
  const number = Number(value < BigInt(0) ? -value : value) / 10 ** decimals
  return Number.isFinite(number) ? number : null
}

function configuredTokenRegistry(): TokenRegistry {
  let configured: TokenRegistry = {}
  try {
    configured = JSON.parse(String(process.env.REVENUE_TOKEN_REGISTRY_JSON || "{}")) as TokenRegistry
  } catch {
    configured = {}
  }
  const registry: TokenRegistry = {}
  for (const chain of REVENUE_CHAINS) {
    registry[chain] = {}
    for (const source of [DEFAULT_TOKEN_REGISTRY[chain], configured?.[chain]]) {
      for (const [address, metadata] of Object.entries(source || {})) {
        const decimals = Number(metadata?.decimals)
        const asset = String(metadata?.asset || "").trim().toUpperCase()
        if (!asset || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
        registry[chain]![normalizedAddress(address, chain)] = { asset, decimals }
      }
    }
  }
  return registry
}

const TOKEN_REGISTRY = configuredTokenRegistry()

function tokenMetadata(chain: RevenueChain, address: unknown) {
  return TOKEN_REGISTRY[chain]?.[normalizedAddress(address, chain)] || null
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
  if (typeof raw === "number" || /^\d+$/.test(String(raw)) || /^0x[\da-f]+$/i.test(String(raw))) {
    const number = /^0x/i.test(String(raw)) ? Number(BigInt(String(raw))) : Number(raw)
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

function monitoredWallet(chain: RevenueChain, walletRole: RevenueWalletRole = "revenue") {
  if (walletRole === "treasury") return chain === "solana" ? SOLANA_TREASURY_WALLET : ""
  return chain === "solana" ? SOLANA_REVENUE_WALLET : EVM_REVENUE_WALLET
}

function receiptInput(params: {
  chain: RevenueChain
  walletRole?: RevenueWalletRole
  wallet: string
  direction: "incoming" | "outgoing"
  transactionHash: string
  eventIndex: number
  blockNumber?: number | string | null
  blockTime?: string | null
  counterparty?: string | null
  asset: string
  tokenAddress?: string | null
  decimals: number
  amount: number
  amountUsd?: number | null
  status?: RevenueReceiptStatus
  raw: unknown
}): ReceiptInput {
  const tokenAddress = String(params.tokenAddress || "").trim() || null
  const tokenKey = tokenAddress ? normalizedAddress(tokenAddress, params.chain) : "native"
  const amountUsd = params.amountUsd == null ? params.asset === "USDC" ? params.amount : null : params.amountUsd
  return {
    eventKey: `${params.chain}:${params.transactionHash.toLowerCase()}:${params.eventIndex}:${params.direction}:${params.asset}:${tokenKey}:${params.wallet}`,
    provider: "quicknode",
    chain: params.chain,
    walletRole: params.walletRole || "revenue",
    wallet: params.wallet,
    direction: params.direction,
    transactionHash: params.transactionHash,
    eventIndex: params.eventIndex,
    blockNumber: params.blockNumber ?? null,
    blockTime: params.blockTime ?? null,
    counterparty: params.counterparty || null,
    asset: params.asset,
    tokenAddress,
    decimals: params.decimals,
    amount: params.amount,
    amountUsd,
    status: params.status || "unclassified",
    allocations: [],
    raw: params.raw,
    valuationStatus: amountUsd == null ? "pending" : "valued",
  }
}

function evmDirection(wallet: string, fromInput: unknown, toInput: unknown) {
  const from = normalizedAddress(fromInput, "ethereum")
  const to = normalizedAddress(toInput, "ethereum")
  if (to === wallet) return { direction: "incoming" as const, counterparty: from || null }
  if (from === wallet) return { direction: "outgoing" as const, counterparty: to || null }
  return null
}

function topicAddress(value: unknown) {
  const topic = String(value || "").toLowerCase()
  return /^0x[0-9a-f]{64}$/.test(topic) ? `0x${topic.slice(-40)}` : ""
}

function normalizeEvmTemplatePayload(payload: any, chain: RevenueChain, walletRole: RevenueWalletRole) {
  const wallet = monitoredWallet(chain, walletRole)
  const receipts: ReceiptInput[] = []
  let rejected = 0

  for (const transaction of asArray(payload?.matchingTransactions)) {
    const value = integer(transaction?.value)
    const match = evmDirection(wallet, transaction?.from, transaction?.to)
    const transactionHash = String(transaction?.hash || transaction?.transactionHash || "").trim()
    const amount = value == null ? null : scaledInteger(value, 18)
    if (!wallet || !match || !transactionHash || value == null || value <= BigInt(0) || amount == null || amount <= 0) {
      rejected += 1
      continue
    }
    receipts.push(receiptInput({
      chain,
      walletRole,
      wallet,
      ...match,
      transactionHash,
      eventIndex: -1,
      blockNumber: transaction?.blockNumber ?? null,
      blockTime: timeValue(transaction),
      asset: chain === "bnb" ? "BNB" : "ETH",
      decimals: 18,
      amount,
      raw: transaction,
    }))
  }

  for (const receipt of asArray(payload?.matchingReceipts)) {
    if (integer(receipt?.status) === BigInt(0)) {
      rejected += 1
      continue
    }
    let sawTransfer = false
    const logs = asArray(receipt?.logs)
    for (let logPosition = 0; logPosition < logs.length; logPosition += 1) {
      const log = logs[logPosition]
      const topics = asArray(log?.topics)
      if (String(topics[0] || "").toLowerCase() !== ERC20_TRANSFER_TOPIC || topics.length !== 3) continue
      sawTransfer = true
      const match = evmDirection(wallet, topicAddress(topics[1]), topicAddress(topics[2]))
      const transactionHash = String(log?.transactionHash || receipt?.transactionHash || "").trim()
      const tokenAddress = normalizedAddress(log?.address, chain)
      const metadata = tokenMetadata(chain, tokenAddress)
      const rawAmount = integer(log?.data)
      const amount = rawAmount == null || !metadata ? null : scaledInteger(rawAmount, metadata.decimals)
      const eventIndex = integerNumber(log?.logIndex) ?? logPosition
      if (!wallet || !match || !transactionHash || !tokenAddress || !metadata || rawAmount == null || rawAmount <= BigInt(0) || amount == null || amount <= 0) {
        rejected += 1
        continue
      }
      receipts.push(receiptInput({
        chain,
        walletRole,
        wallet,
        ...match,
        transactionHash,
        eventIndex,
        blockNumber: log?.blockNumber ?? receipt?.blockNumber ?? null,
        blockTime: timeValue(log),
        asset: metadata.asset,
        tokenAddress,
        decimals: metadata.decimals,
        amount,
        raw: { receipt: { from: receipt?.from, to: receipt?.to, status: receipt?.status }, log },
      }))
    }
    if (!sawTransfer) rejected += 1
  }

  return { receipts, rejected }
}

function solanaAccountKeys(raw: any) {
  const staticKeys = asArray(raw?.transaction?.message?.accountKeys).map((entry) => String(entry?.pubkey ?? entry ?? ""))
  const loaded = raw?.meta?.loadedAddresses || {}
  return [...staticKeys, ...asArray(loaded?.writable).map(String), ...asArray(loaded?.readonly).map(String)]
}

function addTokenBalances(target: Map<string, { amount: bigint; decimals: number | null; indices: number[] }>, balances: unknown, sign: bigint, wallet: string) {
  for (const balance of asArray(balances)) {
    if (String(balance?.owner || "") !== wallet) continue
    const mint = String(balance?.mint || "").trim()
    const amount = integer(balance?.uiTokenAmount?.amount)
    const decimals = Number(balance?.uiTokenAmount?.decimals)
    const accountIndex = Number(balance?.accountIndex)
    if (!mint || amount == null) continue
    const current = target.get(mint) || { amount: BigInt(0), decimals: null, indices: [] }
    current.amount += sign * amount
    if (Number.isInteger(decimals)) current.decimals = decimals
    if (Number.isInteger(accountIndex)) current.indices.push(accountIndex)
    target.set(mint, current)
  }
}

function normalizeSolanaTemplatePayload(payload: any, chain: RevenueChain, walletRole: RevenueWalletRole) {
  const wallet = monitoredWallet(chain, walletRole)
  const receipts: ReceiptInput[] = []
  let rejected = 0
  const recordReceipt = (receipt: ReceiptInput) => {
    if (walletRole === "treasury" && (receipt.direction !== "incoming" || receipt.asset !== "USDC")) return
    receipts.push(receipt)
  }
  for (const batch of asArray(payload)) {
    const block = batch?.block || {}
    for (const transactionEntry of asArray(batch?.transactions)) {
      const raw = transactionEntry?.raw || {}
      const listedWallets = asArray(transactionEntry?.wallets).map(String)
      if (!wallet || !listedWallets.includes(wallet) || raw?.meta?.err != null) {
        rejected += 1
        continue
      }
      const transactionHash = String(raw?.transaction?.signatures?.[0] || "").trim()
      if (!transactionHash) {
        rejected += 1
        continue
      }

      let transactionReceipts = 0
      let handledMovements = 0
      const keys = solanaAccountKeys(raw)
      const preBalances = asArray(raw?.meta?.preBalances)
      const postBalances = asArray(raw?.meta?.postBalances)
      let lamportDelta = BigInt(0)
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        if (key !== wallet) continue
        const before = integer(preBalances[index])
        const after = integer(postBalances[index])
        if (before != null && after != null) lamportDelta += after - before
      }
      if (lamportDelta !== BigInt(0)) {
        handledMovements += 1
        const amount = scaledInteger(lamportDelta, 9)
        if (amount != null && amount > 0) {
          recordReceipt(receiptInput({
            chain,
            walletRole,
            wallet,
            direction: lamportDelta > BigInt(0) ? "incoming" : "outgoing",
            transactionHash,
            eventIndex: -1,
            blockNumber: block?.slot ?? null,
            blockTime: timeValue(block),
            asset: "SOL",
            decimals: 9,
            amount,
            raw: { walletDelta: lamportDelta.toString(), transaction: raw },
            status: walletRole === "treasury" ? "internal" : "unclassified",
          }))
          transactionReceipts += 1
        }
      }

      const tokenDeltas = new Map<string, { amount: bigint; decimals: number | null; indices: number[] }>()
      addTokenBalances(tokenDeltas, raw?.meta?.preTokenBalances, BigInt(-1), wallet)
      addTokenBalances(tokenDeltas, raw?.meta?.postTokenBalances, BigInt(1), wallet)
      for (const [mint, delta] of Array.from(tokenDeltas.entries())) {
        if (delta.amount === BigInt(0)) continue
        handledMovements += 1
        const metadata = tokenMetadata(chain, mint)
        if (!metadata || (delta.decimals != null && delta.decimals !== metadata.decimals)) {
          rejected += 1
          continue
        }
        const amount = scaledInteger(delta.amount, metadata.decimals)
        if (amount == null || amount <= 0) {
          rejected += 1
          continue
        }
        const eventIndex = delta.indices.length ? Math.min(...delta.indices) : 0
        recordReceipt(receiptInput({
          chain,
          walletRole,
          wallet,
          direction: delta.amount > BigInt(0) ? "incoming" : "outgoing",
          transactionHash,
          eventIndex,
          blockNumber: block?.slot ?? null,
          blockTime: timeValue(block),
          asset: metadata.asset,
          tokenAddress: mint,
          decimals: metadata.decimals,
          amount,
          status: walletRole === "treasury" ? "internal" : "unclassified",
          raw: { tokenDelta: delta.amount.toString(), mint, transaction: raw },
        }))
        transactionReceipts += 1
      }
      if (!transactionReceipts && !handledMovements && tokenDeltas.size === 0) rejected += 1
    }
  }
  return { receipts, rejected }
}

function itemReceipt(item: any, chain: RevenueChain, walletRole: RevenueWalletRole, fallbackIndex: number): ReceiptInput | null {
  const configuredWallet = normalizedAddress(monitoredWallet(chain, walletRole), chain)
  if (!configuredWallet) return null
  const wallet = normalizedAddress(item.wallet ?? item.account ?? item.monitoredWallet ?? configuredWallet, chain)
  if (wallet !== configuredWallet) return null
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
  return receiptInput({
    chain,
    walletRole,
    wallet,
    direction,
    transactionHash,
    eventIndex: Number.isFinite(eventIndex) ? eventIndex : fallbackIndex,
    blockNumber: item.blockNumber ?? item.block_number ?? item.slot ?? null,
    blockTime: timeValue(item),
    counterparty: direction === "incoming" ? from || null : to || null,
    asset,
    tokenAddress,
    decimals: decimals ?? fallbackDecimals ?? 0,
    amount,
    amountUsd: numeric(item.amountUsd ?? item.usdValue ?? item.valueUsd),
    raw: item,
  })
}

/**
 * Normalizes the canonical transfer payload emitted by our QuickNode filter and
 * common wallet-webhook transfer shapes. Unknown shapes are retained in the
 * delivery audit but intentionally do not become accounting receipts.
 */
export function normalizeQuickNodeRevenuePayload(payload: any, chainInput?: unknown, walletRoleInput?: unknown) {
  const chain = cleanWebhookChain(chainInput ?? payload?.metadata?.chain ?? payload?.metadata?.network ?? payload?.network)
  if (!chain) return { chain: null, receipts: [] as ReceiptInput[], rejected: eventItems(payload).length }
  const walletRole = cleanRevenueWalletRole(walletRoleInput)
  if (!walletRole || (walletRole === "treasury" && chain !== "solana")) return { chain, walletRole: null, receipts: [] as ReceiptInput[], rejected: eventItems(payload).length }
  if (chain === "solana" && asArray(payload).some((item) => item?.block && Array.isArray(item?.transactions))) {
    return { chain, walletRole, ...normalizeSolanaTemplatePayload(payload, chain, walletRole) }
  }
  if (chain !== "solana" && payload && (Object.hasOwn(payload, "matchingTransactions") || Object.hasOwn(payload, "matchingReceipts"))) {
    return { chain, walletRole, ...normalizeEvmTemplatePayload(payload, chain, walletRole) }
  }
  const items = eventItems(payload)
  const receipts = items.map((item, index) => itemReceipt(item, chain, walletRole, index)).filter(Boolean) as ReceiptInput[]
  return { chain, walletRole, receipts, rejected: items.length - receipts.length }
}

export function revenueWalletsConfigured() {
  return { evm: EVM_REVENUE_WALLET, solana: SOLANA_REVENUE_WALLET, solanaTreasury: SOLANA_TREASURY_WALLET }
}
