import { LAUNCH_CHAINS, LAUNCH_PADS, launchPad, padsForChain, type LaunchChainId } from "@/lib/launch-math"
import { projectActivationReadiness } from "@/lib/project-lifecycle"
import { formatTeamDateTime, TEAM_TIME_ZONE } from "@/lib/team-timezone"

export type LaunchSetupButton = { text: string; callback_data: string }

export const LAUNCH_QUOTE_TOKENS = ["SOL", "ETH", "BNB", "USDC", "USDT"] as const

const REVENUE_CHAIN_BY_LAUNCH_CHAIN: Record<LaunchChainId, string> = {
  sol: "solana",
  eth: "ethereum",
  bsc: "bnb",
  base: "base",
  rh: "robinhood",
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function launchChainIdForProject(value: unknown): LaunchChainId | null {
  const chain = String(value || "").trim().toLowerCase()
  return (Object.entries(REVENUE_CHAIN_BY_LAUNCH_CHAIN).find(([, revenueChain]) => revenueChain === chain)?.[0] || null) as LaunchChainId | null
}

export function launchChainConfig(chainId: LaunchChainId) {
  const chain = LAUNCH_CHAINS.find((item) => item.id === chainId)
  const venues = padsForChain(chainId)
  return {
    chainId,
    chain: REVENUE_CHAIN_BY_LAUNCH_CHAIN[chainId],
    chainLabel: chain?.name || chainId,
    venues,
    nativeQuoteToken: venues[0]?.symbol || (chainId === "sol" ? "SOL" : chainId === "bsc" ? "BNB" : "ETH"),
  }
}

export function launchSetupIssues(payload: any) {
  const issues: string[] = []
  const name = String(payload?.name || "").trim()
  const launchAt = payload?.launchAt || payload?.launchDate
  const tentativeLaunchDate = String(payload?.tentativeLaunchDate || "").trim()
  if (!name) issues.push("project name")
  if ((!launchAt || Number.isNaN(new Date(launchAt).getTime())) && !/^\d{4}-\d{2}-\d{2}$/.test(tentativeLaunchDate)) issues.push("launch day or exact time")
  if (!String(payload?.launchVenue || "").trim()) issues.push("launchpad / DEX")
  const readiness = projectActivationReadiness(payload)
  issues.push(...readiness.missing)
  if (readiness.referrerStatus === "assigned" && !(Number(payload?.referralPercentage || payload?.referrerPercentage || 0) > 0)) issues.push("referral percentage")
  return Array.from(new Set(issues))
}

export function launchSetupReady(payload: any) {
  return launchSetupIssues(payload).length === 0
}

export function formatLaunchSetupReview(action: any, notice = "") {
  const payload = action?.payload || {}
  const venue = launchPad(String(payload.launchVenue || ""))
  const chainId = launchChainIdForProject(payload.chain)
  const chainLabel = LAUNCH_CHAINS.find((chain) => chain.id === chainId)?.name || String(payload.chain || "Not selected")
  const launchAt = payload.launchAt || payload.launchDate
  const tentativeLaunchDate = String(payload.tentativeLaunchDate || "").trim()
  const tentativeDayLabel = /^\d{4}-\d{2}-\d{2}$/.test(tentativeLaunchDate)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: payload.launchTimeZone || TEAM_TIME_ZONE }).format(new Date(`${tentativeLaunchDate}T12:00:00Z`))
    : ""
  const launchLabel = launchAt && !Number.isNaN(new Date(launchAt).getTime())
    ? formatTeamDateTime(new Date(launchAt), payload.launchTimeZone || TEAM_TIME_ZONE)
    : tentativeDayLabel
      ? `${tentativeDayLabel} · Time TBD (tentative)`
      : "Not selected"
  const referrerStatus = String(payload.referrerStatus || (payload.referrer || payload.referrerAccountId ? "assigned" : "pending"))
  const referralPercentage = Number(payload.referralPercentage || payload.referrerPercentage || 0)
  const referrer = referrerStatus === "none"
    ? "No referrer"
    : referrerStatus === "assigned"
      ? `${payload.referrer || "Assigned"}${referralPercentage > 0 ? ` · ${referralPercentage}%` : " · percentage needed"}`
      : "Choose before creating"
  const issues = launchSetupIssues(payload)
  return [
    notice ? escapeHtml(notice) : "",
    "🚀 <b>Review launch</b>",
    "",
    `Project name: <b>${escapeHtml(payload.name || "Not selected")}</b>`,
    `Launch: <b>${escapeHtml(launchLabel)}</b>`,
    `Launchpad / DEX: <b>${escapeHtml(venue?.name || "Not selected")}</b>`,
    `Chain: <b>${escapeHtml(chainLabel)}</b>`,
    `Quote token: <b>${escapeHtml(String(payload.quoteToken || "Not selected").toUpperCase())}</b>`,
    `Fees: <b>${payload.feeConfigurationConfirmed ? `$${Number(payload.launchFeeUsd || 1000).toLocaleString("en-US")} launch + $${Number(payload.dailyTradingFeeUsd || 500).toLocaleString("en-US")}/day` : "Not confirmed"}</b>`,
    `Referrer: <b>${escapeHtml(referrer)}</b>`,
    "",
    issues.length
      ? `Complete before creating: <b>${escapeHtml(issues.join(", "))}</b>.`
      : "Everything is ready. Create the launch when these details are correct.",
    "Nothing is saved until you tap Create launch.",
  ].filter(Boolean).join("\n")
}

export function launchSetupButtons(action: any): LaunchSetupButton[][] {
  const id = String(action?._id || action?.actionId || "")
  const payload = action?.payload || {}
  const referrerStatus = String(payload.referrerStatus || (payload.referrer || payload.referrerAccountId ? "assigned" : "pending"))
  const rows: LaunchSetupButton[][] = [
    [
      { text: "✏️ Edit name", callback_data: `launchsetup:name:${id}` },
      { text: "⛓ Change chain", callback_data: `launchsetup:chain:${id}` },
    ],
    [
      { text: "🚀 Change launchpad", callback_data: `launchsetup:venue:${id}` },
      { text: "💱 Change quote", callback_data: `launchsetup:quote:${id}` },
    ],
    [
      { text: payload.tentativeLaunchDate && !payload.launchAt ? "🕒 Set exact time" : "🕒 Edit timing", callback_data: `launchsetup:timing:${id}` },
    ],
    referrerStatus === "pending"
      ? [
          { text: "No referrer", callback_data: `launchsetup:noref:${id}` },
          { text: "Choose referrer", callback_data: `launchsetup:referrer:${id}` },
        ]
      : [
          { text: referrerStatus === "none" ? "👤 Referrer: None" : `👤 Referrer: ${String(payload.referrer || "Assigned").slice(0, 24)}`, callback_data: `launchsetup:referrer:${id}` },
        ],
  ]
  if (launchSetupReady(payload)) rows.push([{ text: "✅ Create launch", callback_data: `launchsetup:create:${id}` }])
  rows.push([{ text: "❌ Cancel", callback_data: `launchsetup:cancel:${id}` }])
  return rows
}

export function launchChainButtons(actionId: string): LaunchSetupButton[][] {
  return LAUNCH_CHAINS.map((chain) => [{ text: chain.name, callback_data: `launchsetup:setchain:${actionId}:${chain.id}` }])
}

export function launchVenueButtons(actionId: string, chainId: LaunchChainId): LaunchSetupButton[][] {
  return padsForChain(chainId).map((venue) => [{ text: venue.name, callback_data: `launchsetup:setvenue:${actionId}:${venue.id}` }])
}

export function launchQuoteTokensForChain(chain: unknown) {
  const chainId = launchChainIdForProject(chain)
  if (chainId === "sol") return ["SOL", "USDC", "USDT"] as const
  if (chainId === "bsc") return ["BNB", "USDC", "USDT"] as const
  if (["eth", "base", "rh"].includes(String(chainId || ""))) return ["ETH", "USDC", "USDT"] as const
  return LAUNCH_QUOTE_TOKENS
}

export function launchQuoteButtons(actionId: string, chain?: unknown): LaunchSetupButton[][] {
  return launchQuoteTokensForChain(chain).map((quote) => [{ text: quote, callback_data: `launchsetup:setquote:${actionId}:${quote}` }])
}

export function launchVenueSelection(venueId: string) {
  const venue = LAUNCH_PADS.find((item) => item.id === venueId)
  if (!venue) return null
  const chain = launchChainConfig(venue.chainId)
  return {
    launchVenue: venue.id,
    launchFundingAsset: venue.symbol,
    chain: chain.chain,
    quoteToken: venue.symbol,
    quoteAssets: [venue.symbol],
    dailyTradingFeeEnabled: true,
    dailyTradingFeeUsd: 500,
    launchFeeUsd: 1000,
    feeConfigurationConfirmed: true,
  }
}
