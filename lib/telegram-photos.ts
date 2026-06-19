import { getDb } from './db'

const TELEGRAM_API = 'https://api.telegram.org'
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const ERROR_TTL_MS = 10 * 60 * 1000 // 10 minutes if we hit an error (like rate limit)
const NO_PHOTO_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours if user truly has no photo

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchAndCachePhotos(telegramIds: number[]): Promise<Map<number, string | null>> {
  if (!telegramIds.length) return new Map();
  
  const token = process.env.TELEGRAM_BOT_TOKEN
  const db = await getDb()
  const cacheCol = db.collection('userPhotoCache')
  const now = Date.now()
  
  const existing = await cacheCol
    .find({ telegramId: { $in: telegramIds } }, { projection: { telegramId: 1, cachedAt: 1, photoUrl: 1, photoData: 1, isError: 1 } })
    .toArray()
    
  const freshSet = new Set<number>()
  const result = new Map<number, string | null>()
  
  for (const d of existing) {
    const age = d.cachedAt ? now - new Date(d.cachedAt).getTime() : Infinity;
    
    // Automatically force re-fetch if they have no photoData and were fetched >1 hr ago (forces fix for previously bugged caches over time)
    if (!d.photoData && !d.isError && age > 60 * 60 * 1000) continue;

    const ttl = d.isError ? ERROR_TTL_MS : (d.photoData === null ? NO_PHOTO_TTL_MS : PHOTO_CACHE_TTL_MS);
    
    if (age < ttl) {
      freshSet.add(d.telegramId)
      if (d.photoData) {
         result.set(d.telegramId, d.photoData)
      } else if (d.photoUrl && d.photoUrl.startsWith('data:')) {
         result.set(d.telegramId, d.photoUrl)
      } else {
         result.set(d.telegramId, null) // Cache hit: User has no photo historically
      }
    }
  }
  
  const stale = telegramIds.filter(id => !freshSet.has(id))
  if (stale.length && token) {
    // Process strictly SEQUENTIALLY with a 125ms pause between each user 
    for (const id of stale) {
      let photoData: string | null = null
      let isRateLimited = false;

      try {
        const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: id, limit: 1 }),
          cache: 'no-store',
        })
        const photosData = await photosRes.json()
        
        if (!photosData.ok) {
           isRateLimited = true; 
           console.warn("[Telegram Photos] API Error for", id, photosData.description);
        } else if (photosData.result?.photos?.length) {
          const photoSizes = photosData.result.photos[0]
          const photo = photoSizes?.[0] // pick the lowest res
          
          if (photo?.file_id) {
            const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file_id: photo.file_id }),
              cache: 'no-store',
            })
            const fileData = await fileRes.json()
            if (fileData.ok && fileData.result?.file_path) {
              const imgRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${fileData.result.file_path}`)
              if (imgRes.ok) {
                 const arrayBuffer = await imgRes.arrayBuffer()
                 const base64 = Buffer.from(arrayBuffer).toString('base64')
                 photoData = `data:image/jpeg;base64,${base64}`
              }
            } else {
               isRateLimited = true;
            }
          }
        }
      } catch (err) { 
         console.error("[Telegram Photos] Request Exception", err);
         isRateLimited = true;
      }
      
      // Upsert into cache
      await cacheCol.updateOne(
        { telegramId: id },
        { 
          $set: { 
            telegramId: id, 
            photoData, 
            cachedAt: new Date(),
            isError: isRateLimited
          } 
        },
        { upsert: true }
      )
      
      result.set(id, photoData)
      
      // Delay so we don't trip DDOS protections
      await sleep(150); 
    }
  } else {
    for (const id of stale) {
       result.set(id, null)
    }
  }
  
  return result;
}
