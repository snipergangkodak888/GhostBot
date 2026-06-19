import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function isAdmin(): Promise<boolean> {
  try {
    const token = cookies().get('admin_token')?.value
    if (!token) return false
    const result = await verifyAdminToken(token)
    return !!result
  } catch {
    return false
  }
}

async function fetchLiveStats() {
  const db = await getDb()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const dateKey = todayStart.toISOString().slice(0, 10)
  const [activeUsersToday, newUsersToday, totalUsers] = await Promise.all([
    db.collection('dailyActivity').countDocuments({ date: dateKey }),
    db.collection('users').countDocuments({ createdAt: { $gte: todayStart } }),
    db.collection('users').estimatedDocumentCount(),
  ])

  // Persist daily snapshot for chart history (upsert today's record)
  db.collection('dailyStats').updateOne(
    { date: dateKey },
    {
      $set: {
        date: dateKey,
        activeUsers: activeUsersToday,
        newUsers: newUsersToday,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  ).catch(() => {})

  return { activeUsersToday, newUsersToday, totalUsers, timestamp: Date.now() }
}

export async function GET(req: NextRequest) {
  const authorized = await isAdmin()
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const send = (data: object) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      // Send immediately on connect
      try {
        send(await fetchLiveStats())
      } catch {
        controller.close()
        return
      }

      // Then every 30 seconds
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval)
          return
        }
        try {
          send(await fetchLiveStats())
        } catch {
          clearInterval(interval)
          if (!closed) {
            closed = true
            controller.close()
          }
        }
      }, 30_000)

      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(interval)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
