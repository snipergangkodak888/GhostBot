import { getDb } from "@/lib/db"
import { getTelegramBotToken, sendTelegramText } from "@/lib/telegram-bot"
import { formatTeamDateTime, nextRecurringDueAt, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { getSubscribedChats } from "@/lib/chat-subscriptions"
import { formatLaunchDaySchedule, getLaunchesForDay, launchDateKey, LAUNCH_TIME_ZONE } from "@/lib/launch-calendar"
import { ensureDailyTradingFeeExpectations, valuePendingRevenueReceipts } from "@/lib/revenue-service"

const EST_TIME_ZONE = LAUNCH_TIME_ZONE

type CronRecipient = {
  chatId: number | string
  kind: "member" | "group" | "direct"
  label: string
}

function estDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function telegramLocalDateTime(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return escapeHtml(formatTeamDateTime(value, timeZone))
  const fallback = escapeHtml(formatTeamDateTime(date, timeZone))
  return `<a href="tg://time?unix=${Math.floor(date.getTime() / 1000)}&amp;format=wDt">${fallback}</a>`
}

async function claimDelivery(key: string, type: string) {
  const db = await getDb()
  const existing = await db.collection("opsCronDeliveries").findOne({ key })
  if (existing) return false
  const now = new Date()
  await db.collection("opsCronDeliveries").insertOne({ key, type, createdAt: now, updatedAt: now })
  return true
}

function directRecipient(reminder: any): CronRecipient[] | null {
  const chatId = String(reminder.telegramChatId || "").trim()
  if (!chatId) return null
  if (reminder.deliveryScope !== "chat" && reminder.deliveryScope) return null
  return [{
    chatId,
    kind: "direct",
    label: String(reminder.targetChatTitle || chatId),
  }]
}

async function sendToRecipients(token: string, recipients: CronRecipient[], text: string) {
  let sent = 0
  let failed = 0
  for (const recipient of recipients) {
    const ok = await sendTelegramText(token, recipient.chatId, text)
    if (ok) sent += 1
    else failed += 1
  }
  return { sent, failed }
}

async function processDueReminders(token: string, now: Date) {
  const db = await getDb()
  const reminders = await db.collection("opsReminders").find({}).toArray()
  const due = reminders.filter((reminder: any) => {
    if (reminder.status === "done") return false
    const dueAt = new Date(reminder.dueAt || "")
    return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() <= now.getTime()
  })

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const reminder of due) {
    const dueAt = String(reminder.dueAt || "")
    const key = `reminder:${reminder._id}:${dueAt}`
    if (!(await claimDelivery(key, "reminder"))) {
      skipped += 1
      continue
    }

    const recipients = directRecipient(reminder)
    if (!recipients) {
      skipped += 1
      await db.collection("opsReminders").updateOne(
        { _id: reminder._id },
        { $set: { status: "done", deliverySuppressedReason: "chat_target_required", updatedAt: now } },
      )
      continue
    }
    const reminderTimeZone = String(reminder.timeZone || TEAM_TIME_ZONE)
    const text = [
      "🔔 <b>Team Reminder</b>",
      "",
      `<b>${escapeHtml(reminder.title || "Reminder")}</b>`,
      reminder.message ? escapeHtml(reminder.message) : "",
      "",
      `⏰ ${telegramLocalDateTime(dueAt, reminderTimeZone)}`,
    ].filter(Boolean).join("\n")

    const result = await sendToRecipients(token, recipients, text)
    sent += result.sent
    failed += result.failed

    const next = nextRecurringDueAt(dueAt, String(reminder.recurrence || "none"), reminderTimeZone, now)
    await db.collection("opsReminders").updateOne(
      { _id: reminder._id },
      {
        $set: {
          status: next ? "scheduled" : "done",
          dueAt: next || dueAt,
          lastNotifiedAt: now,
          lastCronSentDueAt: dueAt,
          updatedAt: now,
        },
      },
    )
  }

  return { due: due.length, sent, failed, skipped }
}

function hourInTimeZone(now: Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now))
}

async function processLaunchMorningDigest(token: string, now: Date) {
  const configuredHour = Number(process.env.LAUNCH_DIGEST_HOUR_ET || 8)
  const digestHour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23 ? configuredHour : 8
  if (hourInTimeZone(now, EST_TIME_ZONE) !== digestHour) {
    return { events: 0, recipients: 0, sent: 0, failed: 0, skipped: 0, waiting: true, hourEt: digestHour }
  }

  const today = launchDateKey(now)
  const recipients = await getSubscribedChats("launches")
  const launches = await getLaunchesForDay(now)
  const text = await formatLaunchDaySchedule(now, { morning: true })
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const recipient of recipients) {
    const key = `launch-digest:${recipient.chatId}:${today}`
    if (!(await claimDelivery(key, "launch-digest"))) {
      skipped += 1
      continue
    }
    const ok = await sendTelegramText(token, recipient.chatId, text)
    if (ok) sent += 1
    else failed += 1
  }

  return { events: launches.length, recipients: recipients.length, sent, failed, skipped, waiting: false, hourEt: digestHour }
}

export async function runLaunchScheduleCron(now = new Date()) {
  const token = await getTelegramBotToken()
  if (!token) return { ok: false, error: "Telegram bot token is not configured" }
  const calendar = await processLaunchMorningDigest(token, now)
  return {
    ok: true,
    timezone: EST_TIME_ZONE,
    estDate: estDateKey(now),
    calendar,
    runAt: now.toISOString(),
  }
}

export async function runOpsSuperCron(now = new Date()) {
  const startedAt = now
  const db = await getDb()
  const revenueDailyFees = await ensureDailyTradingFeeExpectations()
  const revenueValuation = await valuePendingRevenueReceipts()
  const token = await getTelegramBotToken()
  if (!token) {
    const result = { ok: false, error: "Telegram bot token is not configured", revenueDailyFees, revenueValuation }
    await db.collection("cronLogs").insertOne({ type: "ops-super", result, runAt: startedAt })
    return result
  }

  const reminders = await processDueReminders(token, startedAt)
  const calendar = await processLaunchMorningDigest(token, startedAt)
  const finishedAt = new Date()
  const result = {
    ok: true,
    timezone: EST_TIME_ZONE,
    estDate: estDateKey(startedAt),
    reminders,
    calendar,
    revenueDailyFees,
    revenueValuation,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  }

  await db.collection("cronLogs").insertOne({ type: "ops-super", result, runAt: finishedAt })
  return result
}

export { estDateKey }
