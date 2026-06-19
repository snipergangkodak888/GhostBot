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
  const status = url.searchParams.get('status') || ''
  
  const skip = (page - 1) * limit

  const pipeline: any[] = [
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    },
    { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'plans',
        localField: 'planId',
        foreignField: '_id',
        as: 'planInfo'
      }
    },
    { $unwind: { path: '$planInfo', preserveNullAndEmptyArrays: true } },
  ]

  // Add status filter
  if (status) {
    pipeline.push({ $match: { status } })
  }

  // Add search filter if provided
  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'userInfo.username': { $regex: search, $options: 'i' } },
          { 'userInfo.firstName': { $regex: search, $options: 'i' } },
          { 'planInfo.name': { $regex: search, $options: 'i' } }
        ]
      }
    })
  }

  // Get total count
  const countPipeline = [...pipeline, { $count: 'total' }]
  const countResult = await db.collection('planRequests').aggregate(countPipeline).toArray().catch(() => [])
  const totalCount = countResult[0]?.total || 0
  const totalPages = Math.ceil(totalCount / limit)

  // Add pagination
  pipeline.push(
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        userId: 1,
        planId: 1,
        status: 1,
        reviewedAt: 1,
        createdAt: 1,
        paymentMethod: 1,
        discountPercent: 1,
        discountAmount: 1,
        user: {
          firstName: '$userInfo.firstName',
          lastName: '$userInfo.lastName',
          username: '$userInfo.username',
          photoUrl: '$userInfo.photoUrl',
          telegramId: '$userInfo.telegramId'
        },
        plan: {
          name: '$planInfo.name',
          price: '$planInfo.price',
          duration: '$planInfo.duration'
        }
      }
    }
  )

  const purchases = await db.collection('planRequests').aggregate(pipeline).toArray().catch(() => [])

  return NextResponse.json({
    purchases,
    totalCount,
    totalPages,
    page,
    limit
  })
}
