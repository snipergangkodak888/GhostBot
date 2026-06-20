import { NextResponse } from 'next/server'
import { withDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Public endpoint: returns active payment methods for user-facing clients (no secrets)
export async function GET() {
  try {
    const paymentMethods = await withDb(async (db) => {
      return await db
        .collection('paymentMethods')
        .find({ $or: [{ isActive: { $exists: false } }, { isActive: { $ne: false } }] })
        .project({ secret: 0 })
        .sort({ order: 1, createdAt: -1 })
        .toArray()
    })

    const res = NextResponse.json({ paymentMethods })
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (error: any) {
    console.error('Public payment methods error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch payment methods' },
      { status: 500 }
    )
  }
}
