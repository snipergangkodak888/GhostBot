import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Debug endpoint to verify client-side analytics initialization reports.
// GET: returns latest received status
// POST: stores a status snapshot from client
export async function GET() {
  try {
    const db = await getDb()
    const latest = await db
      .collection('tgAnalyticsDebugStatus')
      .find({})
      .sort({ createdAt: -1 })
      .limit(1)
      .next()

    const res = NextResponse.json({
      status: 'ok',
      hasClientReport: !!latest,
      latest: latest || null,
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

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const doc = {
      ...body,
      createdAt: new Date(),
      source: 'client-sdk-report',
    }

    const db = await getDb()
    await db.collection('tgAnalyticsDebugStatus').insertOne(doc)

    const res = NextResponse.json({ status: 'ok', saved: true })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    return res
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    )
  }
}
