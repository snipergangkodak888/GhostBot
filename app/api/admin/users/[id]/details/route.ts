import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

const TELEGRAM_API = 'https://api.telegram.org'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// Fetch user's profile photo URL from Telegram API
async function fetchProfilePhotoUrl(telegramId: number, token: string): Promise<string | null> {
  try {
    // Get user profile photos
    const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos?user_id=${telegramId}&limit=1`)
    const photosData = await photosRes.json()
    
    if (!photosData.ok || !photosData.result?.photos?.[0]?.[0]) {
      return null
    }
    
    // Get the smallest size (first item) for efficiency
    const fileId = photosData.result.photos[0][0].file_id
    
    // Get file path
    const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json()
    
    if (!fileData.ok || !fileData.result?.file_path) {
      return null
    }
    
    // Return the full URL
    return `${TELEGRAM_API}/file/bot${token}/${fileData.result.file_path}`
  } catch (error) {
    console.error('⚠️ Error fetching profile photo:', error)
    return null
  }
}

// GET - Get comprehensive user details for admin modal
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    const userId = params.id

    // Get user basic info
    let user = await db.collection('users').findOne({ _id: new ObjectId(userId) })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const telegramId = user.telegramId
    
    // Refresh profile photo from Telegram API
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (botToken && telegramId) {
      const telegramIdNum = typeof telegramId === 'number' ? telegramId : parseInt(String(telegramId))
      const freshPhotoUrl = await fetchProfilePhotoUrl(telegramIdNum, botToken)
      if (freshPhotoUrl && freshPhotoUrl !== user.photoUrl) {
        // Update user's photo in database
        await db.collection('users').updateOne(
          { _id: new ObjectId(userId) },
          { $set: { photoUrl: freshPhotoUrl } }
        )
        user = { ...user, photoUrl: freshPhotoUrl }
        console.log('📷 Admin: Updated user photo for', telegramId)
      }
    }

    // Get user energy from mergeScores
    const mergeScore = await db.collection('mergeScores').findOne({ telegramId }) || { energy: 0 }
    const userEnergy = mergeScore.energy || 0

    // Get user gifts (won from spins) - uses userId (ObjectId) not telegramId
    const gifts = await db.collection('wonGifts').find({ userId: new ObjectId(userId) }).sort({ wonAt: -1 }).limit(50).toArray()
    
    // Count non-withdrawn gifts for collection badge
    const nonWithdrawnGiftsCount = await db.collection('wonGifts').countDocuments({ 
      userId: new ObjectId(userId), 
      status: { $ne: 'withdrawn' } 
    })

    // Get gift withdrawal requests
    const giftWithdrawals = await db.collection('giftWithdrawals').find({ telegramId }).sort({ createdAt: -1 }).limit(20).toArray()

    // Get purchase history
    const purchases = await db.collection('payments').find({ 
      $or: [
        { telegramId },
        { 'metadata.telegramId': telegramId }
      ]
    }).sort({ createdAt: -1 }).limit(20).toArray()

    // Get task completions
    const taskCompletions = await db.collection('taskCompletions').find({ telegramId }).sort({ completedAt: -1 }).limit(30).toArray()
    
    // Enrich with task info
    const taskIds = taskCompletions.map(tc => tc.taskId)
    const tasks = await db.collection('tasks').find({ taskId: { $in: taskIds } }).toArray()
    const taskMap = tasks.reduce((acc: any, t: any) => { acc[t.taskId] = t; return acc }, {})
    const enrichedTasks = taskCompletions.map(tc => ({
      ...tc,
      task: taskMap[tc.taskId] || { title: tc.taskId, reward: 0 }
    }))

    // Get referral info
    const referrals = await db.collection('referrals').find({ referrerId: telegramId }).toArray()
    const referralCommissions = await db.collection('referralCommissions').find({ referrerId: telegramId }).sort({ createdAt: -1 }).limit(50).toArray()
    
    const totalReferralEarnings = referralCommissions.reduce((sum: number, rc: any) => sum + (rc.commission || 0), 0)

    // Get streak data
    // Streak: telegramId may be stored as string in streaks collection (written from HTTP header)
    const telegramIdStr = String(telegramId)
    const telegramIdNum = typeof telegramId === 'number' ? telegramId : parseInt(String(telegramId))
    const streakDoc = await db.collection('streaks').findOne({
      $or: [{ telegramId: telegramIdStr }, { telegramId: telegramIdNum }]
    }) || { streak: 0, lastClaim: null, totalClaimed: 0 }

    // Get merge game state (board items, score, highestLevel, dailyStreak)
    const mergeDoc = mergeScore // already fetched above
    const boardGrid: any[][] = mergeDoc?.grid || [] // grid is the correct field name
    // Flatten board to get current items with level + quantity
    const itemMap: Record<number, number> = {}
    if (Array.isArray(boardGrid)) {
      boardGrid.flat().forEach((cell: any) => {
        if (cell && typeof cell.level === 'number') {
          itemMap[cell.level] = (itemMap[cell.level] || 0) + 1
        }
      })
    }
    const currentItems = Object.entries(itemMap).map(([level, qty]) => ({ level: Number(level), quantity: qty })).sort((a, b) => b.level - a.level)

    // Get leaderboard ranking based on mergeScores.score
    const userScore = mergeDoc?.score || 0
    const usersAboveByScore = await db.collection('mergeScores').countDocuments({ score: { $gt: userScore } })
    const rank = usersAboveByScore + 1

    // Get coupons/promo codes given to this user
    const userCoupons = await db.collection('adminCoupons')
      .find({ assignedTo: telegramId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    // Also check coupons redeemed by this user
    const redeemedCoupons = await db.collection('adminCoupons')
      .find({ redeemedBy: telegramId })
      .sort({ redeemedAt: -1 })
      .limit(20)
      .toArray()

    // Merge and deduplicate
    const allCouponIds = new Set<string>()
    const allCoupons = [...userCoupons, ...redeemedCoupons].filter(c => {
      const id = c._id.toString()
      if (allCouponIds.has(id)) return false
      allCouponIds.add(id)
      return true
    })

    // Get last online from users.lastActive
    const lastOnline = user.lastActive || user.updatedAt || null

    // Get leaderboard rank
    const leaderboardRank = rank

    // Get ad watch stats - telegramId is stored as number in adRewards (reuse telegramIdNum already defined above)
    const adStats = await db.collection('adRewards').aggregate([
      { $match: { telegramId: telegramIdNum } },
      { $group: { _id: null, total: { $sum: 1 }, totalEnergyEarned: { $sum: { $ifNull: ['$energyEarned', '$spinsEarned', '$tokensEarned'] } } } }
    ]).toArray()

    return NextResponse.json({
      user: {
        ...user,
        telegramId,
        lastOnline,
      },
      spins: {
        total: userEnergy,
        used: 0,
        available: userEnergy,
        breakdown: { tasks: 0, ads: 0, referrals: 0, purchased: 0, bonus: 0 },
      },
      mergeGame: {
        score: mergeDoc?.score || 0,
        highestLevel: mergeDoc?.highestLevel || 0,
        energy: userEnergy,
        dailyStreak: mergeDoc?.dailyStreak || 0,
        currentItems,
      },
      streak: {
        current: streakDoc.streak || 0,
        lastClaim: streakDoc.lastClaim || null,
        totalClaimed: streakDoc.totalClaimed || 0,
      },
      gifts: gifts.map((g: any) => ({
        _id: g._id,
        giftId: g.gift?.giftId || g.giftId,
        giftName: g.gift?.name || g.gift?.giftName || g.giftName,
        giftIcon: g.gift?.customImage || g.gift?.thumbnailUrl || g.gift?.stickerUrl || g.gift?.giftIcon || g.giftIcon || g.stickerUrl,
        priceInTon: g.gift?.priceInTon || 0,
        starCount: g.gift?.starCount || 0,
        status: g.status || 'won',
        wonAt: g.wonAt || g.createdAt,
      })),
      withdrawals: giftWithdrawals.map((w: any) => ({
        _id: w._id,
        giftName: w.gift?.name || 'Unknown Gift',
        giftImage: w.gift?.thumbnailUrl || w.gift?.customImage,
        giftId: w.gift?.giftId,
        priceInTon: w.gift?.priceInTon || 0,
        status: w.status,
        createdAt: w.createdAt,
        completedAt: w.completedAt,
      })),
      purchases: purchases.map((p: any) => ({
        _id: p._id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        type: p.type || 'spins',
        createdAt: p.createdAt,
      })),
      taskCompletions: enrichedTasks.map((tc: any) => ({
        _id: tc._id,
        taskId: tc.taskId,
        taskTitle: tc.task?.title || tc.taskId,
        reward: tc.task?.reward || 0,
        completedAt: tc.completedAt,
      })),
      referrals: {
        total: referrals.length,
        totalEarnings: totalReferralEarnings,
        recent: referralCommissions.slice(0, 10).map((rc: any) => ({
          referredId: rc.referredId,
          commission: rc.commission,
          source: rc.source,
          createdAt: rc.createdAt,
        })),
      },
      leaderboard: {
        rank: leaderboardRank,
        score: mergeDoc?.score || 0,
        highestLevel: mergeDoc?.highestLevel || 0,
        isTopThree: leaderboardRank <= 3,
        isTopOne: leaderboardRank === 1,
      },
      collection: {
        nonWithdrawnCount: nonWithdrawnGiftsCount,
        totalCount: gifts.length,
      },
      coupons: allCoupons.map((c: any) => ({
        _id: c._id,
        code: c.code,
        description: c.description || '',
        discount: c.discount || 0,
        discountType: c.discountType || 'fixed',
        assignedTo: c.assignedTo,
        redeemedBy: c.redeemedBy,
        redeemedAt: c.redeemedAt || null,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt || null,
        isRedeemed: !!c.redeemedBy,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch user details:', error)
    return NextResponse.json({ error: 'Failed to fetch user details' }, { status: 500 })
  }
}
