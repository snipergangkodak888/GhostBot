import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const TELEGRAM_API = 'https://api.telegram.org'

export async function GET() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 })

    const db = await getDb()
    const row = await db.collection('settings').findOne({ key: 'startMessage' })
    const sm: any = row?.value || {}

    const fileIdRaw = typeof sm.fileId === 'string' ? sm.fileId : ''
    const fileId = fileIdRaw.trim()

    if (!sm.mediaEnabled) return NextResponse.json({ ok: true, mediaEnabled: false, note: 'Media disabled in startMessage' })
    if (!fileId) return NextResponse.json({ ok: false, error: 'No fileId set in startMessage' }, { status: 400 })

    const url = `${TELEGRAM_API}/bot${token}/getFile`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    })
    let body: any = null
    try { body = await resp.json() } catch {}

    return NextResponse.json({
      ok: true,
      request: { mediaType: sm.mediaType, fileIdPrefix: fileId.substring(0, 12), fileIdLength: fileId.length },
      telegram: { status: resp.status, ok: resp.ok, body }
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
