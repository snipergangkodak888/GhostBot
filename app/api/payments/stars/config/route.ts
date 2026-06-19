import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET Stars payment configuration for frontend
export async function GET(req: NextRequest) {
  try {
    const db = await getDb()

    // Get stars payment settings (stored with key 'starsPayment')
    const settingsDoc = await db.collection('settings').findOne({ key: 'starsPayment' })
    const starsPayment = settingsDoc?.value || {}

    if (!starsPayment.enabled) {
      return NextResponse.json({
        enabled: false,
        message: 'Stars payment is not enabled'
      })
    }

    // Get active packages
    const packages = (starsPayment.packages || [])
      .filter((pkg: { active: boolean }) => pkg.active)
      .map((pkg: { id: string; spins: number; priceStars: number }) => ({
        id: pkg.id,
        spins: pkg.spins,
        priceStars: pkg.priceStars
      }))

    return NextResponse.json({
      enabled: true,
      packagesOnly: starsPayment.packagesOnly || false,
      pricePerSpin: starsPayment.pricePerSpin || 1,
      packages
    })
  } catch (error) {
    console.error('❌ Get stars config error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
