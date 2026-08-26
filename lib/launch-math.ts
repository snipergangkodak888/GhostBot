/**
 * Launch venue math adapted from the supplied sim-math.js and
 * curve-lab-math.js modules. Amounts use whole quote assets and whole tokens.
 */

export type LaunchChainId = "sol" | "eth" | "bsc" | "base" | "rh"
export type LaunchPadType = "curve" | "amm"

export type LaunchPad = {
  id: string
  chainId: LaunchChainId
  name: string
  symbol: "SOL" | "ETH" | "BNB"
  coinGeckoId: "solana" | "ethereum" | "binancecoin"
  fallbackUsd: number
  type: LaunchPadType
  feePct: number
  supply: number
  virtualQuote?: number
  virtualTokens?: number
  sellableTokens?: number
  defaultLp?: number
}

export const LAUNCH_CHAINS: Array<{ id: LaunchChainId; name: string }> = [
  { id: "sol", name: "Solana" },
  { id: "bsc", name: "BNB Chain" },
  { id: "eth", name: "Ethereum" },
  { id: "base", name: "Base" },
  { id: "rh", name: "Robinhood Chain" },
]

// These reserve values are carried over from the supplied simulator.
export const LAUNCH_PADS: LaunchPad[] = [
  { id: "pumpfun", chainId: "sol", name: "Pump.fun", symbol: "SOL", coinGeckoId: "solana", fallbackUsd: 74, type: "curve", virtualQuote: 30, virtualTokens: 1_073_000_000, sellableTokens: 793_100_000, supply: 1_000_000_000, feePct: 1.25 },
  { id: "meteora", chainId: "sol", name: "Meteora DAMM v2", symbol: "SOL", coinGeckoId: "solana", fallbackUsd: 74, type: "amm", supply: 1_000_000_000, feePct: 0.25, defaultLp: 15 },
  { id: "flap", chainId: "bsc", name: "Flap", symbol: "BNB", coinGeckoId: "binancecoin", fallbackUsd: 571, type: "curve", virtualQuote: 6.14, virtualTokens: 1_107_036_752, sellableTokens: 800_000_000, supply: 1_000_000_000, feePct: 1 },
  { id: "fourmeme", chainId: "bsc", name: "Four.meme", symbol: "BNB", coinGeckoId: "binancecoin", fallbackUsd: 571, type: "curve", virtualQuote: 6.16438, virtualTokens: 1_073_972_600, sellableTokens: 800_000_000, supply: 1_000_000_000, feePct: 1 },
  { id: "pancake", chainId: "bsc", name: "PancakeSwap V2", symbol: "BNB", coinGeckoId: "binancecoin", fallbackUsd: 571, type: "amm", supply: 1_000_000_000, feePct: 0.25, defaultLp: 2.5 },
  { id: "uni-eth", chainId: "eth", name: "Uniswap V2", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "uni-base-v2", chainId: "base", name: "Uniswap V2", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "uni-base-v3", chainId: "base", name: "Uniswap V3 (full range)", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "aero", chainId: "base", name: "Aerodrome", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "uni-rh-v2", chainId: "rh", name: "Uniswap V2", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "uni-rh-v3", chainId: "rh", name: "Uniswap V3 (full range)", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "amm", supply: 1_000_000_000, feePct: 0.3, defaultLp: 0.5 },
  { id: "flap-rh", chainId: "rh", name: "Flap", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "curve", virtualQuote: 1.9189797, virtualTokens: 1_107_036_752, sellableTokens: 800_000_000, supply: 1_000_000_000, feePct: 1 },
  { id: "pons", chainId: "rh", name: "Pons V2", symbol: "ETH", coinGeckoId: "ethereum", fallbackUsd: 1_915, type: "curve", virtualQuote: 1.68, virtualTokens: 1_000_000_000, sellableTokens: 5_000_000_000 / 7, supply: 1_000_000_000, feePct: 1 },
]

export function launchPad(id: string) {
  return LAUNCH_PADS.find((pad) => pad.id === id) || null
}

export function padsForChain(chainId: LaunchChainId) {
  return LAUNCH_PADS.filter((pad) => pad.chainId === chainId)
}

export function curveParameters(pad: LaunchPad, initialLp = 0) {
  if (pad.type === "curve") {
    return {
      quote: Number(pad.virtualQuote),
      tokens: Number(pad.virtualTokens),
      sellable: Number(pad.sellableTokens),
      supply: pad.supply,
    }
  }
  if (!(initialLp > 0)) throw new Error("Initial LP must be greater than zero.")
  return { quote: initialLp, tokens: pad.supply, sellable: Number.POSITIVE_INFINITY, supply: pad.supply }
}

export function quoteToGraduate(pad: LaunchPad) {
  if (pad.type !== "curve") return null
  const curve = curveParameters(pad)
  const invariant = curve.quote * curve.tokens
  return invariant / (curve.tokens - curve.sellable) - curve.quote
}

export function tokensOut(pad: LaunchPad, netQuote: number, initialLp = 0) {
  const curve = curveParameters(pad, initialLp)
  const invariant = curve.quote * curve.tokens
  const tokens = curve.tokens - invariant / (curve.quote + netQuote)
  return Math.min(tokens, curve.sellable)
}

export function marketCapNative(pad: LaunchPad, netQuote: number, initialLp = 0) {
  const curve = curveParameters(pad, initialLp)
  const invariant = curve.quote * curve.tokens
  const quoteReserve = curve.quote + netQuote
  const tokenReserve = invariant / quoteReserve
  return (quoteReserve / tokenReserve) * curve.supply
}

export function quoteToOwnPercent(pad: LaunchPad, percent: number, initialLp = 0) {
  const curve = curveParameters(pad, initialLp)
  const targetTokens = (curve.supply * percent) / 100
  if (targetTokens >= curve.sellable) return null
  return (curve.quote * curve.tokens) / (curve.tokens - targetTokens) - curve.quote
}

export function quoteForMarketCapNative(pad: LaunchPad, targetMarketCap: number, initialLp = 0) {
  const curve = curveParameters(pad, initialLp)
  const quoteReserve = Math.sqrt((targetMarketCap * curve.quote * curve.tokens) / curve.supply)
  return quoteReserve - curve.quote
}
