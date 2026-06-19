"use client"

import { useState } from 'react'

// Pre-populate cache with base64 data URLs served from server APIs
const photoCache = new Map<number, string>()

export function primePhotoCache(entries: { telegramId: number; photoUrl: string }[]) {
  for (const { telegramId, photoUrl } of entries) {
    if (telegramId > 0 && photoUrl && photoUrl.startsWith('data:') && !photoCache.has(telegramId)) {
      photoCache.set(telegramId, photoUrl)
    }
  }
}

type TelegramProfilePhotoProps = {
  telegramId?: number | null
  src?: string | null
  alt: string
  className?: string
  skipFetch?: boolean  // kept for API compatibility, no longer used
  isAnonymous?: boolean
}

export default function TelegramProfilePhoto({
  telegramId,
  src,
  alt,
  className = '',
  isAnonymous = false,
}: TelegramProfilePhotoProps) {

  const [imageError, setImageError] = useState(false)

  // Compute initial letter for fallback
  let initial = 'U'
  const cleanStr = alt.replace(/[^a-zA-Z0-9]/g, '')
  if (cleanStr) {
    initial = cleanStr.charAt(0).toUpperCase()
  } else if (alt && alt.trim()) {
    initial = alt.trim().charAt(0).toUpperCase()
  }

  if (isAnonymous) {
    return <img src="/images/Icons/Anony.webp" alt="Anonymous" className={className} />
  }

  // Resolve best available photo: prop src > in-memory cache (both must be base64)
  const photo = (src && src.startsWith('data:')) ? src
    : (telegramId && photoCache.has(telegramId)) ? photoCache.get(telegramId)!
    : null

  if (photo && !imageError) {
    return (
      <img
        src={photo}
        alt={alt}
        className={className}
        onError={() => {
          setImageError(true)
          if (telegramId) photoCache.delete(telegramId)
        }}
      />
    )
  }

  // Fallback: dark circle with first letter — no network calls, no broken images
  return (
    <div className={`flex items-center justify-center bg-[#1f2329] text-white font-semibold uppercase ${className}`}>
      {initial}
    </div>
  )
}
