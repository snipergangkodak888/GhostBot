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

export async function POST() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()

  // Get current version and increment it
  const current = await db.collection('settings').findOne({ key: 'cacheVersion' })
  const currentVersion = typeof current?.value === 'number' ? current.value : 0
  const newVersion = currentVersion + 1

  await db.collection('settings').updateOne(
    { key: 'cacheVersion' },
    { $set: { value: newVersion, updatedAt: new Date() } },
    { upsert: true }
  )

  return NextResponse.json({ success: true, version: newVersion })
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const doc = await db.collection('settings').findOne({ key: 'cacheVersion' })
  const version = typeof doc?.value === 'number' ? doc.value : 0

  return NextResponse.json({ version })
}
