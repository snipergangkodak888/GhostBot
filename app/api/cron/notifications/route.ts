/**
 * Vercel Cron Job — Automated Notifications
 * Runs on schedule (see vercel.json)
 * Cyprus timezone: Asia/Nicosia (UTC+2 / UTC+3 DST)
 *
 * Auth:
 *  - Vercel cron: Authorization: Bearer <CRON_SECRET>
 *  - Admin manual trigger: x-admin-trigger: true + valid admin cookie
 *  - No CRON_SECRET set: open (dev mode)
 *
 * Notification types:
 *  1. daily-energy   — remind active users their energy refills each day
 *  2. inactivity     — users inactive ≥ 3 days
 *  3. pending-reward — users with unclaimed coupon rewards
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large user bases

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!

const INACTIVITY_DAYS = 3

async function getCronSecret(): Promise<string | null> {
  // Env var takes priority; fall back to DB setting
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET
  try {
    const db = await getDb()
    const row = await db.collection('settings').findOne({ key: 'cronSecret' })
    return (row?.value as string) || null
  } catch {
    return null
  }
}

async function authorize(req: NextRequest): Promise<boolean> {
  // Path 1: Bearer header or ?secret= query param
  const authHeader = req.headers.get('authorization')
  const secret = await getCronSecret()
  if (secret && authHeader === `Bearer ${secret}`) return true
  const querySecret = req.nextUrl.searchParams.get('secret')
  if (secret && querySecret === secret) return true

  // Path 2: Admin manual trigger header + cookie
  if (req.headers.get('x-admin-trigger') === 'true') {
    // Try cookie forwarded via header
    const cookieHeader = req.headers.get('cookie') || ''
    const match = cookieHeader.match(/admin_token=([^;]+)/)
    if (match) {
      try { await verifyAdminToken(match[1]); return true } catch { /* fall */ }
    }
    // Try next/headers
    try {
      const token = cookies().get('admin_token')?.value
      if (token) { await verifyAdminToken(token); return true }
    } catch { /* fall */ }
  }

  // Path 3: No secret configured — open (dev)
  if (!secret) return true

  return false
}

async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: object): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function runDailyEnergy(db: Awaited<ReturnType<typeof getDb>>) {
  // Notify all active users (active in last 30 days) about daily energy
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const users = await db.collection('users')
    .find({ lastSeen: { $gte: cutoff }, telegramId: { $exists: true } }, { projection: { telegramId: 1, firstName: 1 } })
    .toArray()

  let sent = 0
  let failed = 0

  for (const user of users) {
    const name = user.firstName ? `${user.firstName}` : 'there'
    const ok = await sendTelegramMessage(user.telegramId, `⚡ <b>Daily Energy Ready!</b>\n\nHey ${name}, your energy has refilled — come back and play! 🎮\n\n👉 Open VivatApp to collect your rewards.`)
    if (ok) sent++; else failed++
  }

  return { type: 'daily-energy', sent, failed, total: users.length }
}

async function runInactivityCheck(db: Awaited<ReturnType<typeof getDb>>) {
  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000)
  const olderCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Users last seen between 3–30 days ago who haven't received an inactivity nudge today
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const users = await db.collection('users')
    .find({
      lastSeen: { $gte: olderCutoff, $lt: cutoff },
      telegramId: { $exists: true },
      $or: [
        { lastInactivityNotif: { $exists: false } },
        { lastInactivityNotif: { $lt: todayStart } },
      ],
    }, { projection: { telegramId: 1, firstName: 1, _id: 1 } })
    .limit(500)
    .toArray()

  let sent = 0
  let failed = 0

  for (const user of users) {
    const name = user.firstName || 'there'
    const ok = await sendTelegramMessage(
      user.telegramId,
      `🌟 <b>We miss you, ${name}!</b>\n\nIt's been a while since you last played VivatApp. Your rewards are waiting for you!\n\n🎁 Come back to spin, predict, and win — your streak can still be saved! 🔥`,
    )
    if (ok) {
      sent++
      await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactivityNotif: new Date() } })
    } else {
      failed++
    }
  }

  return { type: 'inactivity', sent, failed, total: users.length }
}

async function runPendingReward(db: Awaited<ReturnType<typeof getDb>>) {
  // Users who have a coupon assigned but haven't been told yet (notifiedCoupon flag)
  const users = await db.collection('userCoupons')
    .aggregate([
      { $match: { notified: { $ne: true } } },
      { $group: { _id: '$telegramId', coupons: { $push: '$$ROOT' } } },
    ])
    .limit(200)
    .toArray()

  let sent = 0
  let failed = 0

  for (const entry of users) {
    const count = entry.coupons.length
    const ok = await sendTelegramMessage(
      entry._id,
      `🎁 <b>You have ${count} unclaimed reward${count > 1 ? 's' : ''}!</b>\n\nOpen VivatApp to view and use your promo code${count > 1 ? 's' : ''}. Don't let them expire! 🕐`,
    )
    if (ok) {
      sent++
      await db.collection('userCoupons').updateMany(
        { telegramId: entry._id, notified: { $ne: true } },
        { $set: { notified: true } }
      )
    } else {
      failed++
    }
  }

  return { type: 'pending-reward', sent, failed, total: users.length }
}

// ── NEW: Available tasks reminder (every 48 h per user) ──────────────────────
async function runAvailableTasks(db: Awaited<ReturnType<typeof getDb>>) {
  const now = new Date()
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const active30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  let sent = 0; let failed = 0; let total = 0
  // Atomically claim each eligible user by stamping lastTasksNotif before sending
  // Prevents double-sends when master and notifications crons run concurrently
  while (true) {
    const user = await db.collection('users').findOneAndUpdate(
      {
        lastSeen: { $gte: active30d },
        telegramId: { $exists: true },
        $or: [
          { lastTasksNotif: { $exists: false } },
          { lastTasksNotif: { $lt: cutoff48h } },
        ],
      },
      { $set: { lastTasksNotif: now } },
      { returnDocument: 'before', projection: { telegramId: 1, firstName: 1, _id: 1 } }
    )
    if (!user) break
    total++
    if (total > 500) break // safety cap

    // Count how many tasks they haven't completed
    const completedIds = await db.collection('taskCompletions')
      .distinct('taskId', { telegramId: user.telegramId })
    const pendingCount = await db.collection('tasks').countDocuments({
      active: true,
      taskId: { $nin: completedIds },
    })
    if (pendingCount === 0) continue

    const name = user.firstName || 'there'
    const ok = await sendTelegramMessage(user.telegramId,
      `📋 <b>You have ${pendingCount} mission${pendingCount > 1 ? 's' : ''} waiting, ${name}!</b>\n\nComplete them to earn Energy rewards ⚡\n\n👉 Open VivatApp → Missions to claim your rewards.`
    )
    if (ok) {
      sent++
    } else {
      failed++
      // Roll back the stamp so the user can be retried next run
      await db.collection('users').updateOne({ _id: user._id }, { $set: { lastTasksNotif: new Date(0) } })
    }
  }
  return { type: 'available-tasks', sent, failed, total }
}

// ── NEW: Daily check-in reminder ─────────────────────────────────────────────
async function runDailyCheckin(db: Awaited<ReturnType<typeof getDb>>) {
  const now = new Date()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const active14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  let sent = 0; let failed = 0; let total = 0
  // Atomically claim each eligible user to prevent double-send from concurrent cron runs
  while (true) {
    const user = await db.collection('users').findOneAndUpdate(
      {
        lastSeen: { $gte: active14d },
        telegramId: { $exists: true },
        $or: [
          { lastStreakClaim: { $exists: false } },
          { lastStreakClaim: { $lt: todayStart } },
        ],
        $and: [
          { $or: [{ lastCheckinNotif: { $exists: false } }, { lastCheckinNotif: { $lt: todayStart } }] }
        ],
      },
      { $set: { lastCheckinNotif: now } },
      { returnDocument: 'before', projection: { telegramId: 1, firstName: 1, _id: 1, dailyStreak: 1 } }
    )
    if (!user) break
    total++
    if (total > 500) break // safety cap

    const name = user.firstName || 'there'
    const streak = user.dailyStreak || 0
    const ok = await sendTelegramMessage(user.telegramId,
      `🔥 <b>Daily Check-in Ready, ${name}!</b>\n\n${streak > 0 ? `You're on a <b>${streak}-day streak</b> — don't break it! 🔥` : "Start your streak today for bonus rewards!"}\n\nClaim your daily reward now ⚡\n\n👉 Open VivatApp → Missions`
    )
    if (ok) {
      sent++
    } else {
      failed++
      // Roll back the stamp so the user can be retried next run
      await db.collection('users').updateOne({ _id: user._id }, { $set: { lastCheckinNotif: new Date(0) } })
    }
  }
  return { type: 'daily-checkin', sent, failed, total }
}

// ── NEW: Inactive 48 h — re-engagement with Play button ──────────────────────
async function runInactive48h(db: Awaited<ReturnType<typeof getDb>>) {
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const cutoff96h = new Date(Date.now() - 96 * 60 * 60 * 1000) // don't spam: only 48–96 h window

  const settingsRow = await db.collection('settings').findOne({ key: 'appUrl' })
  const appUrl = settingsRow?.value || process.env.NEXT_PUBLIC_BASE_URL || 'https://t.me/YOUR_BOT_USERNAME/app'

  const users = await db.collection('users').find({
    lastSeen: { $gte: cutoff96h, $lt: cutoff48h },
    telegramId: { $exists: true },
    $or: [
      { lastInactive48Notif: { $exists: false } },
      { lastInactive48Notif: { $lt: cutoff96h } },
    ],
  }, { projection: { telegramId: 1, firstName: 1, _id: 1 } }).limit(500).toArray()

  let sent = 0; let failed = 0
  for (const user of users) {
    const name = user.firstName || 'there'
    const ok = await sendTelegramMessage(user.telegramId,
      `👋 <b>Hey ${name}, we miss you!</b>\n\nYour energy is full and your rewards are waiting.\nDon't let your streak die — come back and play! 🔥`,
      {
        inline_keyboard: [[
          { text: '🎮 Play Now', url: appUrl },
        ]],
      }
    )
    if (ok) {
      sent++
      await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactive48Notif: new Date() } })
    } else { failed++ }
  }
  return { type: 'inactive-48h', sent, failed, total: users.length }
}

export async function GET(req: NextRequest) {
  const allowed = await authorize(req)

  const type = req.nextUrl.searchParams.get('type') || 'daily-energy'

  if (!BOT_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })

  const db = await getDb()
  let result: { type: string; sent: number; failed: number; total: number }

  switch (type) {
    case 'daily-energy':
      result = await runDailyEnergy(db)
      break
    case 'inactivity':
      result = await runInactivityCheck(db)
      break
    case 'pending-reward':
      result = await runPendingReward(db)
      break
    case 'available-tasks':
      result = await runAvailableTasks(db)
      break
    case 'daily-checkin':
      result = await runDailyCheckin(db)
      break
    case 'inactive-48h':
      result = await runInactive48h(db)
      break
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 })
  }

  // Persist run log
  await db.collection('cronLogs').insertOne({
    ...result,
    runAt: new Date(),
    triggeredBy: req.headers.get('x-admin-trigger') === 'true' ? 'admin' : 'schedule',
  })

  console.log(`[cron/notifications] ${type}:`, result)
  return NextResponse.json({ ok: true, ...result })
}
