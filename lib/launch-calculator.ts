import {
  launchPad,
  marketCapNative,
  quoteForMarketCapNative,
  quoteToGraduate,
  quoteToOwnPercent,
  tokensOut,
  type LaunchPad,
} from "@/lib/launch-math"
import {
  PUMPFUN_MIGRATION_CONTROL_PCT,
  quotePumpfunBySupplyControl,
  quotePumpfunMigrationByMarketCap,
} from "@/lib/pumpfun-migration-math"

export type LaunchTargetMetric = "supply" | "market_cap"

export type LaunchQuoteInput = {
  venueId: string
  metric: LaunchTargetMetric
  target: number
  assetPriceUsd: number
  initialLp?: number
  mmLiquidity?: number
}

export type LaunchQuoteLine = {
  key: "curve" | "migration" | "lp" | "accumulation" | "aged" | "routing" | "mm"
  amount: number
  label: string
}

export type LaunchQuote = {
  venue: LaunchPad
  metric: LaunchTargetMetric
  requestedTarget: number
  supplyControlPct: number
  launchMarketCapUsd: number
  assetPriceUsd: number
  initialLp?: number
  lines: LaunchQuoteLine[]
  capitalTotal: number
  decimals: number
}

type VenueBudget = {
  agedWallets: number
  routing: number
  defaultMm: number
}

const VENUE_BUDGETS: Record<string, VenueBudget> = {
  pumpfun: { agedWallets: 10, routing: 17.5, defaultMm: 30 },
  flap: { agedWallets: 2, routing: 0, defaultMm: 5 },
  fourmeme: { agedWallets: 2, routing: 0, defaultMm: 5 },
  pancake: { agedWallets: 2, routing: 0, defaultMm: 5 },
  meteora: { agedWallets: 10, routing: 0, defaultMm: 30 },
  "uni-eth": { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
  "uni-base-v2": { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
  "uni-base-v3": { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
  aero: { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
  "uni-rh-v2": { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
  "uni-rh-v3": { agedWallets: 1.5, routing: 0, defaultMm: 2.5 },
}

function budgetFor(pad: LaunchPad) {
  const budget = VENUE_BUDGETS[pad.id]
  if (!budget) throw new Error(`No operating budget is configured for ${pad.name}.`)
  return budget
}

function validateInput(input: LaunchQuoteInput, pad: LaunchPad) {
  if (!(input.assetPriceUsd > 0)) throw new Error(`A valid ${pad.symbol} price is required.`)
  if (!(input.target > 0)) throw new Error(input.metric === "supply" ? "Supply control must be greater than 0%." : "Launch market cap must be greater than $0.")
  if (input.metric === "supply" && input.target >= 100) throw new Error("Supply control must be below 100%.")
  if (pad.type === "amm" && !(Number(input.initialLp) > 0)) throw new Error("Initial LP must be greater than zero.")
  if (input.mmLiquidity != null && input.mmLiquidity < 0) throw new Error("MM liquidity cannot be negative.")
}

export function calculateLaunchQuote(input: LaunchQuoteInput): LaunchQuote {
  const pad = launchPad(input.venueId)
  if (!pad) throw new Error("That launch venue is not supported.")
  validateInput(input, pad)
  const budget = budgetFor(pad)
  const initialLp = pad.type === "amm" ? Number(input.initialLp) : 0
  const targetMarketCapNative = input.metric === "market_cap" ? input.target / input.assetPriceUsd : 0

  let netQuote = 0
  let supplyControlPct = 0
  let launchMarketCap = 0
  let pumpMigration = false
  let pumpCurveCapital = 0
  let pumpMigrationCapital = 0

  if (pad.id === "pumpfun") {
    const graduationQuote = Number(quoteToGraduate(pad))
    const graduationMarketCap = marketCapNative(pad, graduationQuote)
    const pumpQuote = input.metric === "supply"
      ? quotePumpfunBySupplyControl(input.target)
      : targetMarketCapNative > graduationMarketCap
        ? quotePumpfunMigrationByMarketCap(targetMarketCapNative)
        : (() => {
            const curveQuote = quoteForMarketCapNative(pad, targetMarketCapNative)
            if (curveQuote < 0) throw new Error("That market cap is below the venue's starting market cap.")
            const curveControl = (tokensOut(pad, curveQuote) / pad.supply) * 100
            return quotePumpfunBySupplyControl(curveControl)
          })()
    pumpCurveCapital = pumpQuote.curveCapitalSol
    pumpMigrationCapital = pumpQuote.migrationCapitalSol
    pumpMigration = pumpMigrationCapital > 0
    supplyControlPct = pumpQuote.supplyControlPct
    launchMarketCap = pumpQuote.marketCapNative
  } else {
    if (pad.type === "curve" && input.metric === "supply") {
      const maximum = (Number(pad.sellableTokens) / pad.supply) * 100
      if (input.target >= maximum) throw new Error(`${pad.name} can provide up to ${maximum.toFixed(2)}% before migration.`)
    }
    if (pad.type === "curve" && input.metric === "market_cap") {
      const graduationQuote = Number(quoteToGraduate(pad))
      const maximumMarketCap = marketCapNative(pad, graduationQuote)
      if (targetMarketCapNative > maximumMarketCap) throw new Error(`${pad.name} graduates at approximately $${Math.round(maximumMarketCap * input.assetPriceUsd).toLocaleString("en-US")} market cap.`)
    }
    netQuote = input.metric === "supply"
      ? Number(quoteToOwnPercent(pad, input.target, initialLp))
      : quoteForMarketCapNative(pad, targetMarketCapNative, initialLp)
    if (!Number.isFinite(netQuote) || netQuote < 0) throw new Error("That target is outside this venue's supported range.")
    supplyControlPct = (tokensOut(pad, netQuote, initialLp) / pad.supply) * 100
    launchMarketCap = marketCapNative(pad, netQuote, initialLp)
  }

  const lines: LaunchQuoteLine[] = []
  if (pumpMigration) {
    lines.push({ key: "curve", amount: pumpCurveCapital, label: `to capture the full Pump.fun bonding curve (${PUMPFUN_MIGRATION_CONTROL_PCT.toFixed(2)}% supply control pre-migration)` })
    lines.push({ key: "migration", amount: pumpMigrationCapital, label: `migration snipe allocation (bringing total control to ~${supplyControlPct.toFixed(2)}%)` })
  } else {
    lines.push({ key: "accumulation", amount: pad.id === "pumpfun" ? pumpCurveCapital : netQuote, label: "for supply accumulation" })
  }
  if (pad.type === "amm") lines.unshift({ key: "lp", amount: initialLp, label: "for initial LP" })
  lines.push({ key: "aged", amount: budget.agedWallets, label: "for aged wallets + Husher funding" })
  if (budget.routing > 0) lines.push({ key: "routing", amount: budget.routing, label: "for initial/pass-through wallet funding used in token redistribution" })
  lines.push({ key: "mm", amount: input.mmLiquidity ?? budget.defaultMm, label: "designated for initial MM trading liquidity" })

  const capitalTotal = lines.reduce((sum, line) => sum + line.amount, 0)
  return {
    venue: pad,
    metric: input.metric,
    requestedTarget: input.target,
    supplyControlPct,
    launchMarketCapUsd: launchMarketCap * input.assetPriceUsd,
    assetPriceUsd: input.assetPriceUsd,
    ...(pad.type === "amm" ? { initialLp } : {}),
    lines,
    capitalTotal,
    decimals: 2,
  }
}

export function defaultMmLiquidity(venueId: string) {
  const pad = launchPad(venueId)
  return pad ? budgetFor(pad).defaultMm : null
}

export function parseLaunchNumber(text: string) {
  const match = String(text || "").trim().toLowerCase().replace(/[$,%\s]/g, "").match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/)
  if (!match) return null
  const multipliers: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }
  const value = Number(match[1]) * (match[2] ? multipliers[match[2]] : 1)
  return Number.isFinite(value) ? value : null
}

function compactUsd(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return `$${Math.round(value).toLocaleString("en-US")}`
}

function nativeAmount(value: number, decimals: number) {
  return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")
}

function percentAmount(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

export function formatLaunchQuote(quote: LaunchQuote) {
  const symbol = quote.venue.symbol
  const heading = quote.initialLp
    ? [`Assuming a ${nativeAmount(quote.initialLp, 4)} ${symbol} initial LP:`]
    : []
  const firstLine = `Capital requirement: <b>${nativeAmount(quote.capitalTotal, quote.decimals)} ${symbol} total</b> — targeting <b>${percentAmount(quote.supplyControlPct)}% supply control</b> with an estimated <b>~${compactUsd(quote.launchMarketCapUsd)} launch MC</b>.`
  const breakdown = quote.lines.map((line) => `• ~${nativeAmount(line.amount, quote.decimals)} ${symbol} ${line.label}`)
  return [
    ...heading,
    firstLine,
    "",
    "Breakdown:",
    ...breakdown,
  ].join("\n")
}

export async function getLaunchAssetPrice(pad: LaunchPad, options: { testFixtureOnly?: boolean } = {}) {
  if (options.testFixtureOnly) {
    return {
      price: pad.fallbackUsd,
      source: "test fixture",
      fetchedAt: new Date(0).toISOString(),
    }
  }

  try {
    const response = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(pad.symbol)}-USD/spot`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    })
    const body = await response.json()
    const price = Number(body?.data?.amount)
    if (!response.ok || !(price > 0)) throw new Error("Invalid price response")
    return {
      price,
      source: "Coinbase",
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error(`[launch-calculator] Live ${pad.symbol}/USD price lookup failed`, error)
    throw new Error(`Live ${pad.symbol}/USD pricing is temporarily unavailable, so no estimate was generated. Please try again.`)
  }
}
