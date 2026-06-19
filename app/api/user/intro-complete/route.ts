import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST - Mark user as having completed the intro
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = user.id

    const db = await getDb()
    
    // Update user to mark intro as completed
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          hasCompletedIntro: true,
          introCompletedAt: new Date(),
          updatedAt: new Date()
        } 
      }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error marking intro complete:', error)
    return NextResponse.json(
      { error: 'Failed to save intro completion' },
      { status: 500 }
    )
  }
}
