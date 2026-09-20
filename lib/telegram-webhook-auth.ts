import { createHmac, timingSafeEqual } from 'node:crypto'

/** Separate the webhook credential from the bot API token without another secret. */
export function telegramWebhookSecret(botToken: string): string {
  if (!botToken) throw new Error('A Telegram bot token is required')
  return createHmac('sha256', botToken).update('ghostbot:telegram-webhook:v1').digest('hex')
}

/** Check before parsing an update or performing any Telegram/account actions. */
export function isTelegramWebhookRequest(request: Pick<Request, 'headers'>, botToken: string): boolean {
  const supplied = request.headers.get('x-telegram-bot-api-secret-token')
  if (!botToken || !supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(telegramWebhookSecret(botToken), 'hex'))
}

/** Keep the local dev-bot bootstrap usable without opening public setup routes. */
export function isLocalWebhookSetupRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
  const url = new URL(request.url)
  if (!loopback(url.hostname)) return false
  for (const name of ['host', 'x-forwarded-host']) {
    const value = request.headers.get(name)
    if (value && value.toLowerCase() !== url.host.toLowerCase()) return false
  }
  const origin = request.headers.get('origin')
  if (origin && origin !== url.origin) return false
  return request.headers.get('sec-fetch-site') !== 'cross-site'
}
