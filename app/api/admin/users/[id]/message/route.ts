import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

const TELEGRAM_API = 'https://api.telegram.org'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { telegramId, message } = await request.json()
    
    if (!telegramId || !message) {
      return NextResponse.json({ error: 'Missing telegramId or message' }, { status: 400 })
    }

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 })
    }

    // Send message via Telegram Bot API
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'HTML'
      })
    })

    const result = await response.json()

    if (!result.ok) {
      console.error('Telegram API error:', result)
      return NextResponse.json({ 
        error: result.description || 'Failed to send message',
        code: result.error_code 
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, messageId: result.result?.message_id })
  } catch (error) {
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
