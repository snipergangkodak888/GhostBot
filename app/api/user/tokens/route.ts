import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { resolveUserTelegramId } from '@/lib/auth'

// GET /api/user/tokens - Get user's token balance
export async function GET(req: NextRequest) {
  try {
    const telegramId = await resolveUserTelegramId(req)
    if (!telegramId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    const userTokens = db.collection('userTokens')

    let tokens = await userTokens.findOne({ telegramId })

    // Create default tokens record if not exists
    if (!tokens) {
      const newTokens = {
        telegramId,
        totalTokens: 0,
        idleTokens: 0,
        mineTokens: 0,
        holdTokens: 0,
        adTokens: 0,
        taskTokens: 0,
        referralTokens: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await userTokens.insertOne(newTokens)
      tokens = newTokens
    }

    return NextResponse.json({ success: true, tokens })
  } catch (error: any) {
    console.error('[API] Get tokens error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/user/tokens/add - Add tokens to user balance
export async function POST(req: NextRequest) {
  try {
    const telegramId = await resolveUserTelegramId(req)
    if (!telegramId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { amount, source } = await req.json()
    
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const validSources = ['idle', 'mine', 'hold', 'ad', 'task', 'referral']
    if (!validSources.includes(source)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }

    const db = await getDb()
    const userTokens = db.collection('userTokens')

    const sourceField = `${source}Tokens`
    
    const result = await userTokens.findOneAndUpdate(
      { telegramId },
      {
        $inc: {
          totalTokens: amount,
          [sourceField]: amount,
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    )

    return NextResponse.json({ 
      success: true, 
      tokens: result,
      added: amount,
      source 
    })
  } catch (error: any) {
    console.error('[API] Add tokens error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
