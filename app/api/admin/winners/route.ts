import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
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

export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const url = new URL(request.url)
  
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const search = url.searchParams.get('search') || ''
  
  const skip = (page - 1) * limit

  // Build match stage
  const matchStage: any = {}
  
  const pipeline: any[] = [
    { $sort: { wonAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    },
    { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
  ]

  // Add search filter if provided
  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'userInfo.username': { $regex: search, $options: 'i' } },
          { 'userInfo.firstName': { $regex: search, $options: 'i' } },
          { 'gift.name': { $regex: search, $options: 'i' } }
        ]
      }
    })
  }

  // Get total count
  const countPipeline = [...pipeline, { $count: 'total' }]
  const countResult = await db.collection('wonGifts').aggregate(countPipeline).toArray().catch(() => [])
  const totalCount = countResult[0]?.total || 0
  const totalPages = Math.ceil(totalCount / limit)

  // Add pagination
  pipeline.push(
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        wonAt: 1,
        gift: 1,
        firstName: '$userInfo.firstName',
        lastName: '$userInfo.lastName',
        username: '$userInfo.username',
        photoUrl: '$userInfo.photoUrl',
        telegramId: '$userInfo.telegramId'
      }
    }
  )

  const winners = await db.collection('wonGifts').aggregate(pipeline).toArray().catch(() => [])

  return NextResponse.json({
    winners,
    totalCount,
    totalPages,
    page,
    limit
  })
}
