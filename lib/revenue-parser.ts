import type { ParsedFeeMessage } from "@/lib/revenue-types"

const ASSET_ALIASES: Record<string, string> = {
  dollar: "USD",
  dollars: "USD",
  usd: "USD",
  usdc: "USDC",
  sol: "SOL",
  solana: "SOL",
  eth: "ETH",
  ethereum: "ETH",
  bnb: "BNB",
}

function parseCompactNumber(raw: string) {
  const cleaned = String(raw || "").replace(/[$,\s]/g, "").toLowerCase()
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/)
  if (!match) return null
  const base = Number(match[1])
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1
  const value = base * multiplier
  return Number.isFinite(value) ? value : null
}

function normalizeAsset(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase()
  return ASSET_ALIASES[normalized] || (normalized ? normalized.toUpperCase() : null)
}

function amountMatches(text: string) {
  const patterns = [
    /(?:a\s+)?total\s+of\s+([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)?\s+was\s+withdrawn/i,
    /(?:gross|total|cashout)\s*(?:cashout|amount)?\s*[:=-]?\s*([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)/i,
    /(?:withdrawn|withdrew|removed)\s+([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)/i,
    /([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)\s+(?:was\s+)?withdrawn/i,
  ]
  return patterns.map((pattern) => text.match(pattern)).find(Boolean) || null
}

function explicitFixedFee(text: string, feeWords: RegExp) {
  const before = text.match(new RegExp(`([$]?\\s*[\\d,.]+(?:\\s*[kmb])?)\\s*(USDC|USD|SOL|ETH|BNB|dollars?)?[^\\n.]{0,48}${feeWords.source}`, "i"))
  const after = text.match(new RegExp(`${feeWords.source}[^\\n.]{0,48}?([$]?\\s*[\\d,.]+(?:\\s*[kmb])?)\\s*(USDC|USD|SOL|ETH|BNB|dollars?)?`, "i"))
  const match = before || after
  if (!match) return null
  const amount = parseCompactNumber(match[1])
  if (amount === null) return null
  return { amount, asset: normalizeAsset(match[2]) || "USD" }
}

export function parseFeeMessage(input: string): ParsedFeeMessage {
  const text = String(input || "").trim()
  const warnings: string[] = []
  const supply = text.match(/(\d+(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?supply/i)
  const ignoredSupplyPercentage = supply ? Number(supply[1]) : null

  const isLiquidation = /\bliq(?:uidation|uidations)?\b/i.test(text) || /\b5\s*%\s+(?:liq|fee)/i.test(text)
  const isDailyTrading = /\b(?:daily\s+)?trading\s+fee\b/i.test(text)
  const isLaunch = /\b(?:tge|launch)\s+fee\b/i.test(text)
  const isDevAllocation = /\bdev(?:eloper)?\s+all(?:o|ocation)\b/i.test(text)
  const isFeeCollector = /\bfee\s+collector\b/i.test(text)
  const isFeeRebate = /\b(?:fee\s+)?rebate\b/i.test(text)

  if (isLiquidation) {
    const gross = amountMatches(text)
    const grossAmount = gross ? parseCompactNumber(gross[1]) : null
    const grossAsset = gross ? normalizeAsset(gross[2]) : null
    if (grossAmount === null) warnings.push("Gross cashout amount was not found")
    if (!grossAsset) warnings.push("Cashout quote asset was not found")
    return {
      feeType: "liquidation",
      grossAmount,
      grossAsset,
      expectedAssetAmount: grossAmount === null ? null : grossAmount * 0.05,
      expectedUsd: grossAmount !== null && (grossAsset === "USD" || grossAsset === "USDC") ? grossAmount * 0.05 : null,
      ignoredSupplyPercentage,
      confidence: grossAmount !== null && grossAsset ? "high" : grossAmount !== null ? "medium" : "low",
      warnings,
    }
  }

  if (isDailyTrading) {
    const fixed = explicitFixedFee(text, /(?:daily\s+)?trading\s+fee/)
    const amount = fixed?.amount ?? 500
    const asset = fixed?.asset || "USD"
    if (!fixed) warnings.push("No explicit amount found; using the configured daily-fee default after project selection")
    return {
      feeType: "daily_trading",
      grossAmount: null,
      grossAsset: null,
      expectedAssetAmount: asset === "USD" ? null : amount,
      expectedUsd: asset === "USD" || asset === "USDC" ? amount : null,
      ignoredSupplyPercentage,
      confidence: fixed ? "high" : "medium",
      warnings,
    }
  }

  if (isLaunch) {
    const fixed = explicitFixedFee(text, /(?:tge|launch)\s+fee/)
    const amount = fixed?.amount ?? 1_000
    const asset = fixed?.asset || "USD"
    if (!fixed) warnings.push("No explicit cash amount found; using the configured launch-fee default after project selection")
    return {
      feeType: "launch",
      grossAmount: null,
      grossAsset: null,
      expectedAssetAmount: asset === "USD" ? null : amount,
      expectedUsd: asset === "USD" || asset === "USDC" ? amount : null,
      ignoredSupplyPercentage,
      confidence: fixed ? "high" : "medium",
      warnings,
    }
  }

  if (isDevAllocation) {
    const match = amountMatches(text) || text.match(/([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)/i)
    const amount = match ? parseCompactNumber(match[1]) : null
    const asset = match ? normalizeAsset(match[2]) : null
    if (amount === null) warnings.push("Dev-allocation proceeds were not found")
    return {
      feeType: "dev_allocation",
      grossAmount: null,
      grossAsset: null,
      expectedAssetAmount: amount,
      expectedUsd: amount !== null && (asset === "USD" || asset === "USDC") ? amount : null,
      ignoredSupplyPercentage,
      confidence: amount !== null && asset ? "high" : "low",
      warnings,
    }
  }

  if (isFeeCollector || isFeeRebate) {
    const match = text.match(/([$]?\s*[\d,.]+(?:\s*[kmb])?)\s*(USDC|USD|SOL|ETH|BNB|dollars?)/i)
    const amount = match ? parseCompactNumber(match[1]) : null
    const asset = match ? normalizeAsset(match[2]) : null
    return {
      feeType: isFeeRebate ? "fee_rebate" : "fee_collector",
      grossAmount: null,
      grossAsset: null,
      expectedAssetAmount: amount,
      expectedUsd: amount !== null && (asset === "USD" || asset === "USDC") ? amount : null,
      ignoredSupplyPercentage,
      confidence: amount !== null && asset ? "high" : "medium",
      warnings: amount == null ? ["Receipt amount is required"] : [],
    }
  }

  return {
    feeType: null,
    grossAmount: null,
    grossAsset: null,
    expectedAssetAmount: null,
    expectedUsd: null,
    ignoredSupplyPercentage,
    confidence: "low",
    warnings: ["Fee type was not recognized"],
  }
}

export function normalizedMessageFingerprint(text: string) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ")
}
