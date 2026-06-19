import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

// POST create subscription request
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = user.id

  const body = await request.json()
  const { planId, paymentMethodId, transactionProof } = body

    if (!planId || !paymentMethodId) {
      return NextResponse.json(
        { error: 'Plan and payment method are required' },
        { status: 400 }
      )
    }

    // Only block duplicates when there is already a PENDING request for the same plan.
    // Approved requests will NOT block a new request (user may want to re-subscribe or switch back to this plan).
    const existingPending = await withDb(async (db) => {
      return await db.collection('planRequests').findOne({
        userId: new ObjectId(userId),
        planId: new ObjectId(planId),
        status: 'pending'
      })
    })

    if (existingPending) {
      return NextResponse.json(
        { error: 'You already have a pending request for this plan' },
        { status: 400 }
      )
    }

    // Optional discount fields (e.g., from Spin Wheel)
    const discountPercent = typeof body.discountPercent === 'number' ? body.discountPercent : undefined
    const discountAmount = typeof body.discountAmount === 'number' ? body.discountAmount : undefined
    const discountExpiresAt = body.discountExpiresAt ? new Date(body.discountExpiresAt) : undefined

    const planRequest = {
      userId: new ObjectId(userId),
      planId: new ObjectId(planId),
      paymentMethodId: new ObjectId(paymentMethodId),
      transactionProof: transactionProof || null,
      // Store discount details if provided
      discountPercent: discountPercent ?? null,
      discountAmount: discountAmount ?? null,
      discountExpiresAt: discountExpiresAt ?? null,
      status: 'pending', // 'pending', 'approved', 'rejected'
      createdAt: new Date(),
      updatedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null
    }

    const result = await withDb(async (db) => {
      return await db.collection('planRequests').insertOne(planRequest)
    })

    return NextResponse.json({ 
      success: true,
      requestId: result.insertedId
    })
  } catch (error: any) {
    console.error('Create plan request error:', error)
    return NextResponse.json(
      { error: 'Failed to create subscription request' },
      { status: 500 }
    )
  }
}

// GET user's plan requests
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = user.id

    const requests = await withDb(async (db) => {
      const planRequests = await db.collection('planRequests')
        .find({ userId: new ObjectId(userId) })
        .sort({ createdAt: -1 })
        .toArray()

      // Populate plan details
      const planIds = planRequests.map(r => r.planId)
      const plans = await db.collection('plans')
        .find({ _id: { $in: planIds } })
        .toArray()
      
      const plansMap = Object.fromEntries(plans.map(p => [p._id.toString(), p]))

      // Populate payment method details (only for requests that have paymentMethodId)
      const paymentMethodIds = planRequests
        .filter(r => r.paymentMethodId)
        .map(r => r.paymentMethodId)
      
      const paymentMethods = paymentMethodIds.length > 0
        ? await db.collection('paymentMethods')
            .find({ _id: { $in: paymentMethodIds } })
            .toArray()
        : []
      
      const paymentMethodsMap = Object.fromEntries(paymentMethods.map(pm => [pm._id.toString(), pm]))

      return planRequests.map(request => ({
        ...request,
        plan: plansMap[request.planId.toString()],
        paymentMethod: request.paymentMethodId 
          ? paymentMethodsMap[request.paymentMethodId.toString()] 
          : null
      }))
    })

    return NextResponse.json({ requests })
  } catch (error: any) {
    console.error('Get plan requests error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch requests' },
      { status: 500 }
    )
  }
}
