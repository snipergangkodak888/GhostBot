import { REVENUE_CHAINS, type RevenueChain } from "@/lib/revenue-types"

const EVM_RPC_URLS: Partial<Record<RevenueChain, string>> = {
  ethereum: process.env.REVENUE_ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com",
  base: process.env.REVENUE_BASE_RPC_URL || "https://mainnet.base.org",
  bnb: process.env.REVENUE_BNB_RPC_URL || "https://bsc-dataseed.binance.org",
  robinhood: process.env.REVENUE_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
}

const BLOCKSCOUT_TOKEN_URLS: Partial<Record<RevenueChain, string>> = {
  robinhood: "https://robinhoodchain.blockscout.com/api/v2/tokens",
}

export type CustomQuoteToken = {
  quoteToken: string
  quoteTokenAddress: string
  quoteTokenDecimals: number
}

function cleanRevenueChain(value: unknown): RevenueChain | "" {
  const chain = String(value || "").trim().toLowerCase()
  return REVENUE_CHAINS.includes(chain as RevenueChain) ? chain as RevenueChain : ""
}

export function cleanCustomQuoteSymbol(value: unknown) {
  const symbol = String(value || "").trim().toUpperCase()
  return /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(symbol) ? symbol : ""
}

export function cleanQuoteTokenAddress(value: unknown, chainInput: unknown) {
  const chain = cleanRevenueChain(chainInput)
  const address = String(value || "").trim()
  if (!chain || !address) return ""
  if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : ""
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address : ""
}

export function cleanQuoteTokenDecimals(value: unknown) {
  const decimals = Number(value)
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null
}

export function parseCustomQuoteTokenInput(value: unknown) {
  const text = String(value || "").trim()
  const address = text.match(/0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] || ""
  const beforeAddress = address ? text.slice(0, text.indexOf(address)) : text
  const symbol = cleanCustomQuoteSymbol(beforeAddress.replace(/\b(?:custom|quote|token|ca|contract|address)\b/gi, " ").replace(/[|,:;()\-]+/g, " ").trim().split(/\s+/)[0])
  return { symbol, address }
}

function decodeRpcString(value: unknown) {
  const hex = String(value || "").replace(/^0x/, "")
  if (!hex || !/^[0-9a-f]+$/i.test(hex)) return ""
  try {
    const offset = Number.parseInt(hex.slice(0, 64), 16)
    const lengthPosition = offset * 2
    const dynamicLength = Number.parseInt(hex.slice(lengthPosition, lengthPosition + 64), 16)
    const dynamicHex = hex.slice(lengthPosition + 64, lengthPosition + 64 + dynamicLength * 2)
    const source = offset === 32 && dynamicLength > 0 ? dynamicHex : hex.slice(0, 64)
    return Buffer.from(source, "hex").toString("utf8").replace(/\0+$/g, "").trim()
  } catch {
    return ""
  }
}

async function jsonRpc(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.error || payload?.result == null) throw new Error(payload?.error?.message || `Token metadata lookup failed (${response.status})`)
  return payload.result
}

async function evmMetadata(chain: RevenueChain, address: string) {
  const blockscout = BLOCKSCOUT_TOKEN_URLS[chain]
  if (blockscout) {
    try {
      const response = await fetch(`${blockscout}/${address}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) })
      const payload = await response.json().catch(() => ({}))
      const decimals = cleanQuoteTokenDecimals(payload?.decimals)
      const symbol = cleanCustomQuoteSymbol(payload?.symbol)
      if (response.ok && decimals != null) return { symbol, decimals }
    } catch {
      // Fall through to standard JSON-RPC calls.
    }
  }
  const rpcUrl = EVM_RPC_URLS[chain]
  if (!rpcUrl) throw new Error(`Custom quote tokens are not configured for ${chain}.`)
  const [decimalsHex, symbolHex] = await Promise.all([
    jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]),
    jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0x95d89b41" }, "latest"]).catch(() => ""),
  ])
  const decimals = cleanQuoteTokenDecimals(Number(BigInt(String(decimalsHex))))
  if (decimals == null) throw new Error("The contract did not return valid ERC-20 decimals.")
  return { symbol: cleanCustomQuoteSymbol(decodeRpcString(symbolHex)), decimals }
}

async function solanaMetadata(address: string) {
  const rpcUrl = process.env.REVENUE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
  const result = await jsonRpc(rpcUrl, "getTokenSupply", [address, { commitment: "confirmed" }])
  const decimals = cleanQuoteTokenDecimals(result?.value?.decimals)
  if (decimals == null) throw new Error("The mint did not return valid token decimals.")
  return { symbol: "", decimals }
}

export async function resolveCustomQuoteToken(chainInput: unknown, symbolInput: unknown, addressInput: unknown): Promise<CustomQuoteToken> {
  const chain = cleanRevenueChain(chainInput)
  if (!chain) throw new Error("Choose the launch chain before entering a custom quote token.")
  const requestedSymbol = cleanCustomQuoteSymbol(symbolInput)
  if (!requestedSymbol) throw new Error("Send a token symbol using up to 20 letters, numbers, dots, dashes, or underscores.")
  const address = cleanQuoteTokenAddress(addressInput, chain)
  if (!address) throw new Error(chain === "solana" ? "Send a valid Solana mint address." : "Send a valid 0x contract address.")
  const metadata = chain === "solana" ? await solanaMetadata(address) : await evmMetadata(chain, address)
  if (metadata.symbol && metadata.symbol !== requestedSymbol) throw new Error(`That contract reports the symbol ${metadata.symbol}, not ${requestedSymbol}.`)
  return { quoteToken: metadata.symbol || requestedSymbol, quoteTokenAddress: address, quoteTokenDecimals: metadata.decimals }
}
