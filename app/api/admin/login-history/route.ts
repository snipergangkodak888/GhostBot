import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
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

export async function GET(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const history = await db
    .collection('adminLoginHistory')
    .find({})
    .sort({ loginAt: -1 })
    .limit(50)
    .toArray()

  return NextResponse.json({ history: history.map(h => ({ ...h, _id: h._id.toString() })) })
}
