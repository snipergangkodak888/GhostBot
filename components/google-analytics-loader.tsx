import { getDb } from '@/lib/db'
import { Suspense } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { GoogleAnalytics } from '@/components/google-analytics'

/**
 * Server component — reads GA settings from DB and renders
 * the client-side GA script component if enabled.
 * noStore() ensures we always get the latest value from DB (no caching).
 */
async function GALoader() {
  noStore() // opt out of Next.js caching so admin changes take effect immediately
  try {
    const db = await getDb()
    const settings = await db.collection('settings').findOne({ key: 'googleAnalytics' })
    const ga = settings?.value || {}
    if (!ga.enabled || !ga.trackingId) return null
    return <GoogleAnalytics measurementId={ga.trackingId} />
  } catch {
    return null
  }
}

export function GoogleAnalyticsLoader() {
  return (
    <Suspense fallback={null}>
      <GALoader />
    </Suspense>
  )
}
