import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try { return await verifyAdminToken(token) } catch { return null }
}

/** GET — return current external API key (masked) */
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = await getDb()
  const row = await db.collection('settings').findOne({ key: 'externalApiKey' })
  const key = row?.value as string | undefined
  return NextResponse.json({
    hasKey: !!key,
    maskedKey: key ? `${key.slice(0, 8)}${'*'.repeat(Math.max(0, key.length - 12))}${key.slice(-4)}` : null,
  })
}

/** POST — generate a new external API key (rotates existing) */
export async function POST() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = await getDb()
  const newKey = `vb_ext_${randomBytes(24).toString('hex')}`
  await db.collection('settings').updateOne(
    { key: 'externalApiKey' },
    { $set: { value: newKey, updatedAt: new Date() } },
    { upsert: true }
  )
  // Return full key once — admin must copy it
  return NextResponse.json({ success: true, apiKey: newKey })
}
