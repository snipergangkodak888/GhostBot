import { getDb } from "@/lib/db"
import { calculateSheetFinancials } from "@/lib/ops-sheets"
import { getTelegramBotToken, sendTelegramText } from "@/lib/telegram-bot"

const EST_TIME_ZONE = "America/New_York"

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

function estTimeLabel(date: string | Date) {
  const value = new Date(date)
  if (Number.isNaN(value.getTime())) return "No date"
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EST_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

function tomorrowEstKey() {
  const next = new Date()
  next.setUTCDate(next.getUTCDate() + 1)
  return estDateKey(next)
}

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function nextDueAt(currentDueAt: string, recurrence: string, now: Date) {
  const due = new Date(currentDueAt)
  if (Number.isNaN(due.getTime())) return null
  const step =
    recurrence === "hourly" ? 60 * 60 * 1000 :
    recurrence === "daily" ? 24 * 60 * 60 * 1000 :
    recurrence === "weekly" ? 7 * 24 * 60 * 60 * 1000 :
    0
  if (!step) return null
  while (due.getTime() <= now.getTime()) due.setTime(due.getTime() + step)
  return due.toISOString()
}

async function claimDelivery(key: string, type: string) {
  const db = await getDb()
  const existing = await db.collection("opsCronDeliveries").findOne({ key })
  if (existing) return false
  const now = new Date()
  await db.collection("opsCronDeliveries").insertOne({ key, type, createdAt: now, updatedAt: now })
  return true
}

async function getRecipients(extraChatId?: string) {
  const db = await getDb()
  const [members, groups] = await Promise.all([
    db.collection("guardMembers").find({ status: "active" }).toArray(),
    db.collection("opsHostedGroups").find({ status: "active" }).toArray(),
  ])
  const recipients = new Map<string, CronRecipient>()

  for (const member of members) {
    if (!member.telegramId) continue
    recipients.set(String(member.telegramId), {
      chatId: Number(member.telegramId),
      kind: "member",
      label: member.username ? `@${member.username}` : [member.firstName, member.lastName].filter(Boolean).join(" ") || String(member.telegramId),
    })
  }

  for (const group of groups) {
    if (!group.chatId) continue
    recipients.set(String(group.chatId), {
      chatId: group.chatId,
      kind: "group",
      label: group.title || String(group.chatId),
    })
  }

  if (extraChatId) {
    recipients.set(String(extraChatId), { chatId: extraChatId, kind: "direct", label: String(extraChatId) })
  }

  return Array.from(recipients.values())
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

    const recipients = await getRecipients(reminder.telegramChatId ? String(reminder.telegramChatId) : undefined)
    const text = [
      "🔔 <b>Team Reminder</b>",
      "",
      `<b>${escapeHtml(reminder.title || "Reminder")}</b>`,
      reminder.message ? escapeHtml(reminder.message) : "",
      "",
      `⏰ ${escapeHtml(estTimeLabel(dueAt))} EST`,
    ].filter(Boolean).join("\n")

    const result = await sendToRecipients(token, recipients, text)
    sent += result.sent
    failed += result.failed

    const next = nextDueAt(dueAt, String(reminder.recurrence || "none"), now)
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

async function processCalendarReminders(token: string) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  const today = estDateKey()
  const tomorrow = tomorrowEstKey()
  const recipients = await getRecipients()
  let events = 0
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const project of projects) {
    if (project.status === "inactive" || !project.launchDate) continue
    const launchKey = estDateKey(new Date(project.launchDate))
    const timing = launchKey === today ? "today" : launchKey === tomorrow ? "tomorrow" : ""
    if (!timing) continue

    const key = `calendar:${project._id}:${launchKey}:${timing}`
    if (!(await claimDelivery(key, "calendar"))) {
      skipped += 1
      continue
    }

    events += 1
    const text = [
      timing === "today" ? "📅 <b>Launch Today</b>" : "📅 <b>Launch Tomorrow</b>",
      "",
      `<b>${escapeHtml(project.name || "Project")}</b>`,
      project.owner ? `Owner: ${escapeHtml(project.owner)}` : "",
      `Date: ${escapeHtml(estTimeLabel(project.launchDate))} EST`,
      project.notes ? `Notes: ${escapeHtml(project.notes)}` : "",
    ].filter(Boolean).join("\n")
    const result = await sendToRecipients(token, recipients, text)
    sent += result.sent
    failed += result.failed
  }

  return { events, sent, failed, skipped }
}

async function processDailyPerformance(token: string, now: Date) {
  const db = await getDb()
  const today = estDateKey(now)
  const key = `daily-performance:${today}`
  if (!(await claimDelivery(key, "daily-performance"))) {
    return { sent: 0, failed: 0, skipped: 1 }
  }

  const [projects, reminders, payroll, sheets] = await Promise.all([
    db.collection("opsProjects").find({}).toArray(),
    db.collection("opsReminders").find({}).toArray(),
    db.collection("opsPayroll").find({}).toArray(),
    db.collection("opsSheets").find({}).toArray(),
  ])
  const financials = calculateSheetFinancials(sheets, now)
  const activeProjects = projects.filter((project: any) => project.status !== "inactive")
  const pendingPayroll = payroll.filter((row: any) => row.status !== "paid")
  const scheduledReminders = reminders.filter((reminder: any) => reminder.status !== "done")
  const recipients = await getRecipients()

  const text = [
    "📈 <b>Daily Project Performance</b>",
    `🗓️ ${today} EST`,
    "",
    `🟢 Income today: <b>${money(financials.incomeToday)}</b>`,
    `🔴 Expenses today: <b>${money(financials.expenseToday + financials.payrollToday)}</b>`,
    `💰 Profit today: <b>${money(financials.profitToday)}</b>`,
    "",
    `📅 Weekly profit: <b>${money(financials.profitThisWeek)}</b>`,
    `🗓️ Monthly profit: <b>${money(financials.profitThisMonth)}</b>`,
    "",
    `📁 Active projects: <b>${activeProjects.length}</b>`,
    `💸 Pending payroll rows: <b>${pendingPayroll.length}</b>`,
    `🔔 Scheduled reminders: <b>${scheduledReminders.length}</b>`,
  ].join("\n")

  return sendToRecipients(token, recipients, text)
}

export async function runOpsSuperCron() {
  const startedAt = new Date()
  const db = await getDb()
  const token = await getTelegramBotToken()
  if (!token) {
    const result = { ok: false, error: "Telegram bot token is not configured" }
    await db.collection("cronLogs").insertOne({ type: "ops-super", result, runAt: startedAt })
    return result
  }

  const reminders = await processDueReminders(token, startedAt)
  const calendar = await processCalendarReminders(token)
  const dailyPerformance = await processDailyPerformance(token, startedAt)
  const finishedAt = new Date()
  const result = {
    ok: true,
    timezone: EST_TIME_ZONE,
    estDate: estDateKey(startedAt),
    reminders,
    calendar,
    dailyPerformance,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  }

  await db.collection("cronLogs").insertOne({ type: "ops-super", result, runAt: finishedAt })
  return result
}

export { estDateKey }
