import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// GET /api/admin/gift-withdrawals - Get all gift withdrawal requests
export async function GET(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') // pending, approved, completed, rejected
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const db = await getDb()
    const giftWithdrawalsCollection = db.collection('giftWithdrawals')

    // Build filter
    const filter: Record<string, unknown> = {}
    if (status && status !== 'all') {
      filter.status = status
    }

    const skip = (page - 1) * limit

    const [withdrawals, total] = await Promise.all([
      giftWithdrawalsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      giftWithdrawalsCollection.countDocuments(filter)
    ])

    // Get stats
    const [pendingCount, approvedCount, completedCount, rejectedCount] = await Promise.all([
      giftWithdrawalsCollection.countDocuments({ status: 'pending' }),
      giftWithdrawalsCollection.countDocuments({ status: 'approved' }),
      giftWithdrawalsCollection.countDocuments({ status: 'completed' }),
      giftWithdrawalsCollection.countDocuments({ status: 'rejected' }),
    ])

    return NextResponse.json({
      success: true,
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        completed: completedCount,
        rejected: rejectedCount,
        total: pendingCount + approvedCount + completedCount + rejectedCount
      }
    })
  } catch (error: any) {
    console.error('[API] Get admin gift withdrawals error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/admin/gift-withdrawals - Update withdrawal status
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { withdrawalId, status, adminNote } = await req.json()

    if (!withdrawalId || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const validStatuses = ['pending', 'approved', 'completed', 'rejected']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const db = await getDb()
    const giftWithdrawalsCollection = db.collection('giftWithdrawals')
    const wonGiftsCollection = db.collection('wonGifts')

    const withdrawal = await giftWithdrawalsCollection.findOne({ _id: new ObjectId(withdrawalId) })
    if (!withdrawal) {
      return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 })
    }

    // Update withdrawal status
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    }
    if (adminNote !== undefined) {
      updateData.adminNote = adminNote
    }
    if (status === 'completed') {
      updateData.completedAt = new Date()
    }

    await giftWithdrawalsCollection.updateOne(
      { _id: new ObjectId(withdrawalId) },
      { $set: updateData }
    )

    // If rejected, allow user to request again
    if (status === 'rejected') {
      await wonGiftsCollection.updateOne(
        { _id: withdrawal.wonGiftId },
        { $set: { withdrawalRequested: false }, $unset: { withdrawalId: '' } }
      )
    }

    return NextResponse.json({ 
      success: true, 
      message: `Withdrawal ${status}` 
    })
  } catch (error: any) {
    console.error('[API] Update gift withdrawal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
