import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const TELEGRAM_API = 'https://api.telegram.org'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export const dynamic = 'force-dynamic'

async function fetchProfilePhotoUrl(telegramId: number, token: string): Promise<string | null> {
  try {
    const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: telegramId, limit: 1 }),
      cache: 'no-store',
    })

    const photosData = await photosRes.json()
    if (!photosData.ok || !photosData.result?.photos?.length) return null

    const photoSizes = photosData.result.photos[0]
    const photo = photoSizes?.[photoSizes.length - 1]
    if (!photo?.file_id) return null

    const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: photo.file_id }),
      cache: 'no-store',
    })

    const fileData = await fileRes.json()
    if (!fileData.ok || !fileData.result?.file_path) return null

    return `${TELEGRAM_API}/file/bot${token}/${fileData.result.file_path}`
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const rawTelegramId = new URL(req.url).searchParams.get('telegramId')
  const telegramId = Number(rawTelegramId)
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    return NextResponse.json({ error: 'Bot token missing' }, { status: 500 })
  }

  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    return NextResponse.json({ error: 'Invalid telegramId' }, { status: 400 })
  }

  const db = await getDb()
  const cacheCol = db.collection('userPhotoCache')

  // Ensure index exists (no-op if already present)
  cacheCol.createIndex({ telegramId: 1 }, { unique: true }).catch(() => {})

  // Check DB cache first
  const cached = await cacheCol.findOne({ telegramId })
  const now = Date.now()
  if (cached && cached.cachedAt && now - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS) {
    const response = NextResponse.json({ success: true, telegramId, photoUrl: cached.photoUrl ?? null, fromCache: true })
    response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return response
  }

  // Fetch fresh from Telegram
  const photoUrl = await fetchProfilePhotoUrl(telegramId, token)

  // Upsert in DB — store even null so we don't spam Telegram for users without photos
  await cacheCol.updateOne(
    { telegramId },
    { $set: { telegramId, photoUrl: photoUrl ?? null, cachedAt: new Date() } },
    { upsert: true },
  ).catch(() => {})

  const response = NextResponse.json({ success: true, telegramId, photoUrl })
  response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  return response
}