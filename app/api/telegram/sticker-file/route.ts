import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

// Endpoint to get sticker file URL for display in Mini App
// Uses getFile Bot API method to get download URL
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('file_id')

    if (!fileId) {
      return NextResponse.json({ error: 'file_id required' }, { status: 400 })
    }

    console.log('🎁 [STICKER-FILE] Getting file path for:', fileId)

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.error('🎁 [STICKER-FILE] TELEGRAM_BOT_TOKEN not configured')
      return NextResponse.json(
        { error: 'Bot token not configured' },
        { status: 500 }
      )
    }

    // Official Bot API method to get file path
    // https://core.telegram.org/bots/api#getfile
    const apiUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    
    const response = await fetch(apiUrl)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('🎁 [STICKER-FILE] API error:', response.status, errorText)
      return NextResponse.json(
        { error: 'Failed to get file from Telegram' },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    if (!data.ok || !data.result?.file_path) {
      console.error('🎁 [STICKER-FILE] Invalid response:', data)
      return NextResponse.json(
        { error: 'Invalid response from Telegram API' },
        { status: 500 }
      )
    }

    // Construct the full download URL
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`
    console.log('🎁 [STICKER-FILE] File URL:', fileUrl)

    return NextResponse.json({
      ok: true,
      file_url: fileUrl,
      file_path: data.result.file_path,
      file_size: data.result.file_size,
    })

  } catch (error) {
    console.error('🎁 [STICKER-FILE] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
