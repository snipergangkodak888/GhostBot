import { useState, useEffect } from 'react'

// In-memory cache for sticker URLs
const stickerCache = new Map<string, string>()

// Cache duration: 3 months in milliseconds
const CACHE_DURATION = 90 * 24 * 60 * 60 * 1000

/**
 * Custom hook to fetch Telegram sticker file URL for display
 * Uses official Telegram Bot API getFile method with caching
 * @param fileId - Telegram file ID
 * @param usePersistentCache - Whether to use localStorage for 3-month caching
 */
export function useStickerUrl(fileId: string | undefined, usePersistentCache = false) {
  const [stickerUrl, setStickerUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fileId) {
      console.log('🎁 [useStickerUrl] No fileId provided')
      setStickerUrl(null)
      return
    }

    // Check in-memory cache first
    const cached = stickerCache.get(fileId)
    if (cached) {
      console.log('🎁 [useStickerUrl] ✅ Using memory cached URL for:', fileId)
      setStickerUrl(cached)
      return
    }

    // Check localStorage persistent cache if enabled
    if (usePersistentCache) {
      try {
        const cacheKey = `sticker_${fileId}`
        const cachedData = localStorage.getItem(cacheKey)
        if (cachedData) {
          const { url, timestamp } = JSON.parse(cachedData)
          const age = Date.now() - timestamp
          if (age < CACHE_DURATION) {
            console.log('🎁 [useStickerUrl] ✅ Using localStorage cached URL for:', fileId)
            setStickerUrl(url)
            stickerCache.set(fileId, url)
            return
          } else {
            // Cache expired, remove it
            localStorage.removeItem(cacheKey)
          }
        }
      } catch (e) {
        console.error('🎁 [useStickerUrl] Error reading cache:', e)
      }
    }

    const fetchStickerUrl = async () => {
      console.log('🎁 [useStickerUrl] Fetching sticker for file_id:', fileId)
      setLoading(true)
      setError(null)

      try {
        const apiUrl = `/api/telegram/sticker-file?file_id=${encodeURIComponent(fileId)}`
        console.log('🎁 [useStickerUrl] Calling:', apiUrl)

        const response = await fetch(apiUrl)
        console.log('🎁 [useStickerUrl] Response status:', response.status, response.ok)

        if (!response.ok) {
          const errorText = await response.text()
          console.error('🎁 [useStickerUrl] Error response:', errorText)
          throw new Error(`Failed to fetch sticker URL: ${response.status}`)
        }

        const data = await response.json()
        console.log('🎁 [useStickerUrl] Response data:', data)

        if (data.file_url) {
          console.log('🎁 [useStickerUrl] ✅ Got file URL:', data.file_url)
          // Use proxy to avoid CORS issues with Telegram API
          const proxiedUrl = `/api/proxy/nft-image?url=${encodeURIComponent(data.file_url)}`
          // Cache in memory
          stickerCache.set(fileId, proxiedUrl)
          // Cache in localStorage if persistent cache enabled
          if (usePersistentCache) {
            try {
              const cacheKey = `sticker_${fileId}`
              localStorage.setItem(cacheKey, JSON.stringify({
                url: proxiedUrl,
                timestamp: Date.now()
              }))
            } catch (e) {
              console.error('🎁 [useStickerUrl] Error saving to cache:', e)
            }
          }
          setStickerUrl(proxiedUrl)
        } else {
          console.error('🎁 [useStickerUrl] ❌ No file_url in response')
          throw new Error('No file URL in response')
        }
      } catch (err) {
        console.error('🎁 [useStickerUrl] ❌ Error:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStickerUrl(null)
      } finally {
        setLoading(false)
      }
    }

    fetchStickerUrl()
  }, [fileId])

  return { stickerUrl, loading, error }
}
