import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { getTelegramBotToken } from '@/lib/telegram-bot'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// POST - Auto-setup Telegram webhook for Stars payments
export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const botToken = await getTelegramBotToken()
    
    if (!botToken) {
      return NextResponse.json(
        { error: 'Telegram bot token is not configured' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : ''

    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Webhook URL is required. Open Settings from your real domain and click setup again.' },
        { status: 400 }
      )
    }

    if (!/^https:\/\/[^/]+\/api\/telegram\/webhook$/i.test(webhookUrl)) {
      return NextResponse.json(
        { error: 'Webhook URL must be an HTTPS domain ending with /api/telegram/webhook' },
        { status: 400 }
      )
    }

    console.log('🔧 Setting up Telegram webhook:', webhookUrl)

    // Call Telegram setWebhook API
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          drop_pending_updates: false
        })
      }
    )

    const result = await telegramResponse.json()

    if (!result.ok) {
      console.error('❌ Telegram setWebhook failed:', result)
      return NextResponse.json(
        { error: result.description || 'Failed to set webhook', details: result },
        { status: 400 }
      )
    }

    console.log('✅ Webhook set successfully:', result)

    // Get webhook info to confirm
    const infoResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    )
    const webhookInfo = await infoResponse.json()

    return NextResponse.json({
      success: true,
      message: 'Webhook configured successfully!',
      webhookUrl,
      tokenConfigured: true,
      webhookInfo: webhookInfo.result
    })

  } catch (error) {
    console.error('❌ Setup webhook error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET - Check current webhook status
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const botToken = await getTelegramBotToken()
    
    if (!botToken) {
      return NextResponse.json(
        { error: 'Telegram bot token is not configured', tokenConfigured: false },
        { status: 400 }
      )
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    )
    const result = await response.json()

    if (!result.ok) {
      return NextResponse.json(
        { error: result.description || 'Failed to get webhook info' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      tokenConfigured: true,
      webhook: result.result
    })

  } catch (error) {
    console.error('❌ Get webhook info error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
