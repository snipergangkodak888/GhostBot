"use client"

import { useEffect, useCallback, useRef } from 'react'

// List of commonly used stickers to preload
const PRELOAD_IMAGES = [
  '/images/Stickers/brand.webp',
  '/images/Stickers/crown.gif',
  '/images/Stickers/trophy.webp',
  '/images/Stickers/gem-stone.webp',
  '/images/Stickers/confetti-ball.webp',
  '/images/Stickers/money-bag.webp',
  '/images/Stickers/fire.webp',
  '/images/Stickers/crystal-ball.webp',
  '/images/Stickers/task.webp',
  '/images/Stickers/friends.webp',
  '/images/Stickers/collection.webp',
  '/images/Stickers/button.webp',
  '/images/Stickers/megaphone.webp',
  '/images/Stickers/1st-place-medal.webp',
  '/images/Stickers/2nd-place-medal.webp',
  '/images/Stickers/3rd-place-medal.webp',
  '/images/Stickers/dashboard.gif',
]

// Cache for loaded images
const imageCache = new Map<string, HTMLImageElement>()

/**
 * Hook to preload and cache images for better performance
 */
export function useImagePreloader(additionalImages?: string[]) {
  const preloadedRef = useRef(false)

  const preloadImage = useCallback((src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      // Check if already cached
      if (imageCache.has(src)) {
        resolve(imageCache.get(src)!)
        return
      }

      const img = new Image()
      img.onload = () => {
        imageCache.set(src, img)
        resolve(img)
      }
      img.onerror = reject
      img.src = src
    })
  }, [])

  const preloadAll = useCallback(async (images: string[]) => {
    const promises = images.map(src => preloadImage(src).catch(() => null))
    await Promise.allSettled(promises)
  }, [preloadImage])

  // Preload on mount
  useEffect(() => {
    if (preloadedRef.current) return
    preloadedRef.current = true

    const allImages = [...PRELOAD_IMAGES, ...(additionalImages || [])]
    preloadAll(allImages)
  }, [additionalImages, preloadAll])

  return { preloadImage, preloadAll, imageCache }
}

/**
 * Get a cached image URL or return the original
 * This helps with browser caching by ensuring consistent URLs
 */
export function getCachedImageUrl(src: string): string {
  // Add cache-busting version for consistency
  if (src.startsWith('/images/Stickers/')) {
    return src // Let browser handle caching with Cache-Control headers
  }
  return src
}

/**
 * Preload critical images for the landing page
 */
export function preloadLandingImages() {
  if (typeof window === 'undefined') return

  const criticalImages = [
    '/images/Stickers/brand.webp',
    '/images/Stickers/crown.gif',
    '/images/Stickers/trophy.webp',
    '/images/Stickers/confetti-ball.webp',
    '/images/Stickers/gem-stone.webp',
  ]

  criticalImages.forEach(src => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    document.head.appendChild(link)
  })
}

/**
 * Preload critical images for the admin panel
 */
export function preloadAdminImages() {
  if (typeof window === 'undefined') return

  const adminImages = [
    '/images/Stickers/brand.webp',
    '/images/Stickers/dashboard.gif',
  ]

  adminImages.forEach(src => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    document.head.appendChild(link)
  })
}
