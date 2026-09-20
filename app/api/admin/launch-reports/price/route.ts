import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const token = cookies().get('admin_token')?.value
  try { if (!token || (await verifyAdminToken(token)).role !== 'admin') throw new Error('Unauthorized') } catch { return NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401 }) }
  const symbol = new URL(req.url).searchParams.get('symbol')?.toUpperCase() || ''
  if (!['SOL', 'ETH', 'BNB', 'USDC', 'USDT'].includes(symbol)) return NextResponse.json({ error: 'Enter a dated USD price for this quote token.' }, { status: 400 })
  try {
    const url = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('Price service is unavailable. Enter a price manually or use native values.')
    const body = await response.json()
    const price = String(body.data?.amount || '')
    if (price.length > 120 || !/^\d+(\.\d+)?$/.test(price) || !Number.isFinite(Number(price)) || !(Number(price) > 0)) throw new Error('Price service returned an invalid quote.')
    return NextResponse.json({ symbol, price, asOf: new Date(response.headers.get('date') || Date.now()).toISOString(), source: 'Coinbase spot', url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not refresh the price.' }, { status: 503 }) }
}
