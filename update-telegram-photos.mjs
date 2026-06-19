import fs from 'fs'

const path = 'lib/telegram-photos.ts'
let code = `import { getDb } from './db'

const TELEGRAM_API = 'https://api.telegram.org'
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function fetchAndCachePhotos(telegramIds: number[]): Promise<Map<number, string | null>> {
  if (!telegramIds.length) return new Map();
  
  const token = process.env.TELEGRAM_BOT_TOKEN
  const db = await getDb()
  const cacheCol = db.collection('userPhotoCache')
  const now = Date.now()
  
  const existing = await cacheCol
    .find({ telegramId: { $in: telegramIds } }, { projection: { telegramId: 1, cachedAt: 1, photoUrl: 1, photoData: 1 } })
    .toArray()
    
  const freshSet = new Set<number>()
  const result = new Map<number, string | null>()
  
  for (const d of existing) {
    if (d.cachedAt && now - new Date(d.cachedAt).getTime() < PHOTO_CACHE_TTL_MS) {
      freshSet.add(d.telegramId)
      // Transition legacy DB entries: prefer photoData or legacy photoUrl (if base64)
      if (d.photoData) {
         result.set(d.telegramId, d.photoData)
      } else if (d.photoUrl && d.photoUrl.startsWith('data:')) {
         result.set(d.telegramId, d.photoUrl)
      } else {
         // Legacy URL with token... invalidate it.
         freshSet.delete(d.telegramId)
      }
    }
  }
  
  const stale = telegramIds.filter(id => !freshSet.has(id))
  if (stale.length && token) {
    // Process in batches of 5 to avoid hitting Telegram API limits too hard
    const BATCH_SIZE = 5;
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async id => {
        try {
          const photosRes = await fetch(\`\${TELEGRAM_API}/bot\${token}/getUserProfilePhotos\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: id, limit: 1 }),
            cache: 'no-store',
          })
          const photosData = await photosRes.json()
          let photoData: string | null = null
          if (photosData.ok && photosData.result?.photos?.length) {
            const photoSizes = photosData.result.photos[0]
            // Pick lowest resolution for the leaderboard avatar to save DB space
            const photo = photoSizes?.[0]
            if (photo?.file_id) {
              const fileRes = await fetch(\`\${TELEGRAM_API}/bot\${token}/getFile\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_id: photo.file_id }),
                cache: 'no-store',
              })
              const fileData = await fileRes.json()
              if (fileData.ok && fileData.result?.file_path) {
                const imgRes = await fetch(\`\${TELEGRAM_API}/file/bot\${token}/\${fileData.result.file_path}\`)
                if (imgRes.ok) {
                   const arrayBuffer = await imgRes.arrayBuffer()
                   const base64 = Buffer.from(arrayBuffer).toString('base64')
                   photoData = \`data:image/jpeg;base64,\${base64}\`
                }
              }
            }
          }
          await cacheCol.updateOne(
            { telegramId: id },
            { $set: { telegramId: id, photoData, cachedAt: new Date() } },
            { upsert: true }
          )
          result.set(id, photoData)
        } catch { 
           result.set(id, null)
        }
      }));
    }
  } else {
    for (const id of stale) {
       result.set(id, null)
    }
  }
  
  return result;
}
`
fs.writeFileSync(path, code)
