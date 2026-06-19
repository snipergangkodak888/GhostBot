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

  const db = await getDb()
  const { searchParams } = new URL(req.url)
  const leagueId = searchParams.get('leagueId')
  const q: any = {}
  if (leagueId) q.leagueId = leagueId
  const clubs = await db.collection('footballTeams').find(q).sort({ name: 1 }).limit(500).toArray()
  return NextResponse.json({ clubs })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const body = await req.json()
  if (!body.name || !body.leagueId) return NextResponse.json({ error: 'name & leagueId required' }, { status: 400 })
  const doc = { name: body.name, leagueId: body.leagueId, createdAt: new Date(), updatedAt: new Date() }
  await db.collection('clubs').insertOne(doc)
  return NextResponse.json({ ok: true })
}
