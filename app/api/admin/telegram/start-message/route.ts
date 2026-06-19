import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Protect this endpoint with an admin token set in env: ADMIN_TOKEN or START_MESSAGE_ADMIN_TOKEN
function getAdminToken() {
  return process.env.ADMIN_TOKEN || process.env.START_MESSAGE_ADMIN_TOKEN
}

export async function GET() {
  try {
    const db = await getDb()
    const row = await db.collection('settings').findOne({ key: 'startMessage' })
    return NextResponse.json({ ok: true, value: row?.value || null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminHeader = req.headers.get('x-admin-token') || ''
    const adminToken = getAdminToken()
    if (!adminToken || adminHeader !== adminToken) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { text = '', mediaEnabled = false, mediaType = 'photo', fileId = '' } = body || {}

    const db = await getDb()
    const value = { text, mediaEnabled: !!mediaEnabled, mediaType, fileId }
    await db.collection('settings').updateOne(
      { key: 'startMessage' },
      { $set: { value } },
      { upsert: true }
    )

    return NextResponse.json({ ok: true, value })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
