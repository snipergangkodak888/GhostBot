import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { TelegramGift } from '@/types/gifts'

export const dynamic = 'force-dynamic'

// Public endpoint to get active gifts for users
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('categoryId')
    
    console.log('🎁 [API] Fetching active gifts from database...', categoryId ? `for category: ${categoryId}` : 'all')
        
    const gifts = await withDb(async (db) => {
      console.log('🎁 [API] Connected to database:', db.databaseName)
      const giftsCollection = db.collection<TelegramGift>('gifts')
      
      // Build query filter
      const filter: Record<string, unknown> = { isActive: true }
      if (categoryId) {
        filter.categoryId = categoryId
      }
      
      const allGifts = await giftsCollection.find({}).toArray()
      console.log('🎁 [API] Total gifts in DB:', allGifts.length)
      
      if (allGifts.length === 0) {
        console.warn('🎁 [API] ⚠️ No gifts found in database! Please add gifts via admin panel.')
        return []
      }
      
      console.log('🎁 [API] All gifts:', allGifts.map(g => ({ 
        slug: g.giftSlug, 
        active: g.isActive,
        name: g.name,
        categoryId: g.categoryId
      })))
      
      const activeGifts = await giftsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray()
      
      console.log('🎁 [API] Active gifts found:', activeGifts.length, categoryId ? `(filtered by category: ${categoryId})` : '')
      
      if (activeGifts.length === 0) {
        console.warn('🎁 [API] ⚠️ No active gifts!' + (categoryId ? ` No gifts in category ${categoryId}` : ' All gifts are inactive.'))
      }
      
      return activeGifts
    })

    console.log('🎁 [API] Returning gifts:', gifts.length)
    return NextResponse.json({ success: true, gifts })
  } catch (error) {
    console.error('🎁 [API] ❌ Error fetching public gifts:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}
