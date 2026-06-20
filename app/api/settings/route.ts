import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Public endpoint to get settings (no auth required)
export async function GET() {
  try {
    const db = await getDb()
    const rows = await db.collection('settings').find({}).toArray()
    const settings = rows.reduce((acc: Record<string, unknown>, s: any) => {
      acc[s.key] = s.value
      return acc
    }, {})
    
    // Only return public settings
    return NextResponse.json({ 
      settings: {
        platformName: settings.platformName || 'KickQ',
        logoUrl: settings.logoUrl || '',
        telegramBotUsername: settings.telegramBotUsername || ''
      }
    })
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json({ 
      settings: {
        platformName: 'KickQ',
        logoUrl: '',
        telegramBotUsername: ''
      }
    })
  }
}
