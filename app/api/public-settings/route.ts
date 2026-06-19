import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supabaseConfig, supabaseRest } from '@/lib/supabase'
import { APP_NAME, MAIN_LOGO_URL } from '@/lib/branding'

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic'
export const revalidate = 0

function normalizeAiModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (!model || model === 'gpt-4o-mini') return 'gpt-5.4-mini'
  return model
}

async function loadSettings() {
  if (supabaseConfig.url && (supabaseConfig.hasServiceRoleKey || supabaseConfig.hasAnonKey)) {
    try {
      const rows = await supabaseRest<Array<{ key: string; value: unknown }>>('settings?select=key,value')
      return rows.reduce((acc: Record<string, unknown>, s) => {
        acc[s.key] = s.value
        return acc
      }, {})
    } catch (error) {
      console.warn('[public-settings] Supabase settings load failed, falling back to document adapter:', error)
    }
  }

  try {
    const db = await getDb()
    const rows = await db.collection('settings').find({}).toArray()
    return rows.reduce((acc: Record<string, unknown>, s: any) => {
      acc[s.key] = s.value
      return acc
    }, {})
  } catch (error) {
    console.warn('[public-settings] Settings database unavailable, using defaults:', error)
    return {}
  }
}

// Public settings for client use (non-admin)
export async function GET() {
  const settings = await loadSettings()

  if (!(settings as any).platformName) {
    ;(settings as any).platformName = APP_NAME
  }
  ;(settings as any).logoUrl = MAIN_LOGO_URL
  if (typeof (settings as any).landingPageEnabled === 'undefined') {
    ;(settings as any).landingPageEnabled = true
  }

  // Never expose ad callback secret to clients.
  try {
    const adNetworks = (settings as any).adNetworks
    if (adNetworks && typeof adNetworks === 'object') {
      ;(settings as any).adNetworks = {
        ...adNetworks,
        callbackConfigured: typeof adNetworks.callbackSecret === 'string' && adNetworks.callbackSecret.trim().length > 0,
        callbackSecret: undefined,
      }
    }
  } catch {}

  try {
    const openAi = (settings as any).openAi
    if (openAi && typeof openAi === 'object') {
      ;(settings as any).openAi = {
        enabled: openAi.enabled !== false,
        model: normalizeAiModel(openAi.model),
        baseUrl: typeof openAi.baseUrl === 'string' ? openAi.baseUrl : 'https://api.openai.com/v1',
        configured: typeof openAi.apiKey === 'string' && openAi.apiKey.trim().length > 0,
      }
    }
  } catch {}
  
  const res = NextResponse.json({ settings })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.headers.set('Pragma', 'no-cache')
  res.headers.set('Expires', '0')
  return res
}
