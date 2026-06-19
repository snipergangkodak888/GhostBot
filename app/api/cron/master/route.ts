/**
 * Vercel Cron Job — Master / Unified Runner
 * Runs all scheduled jobs in one request (recommended: every 15–60 min)
 *
 * Jobs:
 *  1. notifQueue      — sends Telegram messages from the notifQueue collection
 *                       (enqueued by other parts of the app), cleans up >24h sent docs
 *  2. pending-reward  — notifies users who have assigned promo codes they haven't heard about
 *  3. predictions     — resolves matches where admin staged a winner (status=open, winner set)
 *                       awards energy to winners and sends win/loss messages
 *  4. daily-energy    — reminds active users their energy has refilled (once/day)
 *  5. inactivity      — win-back nudge for users inactive 3–30 days (once/day)
 *  6. available-tasks — reminds users about pending missions (every 48 h)
 *  7. daily-checkin   — streak claim reminder for users who haven't checked in today
 *  8. inactive-48h    — re-engagement with Play Now button for users inactive 48–96 h
 *
 * Auth: Bearer <cronSecret> header, ?secret= query param, or admin cookie
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getCronSecret(): Promise<string | null> {
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
  const secret = await getCronSecret()

  // Bearer header
  const authHeader = req.headers.get('authorization')
  if (secret && authHeader === `Bearer ${secret}`) return true

  // ?secret= query param
  const querySecret = req.nextUrl.searchParams.get('secret')
  if (secret && querySecret === secret) return true

  if (req.headers.get('x-admin-trigger') === 'true') {
    const cookieHeader = req.headers.get('cookie') || ''
    const match = cookieHeader.match(/admin_token=([^;]+)/)
    if (match) {
      try { await verifyAdminToken(match[1]); return true } catch { /* fall */ }
    }
    try {
      const token = cookies().get('admin_token')?.value
      if (token) { await verifyAdminToken(token); return true }
    } catch { /* fall */ }
  }

  if (!secret) return true
  return false
}

// ─── Telegram helper ─────────────────────────────────────────────────────────

async function sendTg(chatId: string | number, text: string, replyMarkup?: object): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Global Anti-Spam (3 hours) ────────────────────────────────────────────────
const getSpamThrottle = () => ({
  $or: [
    { lastCronNotifTime: { $exists: false } },
    { lastCronNotifTime: { $lt: new Date(Date.now() - 3 * 60 * 60 * 1000) } }
  ]
})

// ─── Job 4: daily-energy ─────────────────────────────────────────────────────

async function runDailyEnergy(db: Awaited<ReturnType<typeof getDb>>, appUrl: string) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const users = await db.collection('users')
    .find({
      lastActive: { $gte: cutoff }, telegramId: { $exists: true },
      $and: [getSpamThrottle()],
      $or: [{ lastDailyEnergyNotif: { $exists: false } }, { lastDailyEnergyNotif: { $lt: todayStart } }],
    }, { projection: { telegramId: 1, firstName: 1, _id: 1 } })
    .limit(500).toArray()
  let sent = 0, failed = 0
  for (const user of users) {
    const name = user.firstName || 'there'
    await db.collection('notifQueue').insertOne({
      telegramId: user.telegramId,
      message: `⚡ <b>Daily Energy Ready!</b>\n\nHey ${name}, your energy has refilled — come back and play! 🎮`,
      replyMarkup: { inline_keyboard: [[{ text: '🎮 Play Now', url: appUrl }]] },
      status: 'pending',
      createdAt: new Date()
    })
    sent++;
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastDailyEnergyNotif: new Date(), lastCronNotifTime: new Date() } })
  }
  return { job: 'dailyEnergy', sent, failed, total: users.length }
}

// ─── Job 5: inactivity (3-day) ───────────────────────────────────────────────

async function runInactivity(db: Awaited<ReturnType<typeof getDb>>, appUrl: string) {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const olderCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const users = await db.collection('users').find({
    lastActive: { $gte: olderCutoff, $lt: cutoff },
    telegramId: { $exists: true },
    $and: [getSpamThrottle()],
    $or: [{ lastInactivityNotif: { $exists: false } }, { lastInactivityNotif: { $lt: todayStart } }],
  }, { projection: { telegramId: 1, firstName: 1, _id: 1 } }).limit(500).toArray()
  let sent = 0, failed = 0
  for (const user of users) {
    const name = user.firstName || 'there'
    await db.collection('notifQueue').insertOne({
      telegramId: user.telegramId,
      message: `🌟 <b>We miss you, ${name}!</b>\n\nIt's been a while since you last played. Your rewards are waiting! 🎁`,
      replyMarkup: { inline_keyboard: [[{ text: '🎮 Play Now', url: appUrl }]] },
      status: 'pending',
      createdAt: new Date()
    })
    sent++;
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactivityNotif: new Date(), lastCronNotifTime: new Date() } })
  }
  return { job: 'inactivity', sent, failed, total: users.length }
}

// ─── Job 6: available-tasks ──────────────────────────────────────────────────

async function runAvailableTasks(db: Awaited<ReturnType<typeof getDb>>, appUrl: string) {
  const now = new Date()
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const active30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const spamCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
  let sent = 0, failed = 0, total = 0
  // Atomically claim each eligible user by stamping lastTasksNotif before sending
  // This prevents double-sends when master and notifications crons run concurrently
  while (true) {
    const user = await db.collection('users').findOneAndUpdate(
      {
        lastActive: { $gte: active30d },
        telegramId: { $exists: true },
        $or: [{ lastTasksNotif: { $exists: false } }, { lastTasksNotif: { $lt: cutoff48h } }],
        $and: [
          { $or: [{ lastCronNotifTime: { $exists: false } }, { lastCronNotifTime: { $lt: spamCutoff } }] }
        ],
      },
      { $set: { lastTasksNotif: now, lastCronNotifTime: now } },
      { returnDocument: 'before', projection: { telegramId: 1, firstName: 1, _id: 1 } }
    )
    if (!user) break
    total++
    if (total > 500) break // safety cap
    const completedIds = await db.collection('taskCompletions').distinct('taskId', { telegramId: user.telegramId })
    const pendingCount = await db.collection('tasks').countDocuments({ active: true, taskId: { $nin: completedIds } })
    if (pendingCount === 0) continue
    const name = user.firstName || 'there'
    await db.collection('notifQueue').insertOne({
      telegramId: user.telegramId,
      message: `📋 <b>You have ${pendingCount} mission${pendingCount > 1 ? 's' : ''} waiting, ${name}!</b>\n\nComplete them to earn Energy rewards ⚡`,
      replyMarkup: { inline_keyboard: [[{ text: '🎯 Go to Missions', url: appUrl }]] },
      status: 'pending',
      createdAt: new Date()
    })
    sent++
  }
  return { job: 'availableTasks', sent, failed, total }
}

// ─── Job 7: daily check-in reminder ─────────────────────────────────────────

async function runDailyCheckin(db: Awaited<ReturnType<typeof getDb>>, appUrl: string) {
  const now = new Date()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const active14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const spamCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
  let sent = 0, failed = 0, total = 0
  // Atomically claim each eligible user to prevent double-send from concurrent cron runs
  while (true) {
    const user = await db.collection('users').findOneAndUpdate(
      {
        lastActive: { $gte: active14d },
        telegramId: { $exists: true },
        $or: [{ lastStreakClaim: { $exists: false } }, { lastStreakClaim: { $lt: todayStart } }],
        $and: [
          { $or: [{ lastCheckinNotif: { $exists: false } }, { lastCheckinNotif: { $lt: todayStart } }] },
          { $or: [{ lastCronNotifTime: { $exists: false } }, { lastCronNotifTime: { $lt: spamCutoff } }] },
        ],
      },
      { $set: { lastCheckinNotif: now, lastCronNotifTime: now } },
      { returnDocument: 'before', projection: { telegramId: 1, firstName: 1, _id: 1, dailyStreak: 1 } }
    )
    if (!user) break
    total++
    if (total > 500) break // safety cap
    const name = user.firstName || 'there'
    const streak = user.dailyStreak || 0
    await db.collection('notifQueue').insertOne({
      telegramId: user.telegramId,
      message: `🔥 <b>Daily Check-in Ready, ${name}!</b>\n\n${streak > 0 ? `You're on a <b>${streak}-day streak</b> — don't break it! 🔥` : 'Start your streak today for bonus rewards!'}\n\nClaim your daily reward now ⚡`,
      replyMarkup: { inline_keyboard: [[{ text: '✅ Claim Now', url: appUrl }]] },
      status: 'pending',
      createdAt: new Date()
    })
    sent++
  }
  return { job: 'dailyCheckin', sent, failed, total }
}

// ─── Job 8: inactive 48h re-engagement ──────────────────────────────────────

async function runInactive48h(db: Awaited<ReturnType<typeof getDb>>, appUrl: string) {
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const cutoff96h = new Date(Date.now() - 96 * 60 * 60 * 1000)
  const users = await db.collection('users').find({
    lastActive: { $gte: cutoff96h, $lt: cutoff48h }, telegramId: { $exists: true },
    $and: [getSpamThrottle()],
    $or: [{ lastInactive48Notif: { $exists: false } }, { lastInactive48Notif: { $lt: cutoff96h } }],
  }, { projection: { telegramId: 1, firstName: 1, _id: 1 } }).limit(500).toArray()
  let sent = 0, failed = 0
  for (const user of users) {
    const name = user.firstName || 'there'
    await db.collection('notifQueue').insertOne({
      telegramId: user.telegramId,
      message: `👋 <b>Hey ${name}, we miss you!</b>\n\nYour energy is full and your rewards are waiting.\nDon't let your streak die — come back and play! 🔥`,
      replyMarkup: { inline_keyboard: [[{ text: '🎮 Play Now', url: appUrl }]] },
      status: 'pending',
      createdAt: new Date()
    })
    sent++;
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactive48Notif: new Date(), lastCronNotifTime: new Date() } })
  }
  return { job: 'inactive48h', sent, failed, total: users.length }
}

// ─── Job 1: notifQueue ────────────────────────────────────────────────────────
// Collection schema: { telegramId, message, status: 'pending'|'processing'|'sent'|'failed', createdAt, sentAt? }

async function runNotifQueue(db: Awaited<ReturnType<typeof getDb>>) {
  const col = db.collection('notifQueue')

  // 1a. Atomically claim and send each pending notification one at a time.
  // Using findOneAndUpdate to claim each doc (status: pending → processing) before sending
  // prevents duplicate sends when two cron instances run concurrently.
  // Also reset any stale 'processing' docs older than 5 min (from a previous crashed run).
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000)
  await col.updateMany(
    { status: 'processing', claimedAt: { $lt: staleThreshold } },
    { $set: { status: 'pending' } }
  )

  let sent = 0
  let failed = 0
  let total = 0

  while (total < 300) {
    const doc = await col.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'processing', claimedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!doc) break
    total++

    const ok = await sendTg(doc.telegramId, doc.message, doc.replyMarkup)
    await col.updateOne(
      { _id: doc._id },
      { $set: { status: ok ? 'sent' : 'failed', sentAt: new Date() } }
    )
    if (ok) sent++; else failed++
    // Rate-limit friendly
    await new Promise(r => setTimeout(r, 35))
  }

  // 1b. Clean up sent docs older than 24 h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const { deletedCount } = await col.deleteMany({ status: 'sent', sentAt: { $lt: cutoff } })

  return { job: 'notifQueue', sent, failed, total, cleaned: deletedCount }
}

// ─── Job 2: pending-reward (coupon notifications) ────────────────────────────

async function runPendingReward(db: Awaited<ReturnType<typeof getDb>>) {
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
    await db.collection('notifQueue').insertOne({
      telegramId: entry._id,
      message: `🎁 <b>You have ${count} unclaimed reward${count > 1 ? 's' : ''}!</b>\n\nOpen VivatApp to view and use your promo code${count > 1 ? 's' : ''}. Don't let them expire! 🕐`,
      status: 'pending',
      createdAt: new Date()
    })
    sent++
    await db.collection('userCoupons').updateMany(
      { telegramId: entry._id, notified: { $ne: true } },
      { $set: { notified: true } }
    )
  }

  return { job: 'pendingReward', sent, failed, total: users.length }
}

// ─── Job 3: prediction results ────────────────────────────────────────────────
// Processes footballPredictions where status='open' and winner is set
// (admin stages result via POST /api/admin/predictions/[id]/stage-result)

async function runPredictionResults(db: Awaited<ReturnType<typeof getDb>>) {
  const matches = await db.collection('footballPredictions')
    .find({ status: 'open', winner: { $exists: true, $ne: null } })
    .toArray()

  let processed = 0
  let totalWinners = 0
  let totalLosers = 0

  for (const match of matches) {
    try {
      const { winner } = match
      const winnerTeam = winner === 'team1' ? match.team1 : match.team2
      const energyReward: number = match.energyReward ?? 10
      const matchId = match._id.toString()

      // Mark resolved first to prevent double-processing
      await db.collection('footballPredictions').updateOne(
        { _id: match._id },
        { $set: { status: 'resolved', resolvedAt: new Date(), resolvedByCron: true, updatedAt: new Date() } }
      )

      const votes = await db.collection('userPredictions').find({ matchId }).toArray()

      for (const vote of votes) {
        const telegramId = Number(vote.telegramId)
        const isWinner = vote.prediction === winner

        if (isWinner) {
          await db.collection('mergeScores').updateOne(
            { telegramId },
            { $inc: { energy: energyReward } },
            { upsert: false }
          )
          await db.collection('userPredictions').updateOne(
            { _id: vote._id },
            { $set: { result: 'won', energyAwarded: energyReward, resolvedAt: new Date() } }
          )
          await db.collection('notifQueue').insertOne({
            telegramId,
            message: [
              `🎉 <b>Prediction Result</b>`,
              ``,
              `<b>${match.team1} vs ${match.team2}</b>`,
              ``,
              `✅ <b>${winnerTeam}</b> won the match!`,
              `You predicted correctly — <b>+${energyReward} energy</b> has been added to your game!`,
              ``,
              `Keep playing to earn more rewards 🚀`,
            ].join('\n'),
            status: 'pending',
            createdAt: new Date()
          })
          totalWinners++
        } else {
          await db.collection('userPredictions').updateOne(
            { _id: vote._id },
            { $set: { result: 'lost', energyAwarded: 0, resolvedAt: new Date() } }
          )
          await db.collection('notifQueue').insertOne({
            telegramId,
            message: [
              `😔 <b>Prediction Result</b>`,
              ``,
              `<b>${match.team1} vs ${match.team2}</b>`,
              ``,
              `❌ <b>${winnerTeam}</b> won the match.`,
              `Better luck next time! Keep predicting to win energy 💪`,
            ].join('\n'),
            status: 'pending',
            createdAt: new Date()
          })
          totalLosers++
        }
        await new Promise(r => setTimeout(r, 35))
      }

      processed++
    } catch (err) {
      console.error('[cron/master] prediction error for match', match._id, err)
    }
  }

  return { job: 'predictionResults', processed, winners: totalWinners, losers: totalLosers }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const allowed = await authorize(req)
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!BOT_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })

  const db = await getDb()
  const triggeredBy = req.headers.get('x-admin-trigger') === 'true' ? 'admin' : 'schedule'
  const runAt = new Date()

  // Block reminder notifications between midnight (00:00) and noon (12:00) UTC
  const currentHourUTC = runAt.getUTCHours()
  const isNightTime = currentHourUTC < 12
  if (isNightTime && triggeredBy !== 'admin') {
    return NextResponse.json({ skipped: true, reason: 'Quiet hours (00:00–12:00 UTC)', hour: currentHourUTC })
  }

  // Fetch play button URL from settings
  const playUrlRow = await db.collection('settings').findOne({ key: 'playUrl' })
  const appUrl = playUrlRow?.value || process.env.NEXT_PUBLIC_BASE_URL || 'https://t.me/YOUR_BOT_USERNAME/play'
  const playButton = { inline_keyboard: [[{ text: '🎮 Play Now', url: appUrl }]] }

  // Run sequentially to prevent race conditions on the 3-hour global anti-spam throttle.
  // If run in parallel, all tasks query DB simultaneously before any of them updates lastCronNotifTime.
  const safeRun = async (fn: () => Promise<any>) => {
    try { return await fn() } catch (err: any) { return { error: err?.message || 'Error' } }
  }

  const notifQueue = await safeRun(() => runNotifQueue(db))
  // Make appUrl available in scope for job calls below
  const pendingReward = await safeRun(() => runPendingReward(db))
  const predictionResults = await safeRun(() => runPredictionResults(db))
  
  // The throttled checks must run sequentially
  const dailyEnergy = await safeRun(() => runDailyEnergy(db, appUrl))
  const inactivity = await safeRun(() => runInactivity(db, appUrl))
  const availableTasks = await safeRun(() => runAvailableTasks(db, appUrl))
  const dailyCheckin = await safeRun(() => runDailyCheckin(db, appUrl))
  const inactive48h = await safeRun(() => runInactive48h(db, appUrl))

  const results = {
    notifQueue,
    pendingReward,
    predictionResults,
    dailyEnergy,
    inactivity,
    availableTasks,
    dailyCheckin,
    inactive48h,
  }

  // Persist log
  await db.collection('cronLogs').insertOne({
    type: 'master',
    results,
    runAt,
    triggeredBy,
  })

  console.log('[cron/master]', JSON.stringify(results))
  return NextResponse.json({ ok: true, runAt, triggeredBy, results })
}
