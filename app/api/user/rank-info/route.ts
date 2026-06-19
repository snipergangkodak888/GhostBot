import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Telegram ID is required' },
        { status: 401 }
      )
    }

    const db = await getDb()
    
    // Fetch user's total tokens
    const userTokens = await db
      .collection('userTokens')
      .findOne({ telegramId: user.telegramId })
    
    const totalTokens = userTokens?.totalTokens || 0
    
    // Fetch all rank tiers sorted by requiredTokens
    const rankTiers = await db
      .collection('rankTiers')
      .find({ active: true })
      .sort({ requiredTokens: 1 })
      .toArray()
    
    // Determine current tier
    let currentTier = null
    let nextTier = null
    
    for (let i = 0; i < rankTiers.length; i++) {
      if (totalTokens >= rankTiers[i].requiredTokens) {
        currentTier = rankTiers[i]
        nextTier = rankTiers[i + 1] || null
      } else {
        if (!currentTier) {
          nextTier = rankTiers[i]
        }
        break
      }
    }
    
    // Calculate progress percentage
    let progress = 0
    if (currentTier && nextTier) {
      const tokensIntoTier = totalTokens - currentTier.requiredTokens
      const tokensNeededForNext = nextTier.requiredTokens - currentTier.requiredTokens
      progress = Math.min(100, (tokensIntoTier / tokensNeededForNext) * 100)
    } else if (!currentTier && nextTier) {
      // User hasn't reached first tier yet
      progress = Math.min(100, (totalTokens / nextTier.requiredTokens) * 100)
    } else if (currentTier && !nextTier) {
      // User is at max tier
      progress = 100
    }
    
    // Calculate leaderboard position
    const usersAbove = await db
      .collection('userTokens')
      .countDocuments({ totalTokens: { $gt: totalTokens } })
    
    const leaderboardPosition = usersAbove + 1
    
    return NextResponse.json({
      currentTier,
      nextTier,
      progress: Math.round(progress),
      leaderboardPosition,
      totalTokens
    })
  } catch (error) {
    console.error('Error fetching rank info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rank information' },
      { status: 500 }
    )
  }
}
