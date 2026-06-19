import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { runOpsSuperCron } from '@/lib/ops-cron'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try { return await verifyAdminToken(token) } catch { return null }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()

  // Get last run for each job type
  const logs = await db.collection('cronLogs')
    .aggregate([
      { $sort: { runAt: -1 } },
      { $group: { _id: '$type', lastRun: { $first: '$$ROOT' } } },
    ])
    .toArray()

  // Get recent runs (last 20)
  const recent = await db.collection('cronLogs')
    .find({})
    .sort({ runAt: -1 })
    .limit(20)
    .toArray()

  const cronSecretRow = await db.collection('settings').findOne({ key: 'cronSecret' }).catch(() => null)

  return NextResponse.json({ logs, recent, cronSecret: String(cronSecretRow?.value || '') })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await req.json()
  if (!type) return NextResponse.json({ error: 'Missing type' }, { status: 400 })

  if (type === 'ops-super') {
    const data = await runOpsSuperCron()
    return NextResponse.json(data, { status: data.ok ? 200 : 400 })
  }

  // Call the cron endpoint internally — pass admin flag via header
  const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const res = await fetch(`${origin}/api/cron/notifications?type=${type}`, {
    headers: {
      'x-admin-trigger': 'true',
      // Forward the admin cookie so internal call is authorized
      'Cookie': `admin_token=${cookies().get('admin_token')?.value || ''}`,
    },
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
