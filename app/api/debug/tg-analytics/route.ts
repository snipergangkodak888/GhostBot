import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const token = process.env.NEXT_PUBLIC_TG_ANALYTICS_TOKEN || ''
  const appName = process.env.NEXT_PUBLIC_TG_ANALYTICS_APP_NAME || ''

  // Decode token payload (it's base64 before the '!' delimiter)
  let tokenPayload: Record<string, string> | null = null
  try {
    const base64Part = token.split('!')[0]
    if (base64Part) {
      tokenPayload = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf-8'))
    }
  } catch {
    tokenPayload = null
  }

  let latestClientReport: Record<string, unknown> | null = null
  let latestSuccessfulClientReport: Record<string, unknown> | null = null
  try {
    const db = await getDb()
    latestClientReport = await db
      .collection('tgAnalyticsDebugStatus')
      .find({})
      .sort({ createdAt: -1 })
      .limit(1)
      .next()

    latestSuccessfulClientReport = await db
      .collection('tgAnalyticsDebugStatus')
      .find({ initialized: true })
      .sort({ createdAt: -1 })
      .limit(1)
      .next()
  } catch {
    latestClientReport = null
    latestSuccessfulClientReport = null
  }

  const res = NextResponse.json({
    status: 'ok',
    env: {
      NEXT_PUBLIC_TG_ANALYTICS_TOKEN: {
        set: !!token,
        length: token.length,
        preview: token ? `${token.slice(0, 20)}...${token.slice(-10)}` : '(empty)',
        decodedPayload: tokenPayload,
      },
      NEXT_PUBLIC_TG_ANALYTICS_APP_NAME: {
        set: !!appName,
        value: appName || '(empty)',
      },
    },
    sdk: {
      mode: 'npm @telegram-apps/analytics',
      canInit: !!token && !!appName,
      hint: token && appName
        ? `telegramAnalytics.init({ token: '...', appName: '${appName}' })`
        : '⚠️ init() will NOT run — missing token or appName',
    },
    clientStatus: {
      hasReport: !!latestClientReport,
      latest: latestClientReport,
      latestSuccessful: latestSuccessfulClientReport,
    },
  })

  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.headers.set('Pragma', 'no-cache')
  res.headers.set('Expires', '0')

  return res
}
