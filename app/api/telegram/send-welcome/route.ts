import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const TELEGRAM_API = 'https://api.telegram.org'

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chatId = user.telegramId
    const { firstName } = await request.json()

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      console.log('⚠️ No TELEGRAM_BOT_TOKEN set')
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 })
    }

    const db = await getDb()
    
    // Check if user already received welcome message
    const userDoc = await db.collection('users').findOne({ telegramId: chatId })
    if (userDoc?.welcomeMessageSent) {
      console.log('ℹ️ Welcome message already sent to user:', chatId)
      return NextResponse.json({ success: true, alreadySent: true })
    }

    // Get startMessage settings
    const row = await db.collection('settings').findOne({ key: 'startMessage' })
    const sm: any = row?.value || {}

    if (!sm.text && !sm.mediaEnabled) {
      console.log('ℹ️ No welcome message configured')
      return NextResponse.json({ success: true, noMessage: true })
    }

    const prefix = `Hello ${firstName || 'User'}, `
    const baseText = typeof sm.text === 'string' ? sm.text : ''
    const caption = `${prefix}${baseText}`.trim()

    if (!caption) {
      return NextResponse.json({ success: true, emptyMessage: true })
    }

    // Build inline keyboard (each button in its own row)
    const buttons = Array.isArray(sm.inlineButtons) ? sm.inlineButtons : []
    const inline = buttons
      .filter((b: any) => b && typeof b.text === 'string' && typeof b.url === 'string' && /^https?:\/\//i.test(b.url))
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      .map((b: any) => [{ text: b.text, url: b.url }]) // Each button in its own row
    const replyMarkup = inline.length ? { inline_keyboard: inline } : undefined

    let sent = false

    if (sm.mediaEnabled && sm.fileId) {
      const cleanedFileId = typeof sm.fileId === 'string' ? sm.fileId.trim() : ''
      const isVideoPreferred = sm.mediaType === 'video'
      
      const tryOrder = isVideoPreferred
        ? ['sendVideo', 'sendAnimation', 'sendPhoto']
        : ['sendPhoto', 'sendVideo', 'sendAnimation']

      for (const method of tryOrder) {
        const field = method.replace('send', '').toLowerCase()
        const url = `${TELEGRAM_API}/bot${token}/${method}`
        const payload: Record<string, any> = { chat_id: chatId }
        if (caption) payload.caption = caption
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup)
        payload[field] = cleanedFileId
        
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        
        if (resp.ok) {
          console.log('✅ Welcome message sent with media via', method)
          sent = true
          break
        }
      }
    }

    // Fallback to text only
    if (!sent) {
      const url = `${TELEGRAM_API}/bot${token}/sendMessage`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: caption, 
          ...(replyMarkup ? { reply_markup: JSON.stringify(replyMarkup) } : {}) 
        })
      })
      
      if (resp.ok) {
        console.log('✅ Welcome message sent as text to:', chatId)
        sent = true
      } else {
        const error = await resp.text()
        console.error('❌ Failed to send welcome message:', error)
      }
    }

    // Mark user as having received welcome message
    if (sent) {
      await db.collection('users').updateOne(
        { telegramId: chatId },
        { $set: { welcomeMessageSent: true, welcomeMessageSentAt: new Date() } }
      )
    }

    return NextResponse.json({ success: true, sent })
  } catch (error: any) {
    console.error('Error sending welcome message:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
