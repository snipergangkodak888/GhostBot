import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * External API for VivatBet CRM / cronjobs
 * Authentication: x-api-key header must match settings.externalApiKey
 *
 * GET /api/external/promo-codes
 *   ?type=casino|sports         — filter by coupon type
 *   ?since=ISO_DATE             — only codes assigned after this date
 *   ?telegramId=123             — filter by specific user
 *   ?page=1&limit=100           — pagination
 *
 * Returns list of assigned promo codes with user info and metadata
 */

async function authenticate(req: NextRequest): Promise<boolean> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return false
  try {
    const db = await getDb()
    const row = await db.collection('settings').findOne({ key: 'externalApiKey' })
    if (!row?.value) return false
    // Constant-time comparison to prevent timing attacks
    const stored = String(row.value)
    if (stored.length !== apiKey.length) return false
    let diff = 0
    for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ apiKey.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const ok = await authenticate(req)
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized — provide valid x-api-key header' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const typeFilter = searchParams.get('type')   // 'casino' | 'sports'
    const sinceStr = searchParams.get('since')     // ISO date string
    const telegramIdFilter = searchParams.get('telegramId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')))
    const skip = (page - 1) * limit

    const db = await getDb()

    // Build aggregation pipeline
    const matchStage: Record<string, any> = {
      active: true,
      'recipients.0': { $exists: true },
    }
    if (typeFilter === 'casino' || typeFilter === 'sports') {
      matchStage.type = typeFilter
    }

    const pipeline: any[] = [
      { $match: matchStage },
      { $unwind: '$recipients' },
    ]

    // Filter by telegramId
    if (telegramIdFilter) {
      pipeline.push({
        $match: {
          $or: [
            { 'recipients.telegramId': Number(telegramIdFilter) },
            { 'recipients.telegramId': telegramIdFilter },
          ]
        }
      })
    }

    // Filter by since date
    if (sinceStr) {
      const sinceDate = new Date(sinceStr)
      if (!isNaN(sinceDate.getTime())) {
        pipeline.push({ $match: { 'recipients.assignedAt': { $gt: sinceDate } } })
      }
    }

    // Add user info lookup
    pipeline.push(
      {
        $lookup: {
          from: 'users',
          let: { tid: '$recipients.telegramId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$telegramId', '$$tid'] },
                    { $eq: ['$telegramId', { $toDouble: '$$tid' }] },
                  ]
                }
              }
            },
            { $project: { _id: 0, firstName: 1, lastName: 1, username: 1, telegramId: 1 } }
          ],
          as: 'userInfo'
        }
      },
      {
        $project: {
          _id: 0,
          code: 1,
          description: 1,
          type: 1,
          triggerLevel: 1,
          assignedAt: '$recipients.assignedAt',
          source: '$recipients.source',
          chosenType: '$recipients.chosenType',
          telegramId: '$recipients.telegramId',
          user: { $arrayElemAt: ['$userInfo', 0] },
        }
      },
      { $sort: { assignedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    )

    const records = await db.collection('adminCoupons').aggregate(pipeline).toArray()

    // Sanitize — strip internal user data not needed by CRM
    const result = records.map((r: any) => ({
      code: r.code,
      type: r.chosenType || r.type || 'both',
      description: r.description,
      triggerLevel: r.triggerLevel ?? null,
      assignedAt: r.assignedAt,
      telegramId: r.telegramId,
      username: r.user?.username || null,
      firstName: r.user?.firstName || null,
    }))

    return NextResponse.json({
      success: true,
      page,
      limit,
      count: result.length,
      data: result,
    })
  } catch (error) {
    console.error('External promo-codes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
