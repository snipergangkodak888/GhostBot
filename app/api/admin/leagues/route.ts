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
  // Prefer explicit ordering field set by admin, fall back to name
  const leagues = await db.collection('footballLeagues').find({}).sort({ order: 1, name: 1 }).toArray()
  return NextResponse.json({ leagues })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  // Default order if not provided - append to end
  const order = typeof body.order === 'number' ? body.order : 9999
  const now = new Date()
  const doc = { name: body.name, country: body.country || '', slug, order, createdAt: now, updatedAt: now }
  await db.collection('footballLeagues').insertOne(doc)
  return NextResponse.json({ ok: true })
}
