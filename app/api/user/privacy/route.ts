import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSession = await requireUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await withDb(async (db) => db.collection('users').findOne({ _id: new ObjectId(userSession.id) }))
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, anonymousMode: user.anonymousMode === true })
  } catch (error: any) {
    console.error('[API] Get privacy settings error:', error)
    return NextResponse.json({ error: error.message || 'Failed to load privacy settings' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userSession = await requireUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const anonymousMode = body?.anonymousMode

    if (typeof anonymousMode !== 'boolean') {
      return NextResponse.json({ error: 'anonymousMode must be boolean' }, { status: 400 })
    }

    await withDb(async (db) =>
      db.collection('users').updateOne(
        { _id: new ObjectId(userSession.id) },
        { $set: { anonymousMode, updatedAt: new Date() } }
      )
    )

    return NextResponse.json({ success: true, anonymousMode })
  } catch (error: any) {
    console.error('[API] Update privacy settings error:', error)
    return NextResponse.json({ error: error.message || 'Failed to update privacy settings' }, { status: 500 })
  }
}
