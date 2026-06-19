import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Telegram Mini App bootstrap endpoint
// Accepts telegramId (string) and creates or fetches the user once, returning unified data in one response.
export async function POST(req: Request) {
  try {
    const { telegramId, profile } = await req.json()
    if (!telegramId) return NextResponse.json({ error: 'Missing telegramId' }, { status: 400 })

    const db = await getDb()
    const users = db.collection('users')
    // Upsert user by telegramId
    const now = new Date()
    const update = {
      $setOnInsert: { createdAt: now },
      $set: { updatedAt: now, ...(profile ? { profile } : {}) },
    }
    await users.updateOne({ telegramId }, update, { upsert: true })
    const user = await users.findOne({ telegramId })

    // Unified one-connection fetch for dashboard
    // NOTE: Do not include raw settings here. This endpoint is unauthenticated
    // and returning settings can leak secrets (e.g. callback/API keys).
    const [spins, rewards] = await Promise.all([
      db
        .collection('spins')
        .find({ userId: user?._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
      db
        .collection('rewards')
        .find({ userId: user?._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
    ])

    return NextResponse.json({ user, spins, rewards })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Bootstrap failed' }, { status: 500 })
  }
}
