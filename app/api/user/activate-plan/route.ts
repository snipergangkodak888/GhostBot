import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

/**
 * Backup endpoint to manually activate approved plans
 * NOWPayments webhook already activates immediately, but this serves as a fallback
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const db = await getDb()
    const now = new Date()

    // Find the latest approved plan request that hasn't been activated
    const approvedRequest = await db.collection('planRequests').findOne(
      {
        userId: new ObjectId(userId),
        status: 'approved',
        activatedAt: { $exists: false }
      },
      { sort: { approvedAt: -1 } }
    )

    if (!approvedRequest) {
      return NextResponse.json(
        { error: 'No approved plan request found' },
        { status: 404 }
      )
    }

    // Get plan details
    const plan = await db.collection('plans').findOne({ _id: approvedRequest.planId })
    
    if (!plan) {
      return NextResponse.json(
        { error: 'Plan not found' },
        { status: 404 }
      )
    }

    // Calculate expiration date
    const durationDays = plan.duration || plan.periodDays || plan.durationDays || 30
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + durationDays)

    // Activate the subscription
    const subscription = {
      planId: approvedRequest.planId,
      name: plan.name,
      status: 'active',
      startedAt: now,
      expiresAt: expiresAt,
      autoRenew: false
    }

    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          subscription: subscription,
          updatedAt: now
        }
      }
    )

    // Mark plan request as activated
    await db.collection('planRequests').updateOne(
      { _id: approvedRequest._id },
      {
        $set: {
          activatedAt: now,
          updatedAt: now
        }
      }
    )

    console.log(`✅ User ${userId} manually activated plan: ${plan.name}`)

    return NextResponse.json({
      success: true,
      subscription: subscription,
      message: 'Plan activated successfully'
    })

  } catch (error: any) {
    console.error('❌ Plan activation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to activate plan' },
      { status: 500 }
    )
  }
}
