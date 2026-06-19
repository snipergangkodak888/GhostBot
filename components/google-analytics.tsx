'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

interface GoogleAnalyticsProps {
  measurementId: string
}

export function GoogleAnalytics({ measurementId }: GoogleAnalyticsProps) {
  const pathname = usePathname()

  // Re-send page_view on every client-side route change
  useEffect(() => {
    if (!measurementId || typeof window === 'undefined') return
    const w = window as any
    if (typeof w.gtag === 'function') {
      w.gtag('event', 'page_view', {
        page_path: pathname,
        page_location: window.location.href,
        send_to: measurementId,
      })
    }
  }, [pathname, measurementId])

  if (!measurementId) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: [
            'window.dataLayer = window.dataLayer || [];',
            'function gtag(){dataLayer.push(arguments);}',
            'gtag(\'js\', new Date());',
            `gtag(\'config\', \'${measurementId}\', { page_path: window.location.pathname });`,
          ].join('\n'),
        }}
      />
    </>
  )
}
