import { NextResponse } from 'next/server'
import { AvailableGiftsResponse } from '@/types/gifts'

// Public endpoint to fetch available gifts from Telegram Bot API
// This uses the official getAvailableGifts method
export async function GET() {
  try {
    console.log('🎁 [AVAILABLE-GIFTS] Fetching from Telegram Bot API...')

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.error('🎁 [AVAILABLE-GIFTS] TELEGRAM_BOT_TOKEN not configured')
      return NextResponse.json(
        { error: 'Bot token not configured' },
        { status: 500 }
      )
    }

    // Official Telegram Bot API method
    // https://core.telegram.org/bots/api#getavailablegifts
    const apiUrl = `https://api.telegram.org/bot${botToken}/getAvailableGifts`
    console.log('🎁 [AVAILABLE-GIFTS] Calling:', apiUrl)

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('🎁 [AVAILABLE-GIFTS] API error:', response.status, errorText)
      return NextResponse.json(
        { error: 'Failed to fetch gifts from Telegram', details: errorText },
        { status: response.status }
      )
    }

    const data: AvailableGiftsResponse = await response.json()
    console.log('🎁 [AVAILABLE-GIFTS] Received', data.result?.gifts?.length || 0, 'gifts')

    if (!data.ok || !data.result?.gifts) {
      console.error('🎁 [AVAILABLE-GIFTS] Invalid response structure:', data)
      return NextResponse.json(
        { error: 'Invalid response from Telegram API' },
        { status: 500 }
      )
    }

    console.log('🎁 [AVAILABLE-GIFTS] Success, returning gifts')
    return NextResponse.json(data)

  } catch (error) {
    console.error('🎁 [AVAILABLE-GIFTS] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
