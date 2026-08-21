type PriceQuote = {
  priceUsd: number
  priceTimestamp: string
  priceSource: "coingecko" | "defillama"
  priceFetchedAt: string
}

const COIN_IDS: Record<string, string> = {
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
}

const cache = new Map<string, { expiresAt: number; quote: PriceQuote }>()
const historicalSeriesCache = new Map<string, { expiresAt: number; prices: Array<{ timestamp: number; price: number }> }>()
const llamaCache = new Map<string, { expiresAt: number; quote: PriceQuote }>()

function coinGeckoConfig() {
  const key = String(process.env.COINGECKO_API_KEY || "").trim()
  const tier = String(process.env.COINGECKO_API_TIER || "demo").trim().toLowerCase()
  const baseUrl = String(process.env.COINGECKO_API_BASE_URL || (tier === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3")).replace(/\/$/, "")
  return { key, tier, baseUrl }
}

async function coinGecko(path: string) {
  const { key, tier, baseUrl } = coinGeckoConfig()
  const headers: Record<string, string> = { accept: "application/json" }
  if (key) headers[tier === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(6_000) })
  if (!response.ok) throw new Error(`CoinGecko price lookup failed (${response.status})`)
  return response.json()
}

function validDate(value: unknown) {
  const date = new Date(String(value || ""))
  return Number.isNaN(date.getTime()) ? null : date
}

async function currentQuote(asset: string, coinId: string, occurredAt: Date): Promise<PriceQuote> {
  const cacheKey = `current:${asset}:${Math.floor(occurredAt.getTime() / 60_000)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.quote
  const data = await coinGecko(`/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_last_updated_at=true&precision=full`)
  const priceUsd = Number(data?.[coinId]?.usd)
  const updatedAt = Number(data?.[coinId]?.last_updated_at) * 1_000
  if (!(priceUsd > 0) || !Number.isFinite(updatedAt) || Math.abs(updatedAt - occurredAt.getTime()) > 20 * 60_000) throw new Error("CoinGecko returned a stale price")
  const quote: PriceQuote = { priceUsd, priceTimestamp: new Date(updatedAt).toISOString(), priceSource: "coingecko", priceFetchedAt: new Date().toISOString() }
  cache.set(cacheKey, { expiresAt: Date.now() + 45_000, quote })
  return quote
}

async function historicalQuote(asset: string, coinId: string, occurredAt: Date): Promise<PriceQuote> {
  const hour = Math.floor(occurredAt.getTime() / 3_600_000)
  const cacheKey = `historical:${asset}:${hour}`
  const cached = historicalSeriesCache.get(cacheKey)
  let prices: Array<{ timestamp: number; price: number }> = cached && cached.expiresAt > Date.now() ? cached.prices : []
  if (!prices.length) {
    const center = hour * 3_600_000 + 30 * 60_000
    const from = Math.floor((center - 3 * 3_600_000) / 1_000)
    const to = Math.floor((center + 3 * 3_600_000) / 1_000)
    const data = await coinGecko(`/coins/${encodeURIComponent(coinId)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}&precision=full`)
    prices = (Array.isArray(data?.prices) ? data.prices : [])
      .map((row: any) => ({ timestamp: Number(row?.[0]), price: Number(row?.[1]) }))
      .filter((row: any) => Number.isFinite(row.timestamp) && row.price > 0)
    historicalSeriesCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, prices })
  }
  const nearest = [...prices]
    .sort((a: any, b: any) => Math.abs(a.timestamp - occurredAt.getTime()) - Math.abs(b.timestamp - occurredAt.getTime()))[0]
  if (!nearest) throw new Error("CoinGecko returned no historical price")
  const quote: PriceQuote = { priceUsd: nearest.price, priceTimestamp: new Date(nearest.timestamp).toISOString(), priceSource: "coingecko", priceFetchedAt: new Date().toISOString() }
  return quote
}

async function defillamaQuote(asset: string, coinId: string, occurredAt: Date): Promise<PriceQuote> {
  const timestamp = Math.floor(occurredAt.getTime() / 1_000)
  const bucket = Math.floor(timestamp / 300)
  const cacheKey = `${asset}:${bucket}`
  const cached = llamaCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.quote
  const coin = `coingecko:${coinId}`
  const response = await fetch(`https://coins.llama.fi/prices/historical/${timestamp}/${coin}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6_000),
  })
  if (!response.ok) throw new Error(`DefiLlama price lookup failed (${response.status})`)
  const data = await response.json()
  const row = data?.coins?.[coin]
  const priceUsd = Number(row?.price)
  const priceTimestamp = Number(row?.timestamp) * 1_000
  if (!(priceUsd > 0) || !Number.isFinite(priceTimestamp)) throw new Error("DefiLlama returned no historical price")
  const quote: PriceQuote = {
    priceUsd,
    priceTimestamp: new Date(priceTimestamp).toISOString(),
    priceSource: "defillama",
    priceFetchedAt: new Date().toISOString(),
  }
  llamaCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, quote })
  return quote
}

export async function receiptPriceQuote(assetInput: unknown, occurredAtInput: unknown): Promise<PriceQuote | null> {
  const asset = String(assetInput || "").toUpperCase()
  const occurredAt = validDate(occurredAtInput) || new Date()
  const coinId = COIN_IDS[asset]
  if (!coinId) return null
  const recent = Math.abs(Date.now() - occurredAt.getTime()) <= 15 * 60_000
  const coinGeckoQuote = () => recent ? currentQuote(asset, coinId, occurredAt) : historicalQuote(asset, coinId, occurredAt)
  if (coinGeckoConfig().key) {
    try { return await coinGeckoQuote() } catch { return defillamaQuote(asset, coinId, occurredAt) }
  }
  try { return await defillamaQuote(asset, coinId, occurredAt) } catch { return coinGeckoQuote() }
}

export async function valueRevenueReceipt<T extends Record<string, any>>(receipt: T): Promise<T> {
  const asset = String(receipt.asset || "").toUpperCase()
  const now = new Date().toISOString()
  if (asset === "USDC") {
    return { ...receipt, amountUsd: Number(receipt.amount || 0), valuationStatus: "valued", priceUsd: 1, priceSource: "stablecoin", priceTimestamp: receipt.blockTime || now, priceFetchedAt: now }
  }
  if (receipt.amountUsd != null) return receipt
  const quote = await receiptPriceQuote(asset, receipt.blockTime || receipt.createdAt || now)
  if (!quote) return receipt
  const amountUsd = Math.round((Number(receipt.amount || 0) * quote.priceUsd + Number.EPSILON) * 100) / 100
  return { ...receipt, ...quote, amountUsd, valuationStatus: "valued" }
}
