"use client"

const tgsDataCache = new Map<string, any>()
const tgsPromiseCache = new Map<string, Promise<any>>()

function getProxyUrl(path: string): string {
  const absoluteUrl = new URL(path, window.location.origin).toString()
  return `/api/proxy/nft-image?url=${encodeURIComponent(absoluteUrl)}`
}

export function getCachedTgs(path: string): any | null {
  return tgsDataCache.get(path) ?? null
}

export async function preloadTgs(path: string): Promise<any> {
  if (tgsDataCache.has(path)) {
    return tgsDataCache.get(path)
  }

  const existing = tgsPromiseCache.get(path)
  if (existing) {
    return existing
  }

  const promise = fetch(getProxyUrl(path), { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load TGS: ${path}`)
      return res.json()
    })
    .then((json) => {
      tgsDataCache.set(path, json)
      tgsPromiseCache.delete(path)
      return json
    })
    .catch((err) => {
      tgsPromiseCache.delete(path)
      throw err
    })

  tgsPromiseCache.set(path, promise)
  return promise
}
