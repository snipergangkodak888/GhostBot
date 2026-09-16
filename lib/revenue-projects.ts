import type { ProjectFeeConfig, RevenueChain } from "@/lib/revenue-types"
import { REVENUE_CHAINS } from "@/lib/revenue-types"
import { cleanQuoteTokenAddress, cleanQuoteTokenDecimals } from "@/lib/custom-quote-token"

export const CHAIN_LABELS: Record<RevenueChain, string> = {
  ethereum: "Ethereum Mainnet",
  base: "Base",
  bnb: "BNB Smart Chain",
  robinhood: "Robinhood Chain",
  solana: "Solana",
  arc: "Arc",
}

export const DEFAULT_CHAIN_ASSETS: Record<RevenueChain, string[]> = {
  ethereum: ["ETH", "USDC"],
  base: ["ETH", "USDC"],
  bnb: ["BNB", "USDC"],
  robinhood: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  arc: ["USDC"],
}

export function cleanRevenueChain(value: unknown): RevenueChain | "" {
  const chain = String(value || "").trim().toLowerCase()
  return REVENUE_CHAINS.includes(chain as RevenueChain) ? chain as RevenueChain : ""
}

export function cleanQuoteAssets(value: unknown, chain?: RevenueChain | "") {
  const values = Array.isArray(value) ? value : String(value || "").split(",")
  const assets = Array.from(new Set(values.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)))
  return assets.length ? assets : chain ? [...DEFAULT_CHAIN_ASSETS[chain]] : []
}

export function projectFeeConfig(project: any): ProjectFeeConfig {
  const chain = cleanRevenueChain(project?.chain || project?.revenueChain)
  const explicitQuote = String(project?.quoteToken || "").trim().toUpperCase()
  const quoteAssets = explicitQuote ? [explicitQuote] : cleanQuoteAssets(project?.quoteAssets, chain)
  const quoteTokenAddress = cleanQuoteTokenAddress(project?.quoteTokenAddress, chain)
  return {
    chain,
    quoteToken: explicitQuote || (quoteAssets.length === 1 ? quoteAssets[0] : ""),
    quoteAssets,
    acceptedRevenueAssets: cleanQuoteAssets(project?.acceptedRevenueAssets ?? quoteAssets, chain),
    quoteTokenAddress,
    quoteTokenDecimals: quoteTokenAddress ? cleanQuoteTokenDecimals(project?.quoteTokenDecimals) : null,
    dailyTradingFeeEnabled: project?.dailyTradingFeeEnabled === true,
    dailyTradingFeeUsd: Math.max(0, Number(project?.dailyTradingFeeUsd ?? 500)),
    liquidationFeeEnabled: project?.liquidationFeeEnabled !== false,
    liquidationFeePercentage: Math.max(0, Number(project?.liquidationFeePercentage ?? 5)),
    launchFeeUsd: Math.max(0, Number(project?.launchFeeUsd ?? 1_000)),
  }
}

export function cleanProjectFeeFields(body: any) {
  const chain = cleanRevenueChain(body?.chain || body?.revenueChain)
  const explicitQuote = String(body?.quoteToken || "").trim().toUpperCase()
  const quoteAssets = explicitQuote ? [explicitQuote] : cleanQuoteAssets(body?.quoteAssets, chain)
  const quoteTokenAddress = cleanQuoteTokenAddress(body?.quoteTokenAddress, chain)
  return {
    chain,
    quoteToken: explicitQuote || (quoteAssets.length === 1 ? quoteAssets[0] : ""),
    quoteAssets,
    acceptedRevenueAssets: cleanQuoteAssets(body?.acceptedRevenueAssets ?? quoteAssets, chain),
    quoteTokenAddress,
    quoteTokenDecimals: quoteTokenAddress ? cleanQuoteTokenDecimals(body?.quoteTokenDecimals) : null,
    dailyTradingFeeEnabled: body?.dailyTradingFeeEnabled === true,
    dailyTradingFeeUsd: Math.max(0, Number(body?.dailyTradingFeeUsd ?? 500)),
    liquidationFeeEnabled: body?.liquidationFeeEnabled !== false,
    liquidationFeePercentage: Math.max(0, Number(body?.liquidationFeePercentage ?? 5)),
    launchFeeUsd: Math.max(0, Number(body?.launchFeeUsd ?? 1_000)),
  }
}

/** The pair's quote token and the assets received for accounting are independent. */
export function projectAcceptsReceipt(project: any, receipt: any) {
  const config = projectFeeConfig(project)
  if (config.chain !== receipt.chain || !config.acceptedRevenueAssets.includes(receipt.asset)) return false
  if (receipt.asset !== config.quoteToken || !config.quoteTokenAddress) return true
  const normalize = (value: unknown) => config.chain === "solana" ? String(value || "").trim() : String(value || "").trim().toLowerCase()
  return normalize(config.quoteTokenAddress) === normalize(receipt.tokenAddress)
}

export function searchFeeProjects(projects: any[], fee: any, search: string) {
  const named = projects.filter((project) => String(project.name || "").toLowerCase().includes(search.trim().toLowerCase()))
  const asset = String(fee?.grossAsset || fee?.quoteAsset || "").toUpperCase()
  const reasons: string[] = []
  const matches = named.filter((project) => {
    const config = projectFeeConfig(project)
    const name = String(project.name || "This project")
    if (project.status === "inactive") reasons.push(`${name} is inactive.`)
    else if (!config.chain) reasons.push(`${name} has no revenue chain configured.`)
    else if (fee?.chain && config.chain !== fee.chain) reasons.push(`${name} is on ${CHAIN_LABELS[config.chain]}, not the fee's chain.`)
    else if (asset && asset !== "USD" && !config.acceptedRevenueAssets.includes(asset)) reasons.push(`${name} is active, but accepts ${config.acceptedRevenueAssets.join(", ")} revenue, not ${asset}. Add ${asset} to its accepted revenue assets in Projects.`)
    else return true
    return false
  })
  return { matches: matches.slice(0, 10), message: named.length ? reasons.slice(0, 3).join("\n") : "No project name matched that search." }
}
