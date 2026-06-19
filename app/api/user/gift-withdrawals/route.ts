import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/user/gift-withdrawals - Get user's gift withdrawal requests
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    const giftWithdrawalsCollection = db.collection('giftWithdrawals')

    const withdrawals = await giftWithdrawalsCollection
      .find({ telegramId: user.telegramId })
      .sort({ createdAt: -1 })
      .toArray()

    return NextResponse.json({ success: true, withdrawals })
  } catch (error: any) {
    console.error('[API] Get gift withdrawals error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/user/gift-withdrawals - Request a gift withdrawal
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wonGiftId, gift, walletAddress } = await req.json()

    if (!wonGiftId || !gift) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const db = await getDb()
    const giftWithdrawalsCollection = db.collection('giftWithdrawals')
    const wonGiftsCollection = db.collection('wonGifts')

    // Check if withdrawal already exists for this gift
    const existingWithdrawal = await giftWithdrawalsCollection.findOne({
      wonGiftId: new ObjectId(wonGiftId),
      status: { $in: ['pending', 'approved'] }
    })

    if (existingWithdrawal) {
      return NextResponse.json({ error: 'Withdrawal already requested for this gift' }, { status: 400 })
    }

    // Create withdrawal request
    const withdrawal = {
      telegramId: user.telegramId,
      username: user.username || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      wonGiftId: new ObjectId(wonGiftId),
      gift: {
        _id: gift._id,
        giftId: gift.giftId,
        name: gift.name,
        priceInTon: gift.priceInTon,
        starCount: gift.starCount,
        thumbnailUrl: gift.thumbnailUrl || gift.customImage,
        sticker: gift.sticker,
      },
      walletAddress: walletAddress || null,
      status: 'pending', // pending, approved, completed, rejected
      adminNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await giftWithdrawalsCollection.insertOne(withdrawal)

    // Update won gift to mark as withdrawal requested
    await wonGiftsCollection.updateOne(
      { _id: new ObjectId(wonGiftId) },
      { $set: { withdrawalRequested: true, withdrawalId: result.insertedId } }
    )

    return NextResponse.json({ 
      success: true, 
      withdrawal: { ...withdrawal, _id: result.insertedId } 
    })
  } catch (error: any) {
    console.error('[API] Create gift withdrawal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
