import { NextRequest, NextResponse } from 'next/server'

// Official Telegram Bot API endpoint to send a gift to a user
export async function POST(req: NextRequest) {
  try {
    const { userId, giftId, text } = await req.json()

    if (!userId || !giftId) {
      return NextResponse.json(
        { error: 'userId and giftId are required' },
        { status: 400 }
      )
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.error('❌ Missing TELEGRAM_BOT_TOKEN')
      return NextResponse.json(
        { error: 'Bot token not configured' },
        { status: 500 }
      )
    }

    console.log('🎁 Sending gift to user:', { userId, giftId, text })

    // Call official Telegram Bot API sendGift method
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendGift`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          gift_id: giftId,
          text: text || '🎉 Congratulations! You won this gift!',
          text_parse_mode: 'Markdown',
        }),
      }
    )

    const data = await response.json()

    if (!response.ok || !data.ok) {
      console.error('❌ Failed to send gift:', data)
      return NextResponse.json(
        { error: data.description || 'Failed to send gift' },
        { status: response.status }
      )
    }

    console.log('✅ Gift sent successfully:', data)

    return NextResponse.json({
      ok: true,
      result: data.result,
    })
  } catch (error) {
    console.error('❌ Error sending gift:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
