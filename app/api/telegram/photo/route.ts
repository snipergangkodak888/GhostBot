import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const TELEGRAM_API = 'https://api.telegram.org'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const idStr = searchParams.get('id')
  if (!idStr) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  
  const id = Number(idStr)
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 500 })

  try {
    const db = await getDb()
    const cacheCol = db.collection('userPhotoCache')
    
    // 1. Check DB Cache
    const cached = await cacheCol.findOne({ telegramId: id })
    const now = Date.now()
    
    if (cached && cached.cachedAt) {
       const age = now - new Date(cached.cachedAt).getTime()
       
       // Force invalidate broken "null" from before (self-healing)
       if (!cached.photoData && !cached.isError && age > 60 * 60 * 1000) {
          // let it fall through to re-fetch
       } else if (age < 24 * 60 * 60 * 1000 && !cached.isError) {
          if (cached.photoData) {
            return NextResponse.json({ photoUrl: cached.photoData }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } })
          } else if (cached.photoUrl && cached.photoUrl.startsWith('data:')) {
            return NextResponse.json({ photoUrl: cached.photoUrl }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } })
          } else {
            return NextResponse.json({ photoUrl: null }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } })
          }
       }
    }

    // 2. Fetch from Telegram
    const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, limit: 1 }),
      cache: 'no-store',
    })
    const photosData = await photosRes.json()
    
    let photoData: string | null = null
    let isError = false

    if (!photosData.ok) {
       if (photosData.error_code === 429) {
          return NextResponse.json({ error: 'Rate limited', retryAfter: photosData.parameters?.retry_after }, { status: 429 })
       }
       isError = true
    } else if (photosData.result?.photos?.length) {
       const photo = photosData.result.photos[0]?.[0]
       if (photo?.file_id) {
         const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ file_id: photo.file_id })
         })
         const fileData = await fileRes.json()
         if (fileData.ok && fileData.result?.file_path) {
            const imgRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${fileData.result.file_path}`)
            if (imgRes.ok) {
               const arrayBuffer = await imgRes.arrayBuffer()
               const base64 = Buffer.from(arrayBuffer).toString('base64')
               photoData = `data:image/jpeg;base64,${base64}`
            } else {
               isError = true
            }
         } else {
            isError = true
         }
       }
    }

    // 3. Save to DB Cache
    await cacheCol.updateOne(
      { telegramId: id },
      { $set: { telegramId: id, photoData, cachedAt: new Date(), isError } },
      { upsert: true }
    )

    return NextResponse.json({ photoUrl: photoData }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } })

  } catch (error: any) {
    console.error('Telegram Photo API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
