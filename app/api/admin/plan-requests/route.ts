import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')

    const filter: any = {}
    if (status) {
      filter.status = status
    }

    const db = await getDb()
    const planRequests = await db.collection('planRequests')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()

    // Populate user details
    const userIds = planRequests.map(r => r.userId)
    const users = await db.collection('users')
      .find({ _id: { $in: userIds } })
      .toArray()
    const usersMap = Object.fromEntries(users.map(u => [u._id.toString(), u]))

    // Populate plan details
    const planIds = planRequests.map(r => r.planId)
    const plans = await db.collection('plans')
      .find({ _id: { $in: planIds } })
      .toArray()
    const plansMap = Object.fromEntries(plans.map(p => [p._id.toString(), p]))

    // Populate payment method details
    const paymentMethodIds = planRequests.map(r => r.paymentMethodId).filter(Boolean)
    const paymentMethods = await db.collection('paymentMethods')
      .find({ _id: { $in: paymentMethodIds } })
      .toArray()
    const paymentMethodsMap = Object.fromEntries(paymentMethods.map(pm => [pm._id.toString(), pm]))

    const items = planRequests.map(request => ({
      ...request,
      user: usersMap[request.userId.toString()],
      plan: plansMap[request.planId.toString()],
      paymentMethod: request.paymentMethodId ? paymentMethodsMap[request.paymentMethodId.toString()] : null
    }))

    return NextResponse.json({ items })
  } catch (error) {
    console.error('Get plan requests error:', error)
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const body = await req.json()
  const doc = {
    ...body,
    // Normalize discount fields
    discountPercent: typeof body.discountPercent === 'number' ? body.discountPercent : (body.discountPercent ? Number(body.discountPercent) : null),
    discountAmount: typeof body.discountAmount === 'number' ? body.discountAmount : (body.discountAmount ? Number(body.discountAmount) : null),
    discountExpiresAt: body.discountExpiresAt ? new Date(body.discountExpiresAt) : null,
    status: body.status || 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('planRequests').insertOne(doc)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    const body = await req.json()
    
    if (!body.id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }
    
    const id = new ObjectId(body.id)
    const updateData: any = {
      updatedAt: new Date()
    }

    // Handle approval
    if (body.status === 'approved') {
      updateData.status = 'approved'
      updateData.reviewedAt = new Date()
      updateData.reviewedBy = body.reviewedBy || null
      // Keep discount info if included in PATCH to persist audit
      if (typeof body.discountPercent === 'number') updateData.discountPercent = body.discountPercent
      if (typeof body.discountAmount === 'number') updateData.discountAmount = body.discountAmount
      if (body.discountExpiresAt) updateData.discountExpiresAt = new Date(body.discountExpiresAt)

      // Get the request details
      const request = await db.collection('planRequests').findOne({ _id: id })
      if (!request) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 })
      }

      // Get plan details to determine duration
      const plan = await db.collection('plans').findOne({ _id: request.planId })
      if (!plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }

      // Calculate expiration date - check multiple possible field names
      // Priority: periodDays > durationDays > duration
      let durationDays = 30 // Default fallback
      if (plan.periodDays !== undefined && plan.periodDays !== null) {
        durationDays = Number(plan.periodDays)
      } else if (plan.durationDays !== undefined && plan.durationDays !== null) {
        durationDays = Number(plan.durationDays)
      } else if (plan.duration !== undefined && plan.duration !== null) {
        durationDays = Number(plan.duration)
      }

      console.log(`📋 Plan data:`, { 
        name: plan.name,
        periodDays: plan.periodDays,
        durationDays: plan.durationDays, 
        duration: plan.duration,
        calculatedDuration: durationDays 
      })

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + durationDays)

      console.log(`📅 Plan "${plan.name}" duration: ${durationDays} days, Expires at: ${expiresAt.toISOString()}`)

      // Create or update subscription
      await db.collection('subscriptions').updateOne(
        { userId: request.userId },
        {
          $set: {
            userId: request.userId,
            planId: request.planId,
            planName: plan.name,
            status: 'active',
            expiresAt: expiresAt,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      )

      console.log(`✅ Subscription activated for user ${request.userId}`)
    }

    // Handle rejection
    if (body.status === 'rejected') {
      updateData.status = 'rejected'
      updateData.reviewedAt = new Date()
      updateData.reviewedBy = body.reviewedBy || null
      updateData.rejectionReason = body.rejectionReason || null
    }

    // Update other fields if provided
    if (body.transactionProof !== undefined) {
      updateData.transactionProof = body.transactionProof
    }

    await db.collection('planRequests').updateOne(
      { _id: id },
      { $set: updateData }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Update plan request error:', error)
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
  }
}
