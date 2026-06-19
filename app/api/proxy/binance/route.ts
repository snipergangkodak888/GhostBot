import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side proxy for gold price data via Bybit API
 * Uses XAUTUSDT (Tether Gold — tracks gold price 1:1)
 * Tries multiple Bybit API domains for resilience against geo-blocking
 * 
 * Bybit interval format: 1, 5, 15, 60, 240, D
 */
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
}

// Multiple Bybit API domains to try (some may be geo-blocked from cloud IPs)
const BYBIT_DOMAINS = [
  'https://api.bytick.com',    // Mirror domain, less likely to be blocked
  'https://api.bybit.com',     // Primary domain
]

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // Map XAUUSDT -> XAUTUSDT (Bybit uses Tether Gold symbol)
  let symbol = searchParams.get('symbol') || 'XAUTUSDT'
  if (symbol === 'XAUUSDT') symbol = 'XAUTUSDT'
  
  const interval = searchParams.get('interval') || '15m'
  const limit = searchParams.get('limit') || '120'

  const bybitInterval = INTERVAL_MAP[interval.toLowerCase()] || '15'

  let lastError: any = null

  for (const domain of BYBIT_DOMAINS) {
    try {
      const url = `${domain}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${bybitInterval}&limit=${encodeURIComponent(limit)}`
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MetalGame/1.0',
        },
        next: { revalidate: 5 },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        console.warn(`[Gold Proxy] ${domain} returned ${response.status}, trying next...`)
        lastError = { status: response.status, domain }
        continue
      }

      const json = await response.json()

      if (json.retCode !== 0) {
        console.warn(`[Gold Proxy] ${domain} API error: ${json.retMsg}`)
        lastError = { msg: json.retMsg, domain }
        continue
      }

      // Transform Bybit format to chart-compatible format
      // Bybit: [startTime, open, high, low, close, volume, turnover] (newest first)
      // Output: [openTime, open, high, low, close, volume] (oldest first)
      const candles = (json.result?.list || [])
        .reverse()
        .map((d: string[]) => [
          parseInt(d[0]),  // openTime (ms)
          d[1],            // open
          d[2],            // high
          d[3],            // low
          d[4],            // close
          d[5],            // volume
        ])

      return NextResponse.json(candles, {
        headers: {
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
        },
      })
    } catch (error: any) {
      console.warn(`[Gold Proxy] ${domain} error: ${error.message}`)
      lastError = error
      continue
    }
  }

  // All domains failed — try CoinGecko as ultimate fallback
  try {
    const daysMap: Record<string, string> = { '1m': '1', '5m': '1', '15m': '1', '1h': '7', '4h': '30', '1d': '90' }
    const days = daysMap[interval.toLowerCase()] || '1'
    
    const cgResponse = await fetch(
      `https://api.coingecko.com/api/v3/coins/tether-gold/ohlc?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(5000) }
    )
    
    if (cgResponse.ok) {
      const cgData = await cgResponse.json()
      // CoinGecko: [timestamp, open, high, low, close]
      const candles = cgData.map((d: number[]) => [
        d[0],           // timestamp (ms)
        String(d[1]),   // open
        String(d[2]),   // high
        String(d[3]),   // low
        String(d[4]),   // close
        '0',            // volume (not provided by CoinGecko)
      ])

      return NextResponse.json(candles, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      })
    }
  } catch (cgError) {
    console.error('[Gold Proxy] CoinGecko fallback also failed:', cgError)
  }

  console.error('[Gold Proxy] All providers failed. Last error:', lastError)
  return NextResponse.json(
    { error: 'Failed to fetch gold price data from all providers' },
    { status: 502 }
  )
}
