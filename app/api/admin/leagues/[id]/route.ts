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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const body = await req.json()
  const id = params.id
  await db.collection('footballLeagues').updateOne({ _id: new ObjectId(id) }, { $set: { ...body, updatedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const id = params.id
  await db.collection('footballLeagues').deleteOne({ _id: new ObjectId(id) })
  await db.collection('clubs').deleteMany({ leagueId: id })
  return NextResponse.json({ ok: true })
}
