// Global singleton cache for animation icons - shared across all components
// This prevents multiple fetches when navigating between pages

interface IconCache {
  animationIcons: Record<string, string> | null
  adSettings: any | null
  isLoaded: boolean
  fetchPromise: Promise<void> | null
  listeners: Set<() => void>
  preloadedImages: Set<string>
  initialized: boolean
}

// Use a getter to ensure the cache object is created lazily
let _iconCache: IconCache | null = null

function getIconCache(): IconCache {
  if (!_iconCache) {
    _iconCache = {
      animationIcons: null,
      adSettings: null,
      isLoaded: false,
      fetchPromise: null,
      listeners: new Set(),
      preloadedImages: new Set(),
      initialized: false
    }
  }
  return _iconCache
}

// Static icons used across user dashboard pages
const STATIC_ICONS = [
  '/images/Splash/splash.jpeg',
  '/images/Stickers/brand.webp',
  '/images/Stickers/ticket.webp',
  '/images/Stickers/friends.webp',
  '/images/Stickers/task.webp',
  '/images/Stickers/empty.webp',
  '/images/Stickers/collection.webp',
  '/images/Stickers/trophy.webp',
  '/images/Stickers/crown.gif',
  '/images/Stickers/1st-place-medal.webp',
  '/images/Stickers/2nd-place-medal.webp',
  '/images/Stickers/3rd-place-medal.webp',
  '/images/Stickers/ton_symbol.png',
  '/images/Stickers/confetti-ball.webp',
  '/images/Stickers/money-bag.webp',
  '/images/Stickers/gem-stone.webp',
  '/images/Stickers/fire.webp',
  '/images/Token/888.png',
  '/images/Icons/8key.webp',
  '/images/Icons/RedoFriend.webp',
  '/images/Icons/RedoandFlag.webp',
  '/images/Icons/wallet.webp',
  '/8ball/assets/img/tableTop.png',
  '/8ball/assets/img/8ball.png',
  '/8ball/assets/img/bgLarge.png',
  '/8ball/assets/img/cloth.png',
  '/8ball/assets/img/cue.png',
  '/8ball/assets/img/pockets.png',
]

// Preload a single image
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const cache = getIconCache()
    if (cache.preloadedImages.has(src)) {
      resolve()
      return
    }

    if (src.endsWith('.tgs')) {
      const absoluteUrl = src.startsWith('/')
        ? `${window.location.origin}${src}`
        : src
      const proxyUrl = `/api/proxy/nft-image?url=${encodeURIComponent(absoluteUrl)}`
      fetch(proxyUrl, { credentials: 'include' })
        .then(() => {
          cache.preloadedImages.add(src)
          cache.preloadedImages.add(proxyUrl)
          resolve()
        })
        .catch(() => resolve())
      return
    }

    const img = new Image()
    img.onload = () => {
      cache.preloadedImages.add(src)
      resolve()
    }
    img.onerror = () => {
      resolve()
    }
    img.src = src
  })
}

// Preload all static icons
function preloadAllIcons(): Promise<void[]> {
  return Promise.all(STATIC_ICONS.map(preloadImage))
}

// Initialize the cache - called lazily
function initializeCache(): void {
  const cache = getIconCache()
  if (cache.initialized || typeof window === 'undefined') {
    return
  }
  cache.initialized = true
  
  cache.fetchPromise = (async () => {
    try {
      // Start preloading static icons
      const staticIconsPromise = preloadAllIcons()
      
      const response = await fetch('/api/public-settings')
      if (response.ok) {
        const data = await response.json()
        if (data.settings?.animationIcons) {
          cache.animationIcons = data.settings.animationIcons
          // Preload custom animation icons and wait for all of them
          const customIcons = Object.values(data.settings.animationIcons) as string[]
          const customIconPromises = customIcons
            .filter(iconUrl => iconUrl && typeof iconUrl === 'string')
            .map(iconUrl => preloadImage(iconUrl))
          
          // Wait for both static and custom icons to load
          await Promise.all([staticIconsPromise, ...customIconPromises])
        } else {
          // Still wait for static icons
          await staticIconsPromise
        }
        if (data.settings?.adNetworks) {
          cache.adSettings = data.settings.adNetworks
        }
        cache.isLoaded = true
        // Notify all listeners
        cache.listeners.forEach(listener => listener())
      } else {
        await staticIconsPromise
        cache.isLoaded = true
      }
    } catch (error) {
      console.error('Error preloading settings:', error)
      cache.isLoaded = true
    }
  })()
}

export function getAnimationIcons(): Record<string, string> | null {
  initializeCache()
  return getIconCache().animationIcons
}

export function getAdSettings(): any {
  initializeCache()
  return getIconCache().adSettings
}

export function isIconCacheLoaded(): boolean {
  initializeCache()
  return getIconCache().isLoaded
}

export function waitForIconCache(): Promise<void> {
  initializeCache()
  const cache = getIconCache()
  if (cache.isLoaded) {
    return Promise.resolve()
  }
  return cache.fetchPromise || Promise.resolve()
}

export function subscribeToIconCache(listener: () => void): () => void {
  initializeCache()
  const cache = getIconCache()
  cache.listeners.add(listener)
  return () => cache.listeners.delete(listener)
}

// Helper to get cached URL through proxy
export function getCachedUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (url.startsWith('/')) return url
  return `/api/proxy/nft-image?url=${encodeURIComponent(url)}`
}

// Preload additional icons dynamically (for category icons, etc.)
export function preloadIcon(src: string): void {
  if (typeof window !== 'undefined' && src) {
    preloadImage(src)
  }
}

// Check if an icon has been preloaded
export function isIconPreloaded(src: string): boolean {
  return getIconCache().preloadedImages.has(src)
}
