import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// GET /api/user/withdrawals - Get user's withdrawal requests
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    const withdrawalRequests = db.collection('withdrawalRequests')

    const requests = await withdrawalRequests
      .find({ telegramId: user.telegramId })
      .sort({ createdAt: -1 })
      .toArray()

    return NextResponse.json({
      success: true,
      withdrawals: requests,
    })
  } catch (error: any) {
    console.error('[API] Get withdrawals error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/user/withdrawals - Create withdrawal request
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { walletAddress, amount } = await req.json()

    if (!walletAddress || !amount) {
      return NextResponse.json({ error: 'Wallet address and amount required' }, { status: 400 })
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const db = await getDb()
    const userTokens = db.collection('userTokens')
    const withdrawalRequests = db.collection('withdrawalRequests')
    const settings = db.collection('settings')

    // Get airdrop settings
    const airdropSettingsDoc = await settings.findOne({ key: 'airdropSettings' })
    const airdropSettings = airdropSettingsDoc?.value || {
      withdrawalFeeEnabled: false,
      withdrawalFee: 0,
      minimumWithdrawal: 1000,
    }

    // Check minimum withdrawal
    if (amount < airdropSettings.minimumWithdrawal) {
      return NextResponse.json({
        error: `Minimum withdrawal is ${airdropSettings.minimumWithdrawal} tokens`,
      }, { status: 400 })
    }

    // Get user tokens
    const tokens = await userTokens.findOne({ telegramId: user.telegramId })

    if (!tokens || tokens.totalTokens < amount) {
      return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 })
    }

    // Calculate fee
    const fee = airdropSettings.withdrawalFeeEnabled ? airdropSettings.withdrawalFee : 0
    const totalRequired = amount + fee

    if (tokens.totalTokens < totalRequired) {
      return NextResponse.json({ error: 'Insufficient tokens for fee' }, { status: 400 })
    }

    const now = new Date()

    // Create withdrawal request
    const request = {
      telegramId: user.telegramId,
      walletAddress,
      amount,
      fee,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }

    await withdrawalRequests.insertOne(request)

    // Deduct tokens (including fee)
    await userTokens.updateOne(
      { telegramId: user.telegramId },
      {
        $inc: { totalTokens: -totalRequired },
        $set: { updatedAt: now },
      }
    )

    return NextResponse.json({
      success: true,
      request,
      tokensDeducted: totalRequired,
    })
  } catch (error: any) {
    console.error('[API] Create withdrawal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
