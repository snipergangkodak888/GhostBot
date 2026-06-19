import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

const TELEGRAM_API = 'https://api.telegram.org'

type PushTarget = 'bot_users' | 'channels' | 'both'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { message, target = 'both' } = body as { message: any; target: PushTarget }
    
    if (!message || !message.text) {
      return NextResponse.json({ error: 'Message text is required' }, { status: 400 })
    }

    const db = await getDb()
    
    // Get bot token from settings or env
    const settingsRow = await db.collection('settings').findOne({ key: 'telegramBotToken' })
    const token = settingsRow?.value || process.env.TELEGRAM_BOT_TOKEN
    
    if (!token) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 })
    }

    // Prepare payload
    const text = message.text
    const mediaUrl = message.fileId
    const mediaType = message.mediaType || 'photo'
    const buttons = message.inlineButtons || []
    
    const replyMarkup = buttons.length > 0 ? {
      inline_keyboard: [
        buttons.map((b: any) => ({ text: b.text, url: b.url }))
      ]
    } : undefined

    let successCount = 0
    let failCount = 0
    
    // Helper function to send message to a chat
    const sendToChat = async (chatId: string | number): Promise<boolean> => {
      let sent = false
      
      if (message.mediaEnabled && mediaUrl) {
        const method = mediaType === 'video' ? 'sendVideo' : 'sendPhoto'
        const field = mediaType === 'video' ? 'video' : 'photo'
        
        const url = `${TELEGRAM_API}/bot${token}/${method}`
        const payload: any = {
          chat_id: chatId,
          caption: text,
          [field]: mediaUrl,
          parse_mode: 'HTML'
        }
        if (replyMarkup) payload.reply_markup = replyMarkup

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          if (res.ok) sent = true
        } catch (e) {
          console.error(`Failed to send media to ${chatId}`, e)
        }
      }
      
      if (!message.mediaEnabled || !sent) {
        const url = `${TELEGRAM_API}/bot${token}/sendMessage`
        const payload: any = {
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        }
        if (replyMarkup) payload.reply_markup = replyMarkup

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          if (res.ok) sent = true
        } catch (e) {
          console.error(`Failed to send text to ${chatId}`, e)
        }
      }
      
      return sent
    }

    // Send to channels if target is 'channels' or 'both'
    if (target === 'channels' || target === 'both') {
      const channels = await db.collection('channels').find({ isActive: true }).toArray()
      
      for (const channel of channels) {
        const sent = await sendToChat(channel.chatId)
        if (sent) successCount++
        else failCount++
      }
    }

    // Send to bot users if target is 'bot_users' or 'both'
    if (target === 'bot_users' || target === 'both') {
      // Get all users with telegram ID
      const users = await db.collection('users').find({ 
        telegramId: { $exists: true, $ne: null }
      }).toArray()
      
      for (const user of users) {
        const sent = await sendToChat(user.telegramId)
        if (sent) successCount++
        else failCount++
        
        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    // Log the broadcast
    await db.collection('broadcasts').insertOne({
      message,
      target,
      successCount,
      failCount,
      createdAt: new Date()
    })

    return NextResponse.json({ success: true, count: successCount, failed: failCount })
  } catch (error) {
    console.error('Broadcast error:', error)
    return NextResponse.json({ error: 'Broadcast failed' }, { status: 500 })
  }
}

// GET broadcast history
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const db = await getDb()
    const [broadcasts, total] = await Promise.all([
      db.collection('broadcasts').find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('broadcasts').countDocuments({})
    ])

    return NextResponse.json({
      broadcasts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch broadcasts' }, { status: 500 })
  }
}
