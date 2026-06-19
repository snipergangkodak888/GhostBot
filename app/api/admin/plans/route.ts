import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
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

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const plans = await db.collection('plans').find({}).sort({ order: 1, createdAt: -1 }).toArray()
  return NextResponse.json({ plans })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const payload = await req.json()
  const doc = { 
    ...payload, 
    order: payload.order ?? 0, // Default order to 0 if not provided
    isActive: true, // New plans are active by default
    createdAt: new Date(), 
    updatedAt: new Date() 
  }
  await db.collection('plans').insertOne(doc)
  return NextResponse.json({ ok: true })
}
