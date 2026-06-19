import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Returns latest custom auth events sent to TG Analytics from backend.
// Query params:
// - limit (default 20, max 200)
// - userId (optional number)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limitRaw = Number(searchParams.get('limit') || 20)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 20
    const userIdRaw = searchParams.get('userId')

    const filter: Record<string, unknown> = {}
    if (userIdRaw && /^\d+$/.test(userIdRaw)) {
      filter.userId = Number(userIdRaw)
    }

    const db = await getDb()
    const items = await db
      .collection('tgAnalyticsAuthEvents')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    const latest = items[0] || null
    const successCount = items.filter((i: any) => i?.ok).length
    const failedCount = items.length - successCount

    const res = NextResponse.json({
      status: 'ok',
      count: items.length,
      successCount,
      failedCount,
      latest,
      items,
    })

    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')

    return res
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
