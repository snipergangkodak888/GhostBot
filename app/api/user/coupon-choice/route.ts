import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { resolveUserTelegramId } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/user/coupon-choice
 * Called when user picks Casino or Sports for a pending coupon trigger.
 * Body: { triggerLevel: number, chosenType: 'casino' | 'sports' }
 * Returns: { code, description, type }
 */
export async function POST(req: NextRequest) {
  try {
    const telegramId = await resolveUserTelegramId(req)
    if (!telegramId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { triggerLevel, chosenType } = body

    if (typeof triggerLevel !== 'number') {
      return NextResponse.json({ error: 'triggerLevel required' }, { status: 400 })
    }
    if (chosenType !== 'casino' && chosenType !== 'sports') {
      return NextResponse.json({ error: 'chosenType must be casino or sports' }, { status: 400 })
    }

    const db = await getDb()
    const now = new Date()

    // Find an available coupon of the chosen type for this trigger level
    const candidates = await db.collection('adminCoupons').find({
      triggerLevel,
      type: chosenType,
      active: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    } as any).toArray()

    const coupon = candidates.find((c: any) => {
      const alreadyAssigned = c.recipients?.some(
        (r: any) => r.telegramId === telegramId || r.telegramId === String(telegramId)
      )
      if (alreadyAssigned) return false
      if (c.maxRecipients !== null && c.usedCount >= c.maxRecipients) return false
      return true
    })

    if (!coupon) {
      return NextResponse.json({ error: 'No available coupon for chosen type' }, { status: 404 })
    }

    await db.collection('adminCoupons').updateOne(
      { _id: coupon._id },
      {
        $push: { recipients: { telegramId, assignedAt: now, source: `level_${triggerLevel}`, chosenType } } as any,
        $inc: { usedCount: 1 },
        $set: { updatedAt: now },
      }
    )

    return NextResponse.json({
      success: true,
      coupon: {
        code: coupon.code,
        description: coupon.description || '',
        type: chosenType,
        level: triggerLevel,
      }
    })
  } catch (error) {
    console.error('Coupon choice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
