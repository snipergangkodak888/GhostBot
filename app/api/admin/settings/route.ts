import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

const AI_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://openrouter.ai/api/v1'])

function normalizeAiModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (!model || model === 'gpt-4o-mini') return 'gpt-5.4-mini'
  return model
}

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const rows = await db.collection('settings').find({}).toArray()
  const settings = rows.reduce((acc: Record<string, unknown>, s: any) => {
    acc[s.key] = s.value
    return acc
  }, {})

  return NextResponse.json({ settings, ...settings })
}

export async function POST(req: Request) {
  return PATCH(req)
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = await getDb()
  const ops: Array<Promise<any>> = []

  if (typeof body.platformName === 'string') {
    ops.push(db.collection('settings').updateOne(
      { key: 'platformName' },
      { $set: { value: body.platformName.trim() || 'Ghost Team System' } },
      { upsert: true }
    ))
  }

  if (typeof body.landingPageEnabled === 'boolean') {
    ops.push(db.collection('settings').updateOne(
      { key: 'landingPageEnabled' },
      { $set: { value: body.landingPageEnabled } },
      { upsert: true }
    ))
  }

  if (typeof body.cacheVersion === 'string' || typeof body.cacheVersion === 'number') {
    ops.push(db.collection('settings').updateOne(
      { key: 'cacheVersion' },
      { $set: { value: body.cacheVersion } },
      { upsert: true }
    ))
  }

  if (typeof body.appVersion === 'string') {
    ops.push(db.collection('settings').updateOne(
      { key: 'appVersion' },
      { $set: { value: body.appVersion.trim() || '1.0.0' } },
      { upsert: true }
    ))
  }

  if (typeof body.telegramBotUsername === 'string') {
    ops.push(db.collection('settings').updateOne(
      { key: 'telegramBotUsername' },
      { $set: { value: body.telegramBotUsername.trim().replace(/^@/, '') } },
      { upsert: true }
    ))
  }

  if (typeof body.cronSecret === 'string') {
    ops.push(db.collection('settings').updateOne(
      { key: 'cronSecret' },
      { $set: { value: body.cronSecret.trim() } },
      { upsert: true }
    ))
  }

  if (body.openAi && typeof body.openAi === 'object') {
    const existing = await db.collection('settings').findOne({ key: 'openAi' })
    const current = existing?.value && typeof existing.value === 'object' ? existing.value : {}
    const incomingKey = typeof body.openAi.apiKey === 'string' ? body.openAi.apiKey.trim() : ''
    const incomingBaseUrl = typeof body.openAi.baseUrl === 'string' ? body.openAi.baseUrl.trim().replace(/\/+$/, '') : ''
    const currentBaseUrl = typeof (current as any).baseUrl === 'string' ? String((current as any).baseUrl).trim().replace(/\/+$/, '') : ''
    const normalized = {
      enabled: body.openAi.enabled !== false,
      apiKey: incomingKey || String((current as any).apiKey || ''),
      model: normalizeAiModel(body.openAi.model),
      baseUrl: AI_BASE_URLS.has(incomingBaseUrl)
        ? incomingBaseUrl
        : AI_BASE_URLS.has(currentBaseUrl)
          ? currentBaseUrl
          : 'https://api.openai.com/v1',
    }
    ops.push(db.collection('settings').updateOne(
      { key: 'openAi' },
      { $set: { value: normalized } },
      { upsert: true }
    ))
  }

  if (body.googleAnalytics && typeof body.googleAnalytics === 'object') {
    ops.push(db.collection('settings').updateOne(
      { key: 'googleAnalytics' },
      {
        $set: {
          value: {
            enabled: !!body.googleAnalytics.enabled,
            trackingId: typeof body.googleAnalytics.trackingId === 'string' ? body.googleAnalytics.trackingId.trim() : '',
          },
        },
      },
      { upsert: true }
    ))
  }

  await Promise.all(ops)
  return NextResponse.json({ ok: true })
}
