import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { verifyAdminToken } from '@/lib/auth'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    const payload = await verifyAdminToken(token)
    return payload
  } catch {
    return null
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = await getDb()
  const pendingPlanRequests = await db.collection('planRequests').countDocuments({ status: 'pending' }).catch(()=>0)
  return NextResponse.json({ pendingPlanRequests })
}
