import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { getTelegramBotToken } from '@/lib/telegram-bot'
import { isLocalWebhookSetupRequest, telegramWebhookSecret } from '@/lib/telegram-webhook-auth'

const TELEGRAM_API = 'https://api.telegram.org'

async function canConfigure(req: Request) {
  if (isLocalWebhookSetupRequest(req)) return true
  const token = cookies().get('admin_token')?.value
  if (!token) return false
  try { return (await verifyAdminToken(token)).role === 'admin' } catch { return false }
}

export async function POST(req: Request) {
  if (!await canConfigure(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = await getTelegramBotToken()
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 })
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL
    || (() => { const h = new URL(req.url); return `${h.protocol}//${h.host}` })()
  const url = `${TELEGRAM_API}/bot${token}/setWebhook`
  const webhook = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhook, secret_token: telegramWebhookSecret(token), allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'chat_member', 'my_chat_member'], drop_pending_updates: false }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: res.ok && data.ok === true, data, webhook }, { status: res.ok && data.ok === true ? 200 : 502 })
}

export async function DELETE(req: Request) {
  if (!await canConfigure(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = await getTelegramBotToken()
  if (!token) return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 })
  const url = `${TELEGRAM_API}/bot${token}/deleteWebhook`
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000) })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: res.ok && data.ok === true, data }, { status: res.ok && data.ok === true ? 200 : 502 })
}
