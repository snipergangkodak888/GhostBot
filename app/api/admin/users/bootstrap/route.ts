import { NextResponse } from 'next/server'
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

export async function GET(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '20', 10), 100) // Cap at 100
  const skip = (page - 1) * pageSize

  const db = await getDb()
  const usersCol = db.collection('users')
  const mergeScoresCol = db.collection('mergeScores')
  const referralsCol = db.collection('referrals')
  
  // Get users with pagination
  const [total, users] = await Promise.all([
    usersCol.estimatedDocumentCount(),
    usersCol
      .find({}, {
        projection: {
          telegramId: 1,
          firstName: 1,
          lastName: 1,
          username: 1,
          photoUrl: 1,
          isPremium: 1,
          planId: 1,
          coins: 1,
          createdAt: 1,
          isBanned: 1
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray(),
  ])

  // Enrich users with energy and referralsCount
  const enrichedUsers = await Promise.all(
    users.map(async (user) => {
      // Get energy from mergeScores
      const scoreDoc = await mergeScoresCol.findOne({ telegramId: user.telegramId })
      const energy = scoreDoc?.energy || 0

      // Count referrals made by this user
      const referralsCount = await referralsCol.countDocuments({ referrerId: user.telegramId }).catch(() => 0)

      return {
        ...user,
        energy,
        spinBalance: energy, // keep for backwards compat
        referralsCount,
      }
    })
  )

  return NextResponse.json({ page, pageSize, total, users: enrichedUsers })
}
