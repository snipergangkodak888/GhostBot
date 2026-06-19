import type { Metadata } from 'next'
import { getDb } from '@/lib/db'
import { supabaseRest, supabaseConfig } from '@/lib/supabase'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import './mui-mobile-dark.css'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as SonnerToaster } from 'sonner'
import { TelegramProvider } from '@/components/telegram-provider'
import { TelegramAnalyticsProvider } from '@/components/telegram-analytics-provider'
import { ErrorBoundary } from '@/components/error-boundary'
import { GoogleAnalyticsLoader } from '@/components/google-analytics-loader'
import { APP_NAME, MAIN_LOGO_URL } from '@/lib/branding'

async function getPlatformName(): Promise<string> {
  if (supabaseConfig.url && (supabaseConfig.hasServiceRoleKey || supabaseConfig.hasAnonKey)) {
    try {
      const rows = await supabaseRest<Array<{ value: string }>>('settings?key=eq.platformName&select=value&limit=1')
      if (rows?.[0]?.value) return rows[0].value
    } catch {}
  }

  try {
    const db = await getDb()
    const setting = await db.collection('settings').findOne({ key: 'platformName' })
    return setting?.value || APP_NAME
  } catch {
    return APP_NAME
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const platformName = await getPlatformName()

  return {
    title: {
      default: platformName,
      template: `%s | ${platformName}`,
    },
    description: `${platformName} is an internal Telegram app and bot for MM operations, project tracking, launch scheduling, reminders, payroll, and team coordination.`,
    icons: {
      icon: MAIN_LOGO_URL,
      apple: MAIN_LOGO_URL,
    },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover' as const,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`} style={{ fontFamily: 'Roboto, sans-serif' }}>
        <GoogleAnalyticsLoader />
        <ErrorBoundary>
          <TelegramAnalyticsProvider>
            <TelegramProvider>
              {children}
              <Toaster />
              <SonnerToaster
                position="top-center"
                richColors
                theme="dark"
                style={{ top: '80px' } as React.CSSProperties}
                toastOptions={{
                  style: {
                    borderRadius: '999px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    minHeight: 'unset',
                  },
                }}
              />
            </TelegramProvider>
          </TelegramAnalyticsProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
