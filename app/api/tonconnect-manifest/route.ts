import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Serve dynamic TON Connect manifest based on admin settings
export async function GET() {
  try {
    const db = await getDb()
    
    // Get platform settings
    const settingsDoc = await db.collection('settings').findOne({ key: 'platformSettings' })
    const settings = settingsDoc?.value || {}
    const manifest = settings.tonConnectManifest || {}

    // Fallback to defaults if not configured
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-app-url.com'
    
    const tonConnectManifest = {
      url: manifest.url || appUrl,
      name: manifest.name || settings.platformName || 'Metal',
      iconUrl: manifest.iconUrl || settings.logoUrl || `${appUrl}/favicon.ico`,
      termsOfUseUrl: manifest.termsOfUseUrl || `${appUrl}/terms`,
      privacyPolicyUrl: manifest.privacyPolicyUrl || `${appUrl}/privacy`
    }

    return NextResponse.json(tonConnectManifest, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    })
  } catch (error) {
    console.error('Error serving TON Connect manifest:', error)
    
    // Return a basic manifest on error
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-app-url.com'
    return NextResponse.json({
      url: appUrl,
      name: 'Metal',
      iconUrl: `${appUrl}/favicon.ico`,
      termsOfUseUrl: `${appUrl}/terms`,
      privacyPolicyUrl: `${appUrl}/privacy`
    })
  }
}
