import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { GiftCategory } from '@/types/category'

// Public endpoint to get active categories for users
export async function GET(req: NextRequest) {
  try {
    const categories = await withDb(async (db) => {
      const categoriesCollection = db.collection<GiftCategory>('categories')
      
      // Get only active categories sorted by order
      const activeCategories = await categoriesCollection
        .find({ isActive: true })
        .sort({ order: 1 })
        .toArray()
      
      return activeCategories
    })

    return NextResponse.json({ success: true, categories })
  } catch (error) {
    console.error('Error fetching public categories:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}
