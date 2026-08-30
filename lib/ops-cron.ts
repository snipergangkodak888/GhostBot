import { getDb } from "@/lib/db"
import { getTelegramBotToken, sendTelegramMessage, sendTelegramText } from "@/lib/telegram-bot"
import { formatTeamDateTime, nextRecurringDueAt, TEAM_TIME_ZONE } from "@/lib/team-timezone"
import { getProfileChats, getSubscribedChats } from "@/lib/chat-subscriptions"
import { formatLaunchDaySchedule, getLaunchesForDay, launchDateKey, LAUNCH_TIME_ZONE } from "@/lib/launch-calendar"
import { ensureDailyTradingFeeExpectations, valuePendingRevenueReceipts } from "@/lib/revenue-service"
import { activateScheduledProject, projectActivationReadiness, projectLaunchAt, projectLaunchDateKey, projectLaunchTimingStatus } from "@/lib/project-lifecycle"
import { launchMethodLabel, normalizeLaunchMethod } from "@/lib/launch-method"
import { operationalLaunchVenue } from "@/lib/launch-venues"
import { activeProjectReviewStart, DAILY_PROJECT_REVIEW_HOUR_ET, dailyProjectReviewButtons, dailyProjectReviewDateKey, dailyProjectReviewId, dailyProjectReviewText, type DailyProjectReviewRecord } from "@/lib/daily-project-review"
import { reminderText } from "@/lib/reminder-text"

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

function compactReminderDateTime(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return escapeHtml(formatTeamDateTime(value, timeZone))
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date) === new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(new Date()) ? {} : { year: "numeric" as const }),
  }).format(date)
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date)
  const label = escapeHtml(`${dateParts} · ${timeParts}`)
  return `<a href="tg://time?unix=${Math.floor(date.getTime() / 1000)}&amp;format=wDt">${label}</a>`
}

function reminderTargetMentions(reminder: any) {
  if (!["creator", "specific"].includes(String(reminder?.targetMode || ""))) return ""
  const targets = Array.isArray(reminder?.targetMembers) ? reminder.targetMembers : []
  return targets.map((target: any) => {
    const username = String(target?.username || "").trim().replace(/^@/, "")
    if (username) return `@${escapeHtml(username)}`
    const telegramId = Number(target?.telegramId)
    const label = escapeHtml(target?.displayName || "Trader")
    return Number.isFinite(telegramId) ? `<a href="tg://user?id=${telegramId}">${label}</a>` : label
  }).filter(Boolean).join(" ")
}

export function formatReminderNotification(reminder: any) {
  const text = reminderText(reminder) || "Reminder"
  const targetMentions = reminderTargetMentions(reminder)
  const targetMode = String(reminder?.targetMode || "everyone")
  const targets = Array.isArray(reminder?.targetMembers) ? reminder.targetMembers : []
  const audience = targetMentions || (targetMode === "everyone" ? "Everyone" : "")
  const audienceIcon = targetMode === "creator" || targets.length === 1 ? "👤" : "👥"
  const timeZone = String(reminder?.timeZone || TEAM_TIME_ZONE)
  return [
    `🔔 <b>${escapeHtml(text)}</b>`,
    audience ? `${audienceIcon} ${audience}` : "",
    `⏰ ${compactReminderDateTime(String(reminder?.dueAt || ""), timeZone)}`,
  ].filter(Boolean).join("\n")
}

async function claimDelivery(key: string, type: string) {
  const db = await getDb()
  const existing = await db.collection("opsCronDeliveries").findOne({ key })
  if (existing) return false
  const now = new Date()
  await db.collection("opsCronDeliveries").insertOne({ key, type, createdAt: now, updatedAt: now })
  return true
}

async function releaseDelivery(key: string) {
  const db = await getDb()
  await db.collection("opsCronDeliveries").deleteOne({ key })
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

export async function processDueReminders(token: string, now: Date) {
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
    const text = formatReminderNotification(reminder)

    const result = await sendToRecipients(token, recipients, text)
    sent += result.sent
    failed += result.failed

    if (result.sent === 0) {
      await releaseDelivery(key)
      await db.collection("opsReminders").updateOne(
        { _id: reminder._id },
        { $set: { lastDeliveryFailedAt: now, updatedAt: now } },
      )
      continue
    }

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

export async function processDailyActiveProjectReview(token: string, now: Date) {
  const configuredHour = Number(process.env.ACTIVE_PROJECT_REVIEW_HOUR_ET || DAILY_PROJECT_REVIEW_HOUR_ET)
  const reviewHour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23 ? configuredHour : DAILY_PROJECT_REVIEW_HOUR_ET
  if (hourInTimeZone(now, EST_TIME_ZONE) !== reviewHour) {
    return { projects: 0, recipients: 0, sent: 0, failed: 0, skipped: 0, waiting: true, hourEt: reviewHour }
  }

  const db = await getDb()
  const dateKey = dailyProjectReviewDateKey(now)
  const activeProjects = (await db.collection("opsProjects").find({ status: "active" }).toArray())
    .sort((a: any, b: any) => {
      const aTime = new Date(activeProjectReviewStart(a) || now).getTime()
      const bTime = new Date(activeProjectReviewStart(b) || now).getTime()
      return aTime - bTime || String(a.name || "").localeCompare(String(b.name || ""))
    })
  if (!activeProjects.length) {
    return { projects: 0, recipients: 0, sent: 0, failed: 0, skipped: 0, waiting: false, hourEt: reviewHour }
  }

  const recipients = await getProfileChats("trade")
  const snapshots = activeProjects.map((project: any) => ({
    projectId: String(project._id),
    name: String(project.name || "Unnamed project"),
    activeSince: activeProjectReviewStart(project),
  }))
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const recipient of recipients) {
    const key = `daily-project-review:${dateKey}:${recipient.chatId}`
    if (!(await claimDelivery(key, "daily-project-review"))) {
      skipped += 1
      continue
    }
    const review: DailyProjectReviewRecord = {
      _id: dailyProjectReviewId(recipient.chatId, dateKey),
      chatId: String(recipient.chatId),
      chatTitle: recipient.label,
      dateKey,
      projects: snapshots,
      selectedProjectIds: [],
      status: "pending",
    }
    const createdAt = new Date()
    await db.collection("opsDailyProjectReviews").insertOne({ ...review, createdAt, updatedAt: createdAt })
    const messageId = await sendTelegramMessage(token, recipient.chatId, dailyProjectReviewText({ review, now }), {
      parseMode: "HTML",
      replyMarkup: { inline_keyboard: dailyProjectReviewButtons(review) },
    })
    if (messageId) {
      sent += 1
      await db.collection("opsDailyProjectReviews").updateOne(
        { _id: review._id },
        { $set: { messageId, sentAt: createdAt, updatedAt: createdAt } },
      )
    } else {
      failed += 1
      await releaseDelivery(key)
    }
  }

  return { projects: activeProjects.length, recipients: recipients.length, sent, failed, skipped, waiting: false, hourEt: reviewHour }
}

export async function processTentativeLaunchTimingFollowups(token: string, now: Date) {
  const configuredHour = Number(process.env.TENTATIVE_LAUNCH_FOLLOWUP_HOUR_ET || 12)
  const followupHour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23 ? configuredHour : 12
  if (hourInTimeZone(now, EST_TIME_ZONE) !== followupHour) {
    return { due: 0, sent: 0, failed: 0, skipped: 0, waiting: true, hourEt: followupHour }
  }

  const db = await getDb()
  const today = launchDateKey(now)
  const projects = await db.collection("opsProjects").find({ status: { $in: ["scheduled", "in_progress"] } }).toArray()
  const tentative = projects.filter((project: any) => projectLaunchTimingStatus(project) === "tentative" && projectLaunchDateKey(project, EST_TIME_ZONE) === today)
  const fallbackRecipients = await getSubscribedChats("launches")
  const grouped = new Map<string, { recipient: CronRecipient; projects: any[] }>()
  for (const project of tentative) {
    const recipients: CronRecipient[] = project.launchChatId
      ? [{ chatId: String(project.launchChatId), kind: "group", label: "Launch Chat" }]
      : fallbackRecipients
    for (const recipient of recipients) {
      const key = String(recipient.chatId)
      const group = grouped.get(key) || { recipient, projects: [] }
      if (!group.projects.some((item: any) => String(item._id) === String(project._id))) group.projects.push(project)
      grouped.set(key, group)
    }
  }
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const { recipient, projects: recipientProjects } of grouped.values()) {
    const lines = recipientProjects.map((project: any) => {
      const chain = String(project.chain || project.revenueChain || "").toLowerCase()
      const chainLabel = chain === "solana" ? "Solana"
        : chain === "robinhood" ? "Robinhood"
          : chain === "bnb" ? "BNB Chain"
            : chain === "ethereum" ? "Ethereum"
              : chain === "base" ? "Base"
                : "Chain TBD"
      const venue = (operationalLaunchVenue(project.launchVenue)?.name || String(project.launchVenueLabel || ""))
        ?.replace(/^Uniswap\s+/i, "Uni ")
        .replace(/\s*\(full range\)$/i, "")
      const location = venue ? `${chainLabel}/${venue}` : chainLabel
      const method = normalizeLaunchMethod(project.launchMethod) ? ` · ${launchMethodLabel(project.launchMethod)}` : ""
      return `${escapeHtml(project.name || "Unnamed project")} · ${escapeHtml(location)}${escapeHtml(method)}`
    })
    const text = [
      "<b>Today’s launches with time TBD</b>",
      "",
      ...lines,
      "",
      "Are all of these still planned for today?",
    ].join("\n")
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "Still TBD — all planned today", callback_data: `tentative:ack:${today}` }],
        [{ text: "Edit launches", callback_data: `calendar:edit:${today}` }],
      ],
    }
    const key = `tentative-launch-followup:${today}:${recipient.chatId}`
    if (!(await claimDelivery(key, "tentative-launch-followup"))) {
      skipped += 1
      continue
    }
    const messageId = await sendTelegramMessage(token, recipient.chatId, text, { parseMode: "HTML", replyMarkup })
    if (messageId) sent += 1
    else {
      failed += 1
      await releaseDelivery(key)
    }
  }

  return { due: tentative.length, sent, failed, skipped, waiting: false, hourEt: followupHour }
}

export async function processDueLaunchConfirmations(token: string, now: Date) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  const fallbackRecipients = await getSubscribedChats("launches")
  const due = projects.filter((project: any) => {
    if (!["scheduled", "in_progress"].includes(String(project.status || ""))) return false
    const launchAt = projectLaunchAt(project)
    if (!launchAt || launchAt.getTime() > now.getTime()) return false
    const promptCount = Number(project.activationPromptCount || 0)
    if (promptCount >= 3) return false
    const nextPrompt = project.nextActivationPromptAt ? new Date(project.nextActivationPromptAt) : null
    return !nextPrompt || Number.isNaN(nextPrompt.getTime()) || nextPrompt.getTime() <= now.getTime()
  })

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const dueProject of due) {
    const project = await db.collection("opsProjects").findOne({ _id: dueProject._id })
    const currentLaunchAt = projectLaunchAt(project)
    if (!project || !["scheduled", "in_progress"].includes(String(project.status || "")) || !currentLaunchAt || currentLaunchAt.getTime() > now.getTime()) {
      skipped += 1
      continue
    }
    const readiness = projectActivationReadiness(project)
    const pendingIntent = ["scheduled", "now"].includes(String(project.pendingActivationIntent || ""))
      ? project.pendingActivationIntent as "scheduled" | "now"
      : null
    if (readiness.ready && pendingIntent) {
      const resumed = await activateScheduledProject({
        projectId: String(project._id),
        telegramId: Number(project.pendingActivationRequestedByTelegramId || project.scheduledByTelegramId || 0),
        actual: pendingIntent,
        expectedScheduleVersion: Number(project.scheduleVersion || 0),
        now,
      })
      if (resumed.ok) {
        skipped += 1
        continue
      }
    }
    const launchAt = projectLaunchAt(project)!
    const version = Number(project.scheduleVersion || 0)
    const promptNumber = Number(project.activationPromptCount || 0) + 1
    const recipients = project.launchChatId
      ? [{ chatId: String(project.launchChatId), kind: "group" as const, label: "Launch Chat" }]
      : fallbackRecipients
    if (!recipients.length) {
      skipped += 1
      continue
    }
    const text = [
      `🚀 <b>${escapeHtml(project.name || "Scheduled launch")}</b> was scheduled to launch now.`,
      "",
      `${escapeHtml(project.launchVenue || "Launch venue not set")} · ${escapeHtml(readiness.chain || "chain not set")} · ${escapeHtml(readiness.quoteToken || "quote token not set")}`,
      normalizeLaunchMethod(project.launchMethod) ? `Method: ${escapeHtml(launchMethodLabel(project.launchMethod))}` : "Method: not selected",
      `Scheduled: ${telegramLocalDateTime(launchAt, project.launchTimeZone || EST_TIME_ZONE)}`,
      readiness.ready ? "✅ Activation setup is complete." : `⚠️ Before activation: ${escapeHtml(readiness.missing.join(", "))}.`,
      "",
      "Has the token launched?",
    ].join("\n")
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "✅ Launched on schedule", callback_data: `lifecycle:ontime:${project._id}:${version}` }],
        [{ text: "✅ Launched now", callback_data: `lifecycle:now:${project._id}:${version}` }],
        [{ text: "🕒 Delayed — update time", callback_data: `lifecycle:delay:${project._id}:${version}` }],
        [{ text: "❌ Launch cancelled", callback_data: `lifecycle:cancel:${project._id}:${version}` }],
      ],
    }
    let delivered = false
    for (const recipient of recipients) {
      const key = `launch-activation:${project._id}:${version}:${promptNumber}:${recipient.chatId}`
      if (!(await claimDelivery(key, "launch-activation"))) {
        skipped += 1
        continue
      }
      const latest = await db.collection("opsProjects").findOne({ _id: project._id })
      if (!latest || !["scheduled", "in_progress"].includes(String(latest.status || "")) || Number(latest.scheduleVersion || 0) !== version) {
        skipped += 1
        await releaseDelivery(key)
        continue
      }
      const messageId = await sendTelegramMessage(token, recipient.chatId, text, { parseMode: "HTML", replyMarkup })
      if (messageId) {
        sent += 1
        delivered = true
      } else {
        failed += 1
        await releaseDelivery(key)
      }
    }
    if (delivered) {
      const delayMinutes = promptNumber === 1 ? 15 : promptNumber === 2 ? 45 : null
      await db.collection("opsProjects").updateOne(
        { _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion },
        { $set: {
          activationPromptCount: promptNumber,
          activationPromptSentAt: now.toISOString(),
          nextActivationPromptAt: delayMinutes ? new Date(now.getTime() + delayMinutes * 60_000).toISOString() : null,
          activationOverdue: promptNumber >= 3,
          updatedAt: now,
        } },
      )
    }
  }
  return { due: due.length, sent, failed, skipped }
}

export async function processUpcomingLaunchReadiness(token: string, now: Date) {
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  const fallbackRecipients = await getSubscribedChats("launches")
  const upcoming = projects.filter((project: any) => {
    if (!["scheduled", "in_progress"].includes(String(project.status || ""))) return false
    const launchAt = projectLaunchAt(project)
    if (!launchAt) return false
    const remaining = launchAt.getTime() - now.getTime()
    return remaining > 0 && remaining <= 24 * 60 * 60_000 && !projectActivationReadiness(project).ready
  })
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const project of upcoming) {
    const launchAt = projectLaunchAt(project)!
    const remaining = launchAt.getTime() - now.getTime()
    const bucket = remaining <= 60 * 60_000 ? "1h" : "24h"
    const version = Number(project.scheduleVersion || 0)
    const readiness = projectActivationReadiness(project)
    const recipients = project.launchChatId
      ? [{ chatId: String(project.launchChatId), kind: "group" as const, label: "Launch Chat" }]
      : fallbackRecipients
    const buttons: Array<Array<{ text: string; callback_data: string }>> = []
    if (readiness.missing.includes("fee configuration") && readiness.chain && readiness.quoteToken) buttons.push([{ text: "✅ Use standard $1K launch + $500/day fees", callback_data: `lifecycle:fees:${project._id}:${version}` }])
    if (readiness.missing.includes("referrer decision")) buttons.push([{ text: "Confirm no referrer", callback_data: `lifecycle:refnone:${project._id}:${version}` }])
    const text = [
      `⚠️ <b>${escapeHtml(project.name || "Scheduled launch")}</b> is not ready to activate.`,
      "",
      `Launch: ${telegramLocalDateTime(launchAt, project.launchTimeZone || EST_TIME_ZONE)}`,
      `Complete before launch: ${escapeHtml(readiness.missing.join(", "))}.`,
      readiness.missing.some((item) => item === "chain" || item === "quote token") ? "Edit the project to set its chain and single quote token." : "",
    ].filter(Boolean).join("\n")
    for (const recipient of recipients) {
      const key = `launch-readiness:${project._id}:${version}:${bucket}:${recipient.chatId}`
      if (!(await claimDelivery(key, "launch-readiness"))) {
        skipped += 1
        continue
      }
      const messageId = await sendTelegramMessage(token, recipient.chatId, text, { parseMode: "HTML", ...(buttons.length ? { replyMarkup: { inline_keyboard: buttons } } : {}) })
      if (messageId) sent += 1
      else {
        failed += 1
        await releaseDelivery(key)
      }
    }
  }
  return { due: upcoming.length, sent, failed, skipped }
}

export async function runLaunchScheduleCron(now = new Date()) {
  const token = await getTelegramBotToken()
  if (!token) return { ok: false, error: "Telegram bot token is not configured" }
  const readiness = await processUpcomingLaunchReadiness(token, now)
  const confirmations = await processDueLaunchConfirmations(token, now)
  const calendar = await processLaunchMorningDigest(token, now)
  const tentativeTiming = await processTentativeLaunchTimingFollowups(token, now)
  const activeProjectReview = await processDailyActiveProjectReview(token, now)
  return {
    ok: true,
    timezone: EST_TIME_ZONE,
    estDate: estDateKey(now),
    calendar,
    tentativeTiming,
    activeProjectReview,
    confirmations,
    readiness,
    runAt: now.toISOString(),
  }
}

export async function runReminderCron(now = new Date()) {
  const token = await getTelegramBotToken()
  if (!token) return { ok: false, error: "Telegram bot token is not configured" }
  const reminders = await processDueReminders(token, now)
  return {
    ok: true,
    reminders,
    runAt: now.toISOString(),
  }
}

export async function runRevenueCron(now = new Date()) {
  const revenueDailyFees = await ensureDailyTradingFeeExpectations()
  const revenueValuation = await valuePendingRevenueReceipts()
  return {
    ok: true,
    revenueDailyFees,
    revenueValuation,
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
  const readiness = await processUpcomingLaunchReadiness(token, startedAt)
  const confirmations = await processDueLaunchConfirmations(token, startedAt)
  const calendar = await processLaunchMorningDigest(token, startedAt)
  const tentativeTiming = await processTentativeLaunchTimingFollowups(token, startedAt)
  const activeProjectReview = await processDailyActiveProjectReview(token, startedAt)
  const finishedAt = new Date()
  const result = {
    ok: true,
    timezone: EST_TIME_ZONE,
    estDate: estDateKey(startedAt),
    reminders,
    calendar,
    tentativeTiming,
    activeProjectReview,
    confirmations,
    readiness,
    revenueDailyFees,
    revenueValuation,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  }

  await db.collection("cronLogs").insertOne({ type: "ops-super", result, runAt: finishedAt })
  return result
}

export { estDateKey }
