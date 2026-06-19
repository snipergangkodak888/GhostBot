import { NextResponse } from 'next/server'

const TELEGRAM_API = 'https://api.telegram.org'

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN
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
    body: JSON.stringify({ url: webhook, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] })
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: true, data, webhook })
}

export async function DELETE() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 })
  const url = `${TELEGRAM_API}/bot${token}/deleteWebhook`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: true, data })
}
