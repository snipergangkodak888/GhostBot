import "server-only"

import { getDb, ObjectId } from "./db"
import {
  ORGANIC_CHANNEL_JOB_COLLECTION,
  processOrganicChannelJob,
  type OrganicChannelJob,
} from "./organic-channel-automation"
import { createTelegramUserGateway, telegramUserAutomationConfig } from "./telegram-user-client"
import { getTelegramBotToken, sendTelegramMessage } from "./telegram-bot"
import { normalizeOrganicTicker, organicChannelCompletionMessage, validOrganicTicker, validSumoProfileId } from "./organic-channel-setup"

export async function queueOrganicChannelJob(params: {
  ticker: string
  profileId: string
  sourceChatId: string
  requestedByTelegramId: number
  requestedByUsername: string
}) {
  const ticker = normalizeOrganicTicker(params.ticker)
  const profileId = String(params.profileId || "").trim()
  if (!validOrganicTicker(ticker)) throw new Error("Invalid organic channel ticker")
  if (!validSumoProfileId(profileId)) throw new Error("Invalid Sumo profile ID")
  const requestedByUsername = String(params.requestedByUsername || "").trim().replace(/^@/, "")
  if (!/^[A-Za-z0-9_]{5,32}$/.test(requestedByUsername)) {
    throw new Error("A Telegram username is required so the requester can be added as a channel administrator")
  }

  const db = await getDb()
  const active = await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).findOne({
    ticker,
    profileId,
    status: { $in: ["queued", "running", "retry"] },
  })
  if (active) return { job: active as OrganicChannelJob, alreadyQueued: true }

  const now = new Date()
  const job: OrganicChannelJob = {
    _id: new ObjectId().toString(),
    ticker,
    profileId,
    sourceChatId: String(params.sourceChatId),
    requestedByTelegramId: Number(params.requestedByTelegramId),
    requestedByUsername,
    stage: "queued",
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).insertOne(job)
  return { job, alreadyQueued: false }
}

async function notifySource(job: OrganicChannelJob, text: string) {
  const token = await getTelegramBotToken()
  if (!token || !job.sourceChatId) return
  await sendTelegramMessage(token, job.sourceChatId, text)
}

let activeRun: Promise<Record<string, any>> | null = null

async function runOneOrganicChannelJob() {
  const config = telegramUserAutomationConfig()
  if (!config.configured) {
    return { ok: true, processed: 0, skipped: "not_configured", missing: config.missing }
  }

  const db = await getDb()
  const now = new Date()
  const job = await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION)
    .find({
      attempts: { $lt: 5 },
      $or: [
        { status: { $in: ["queued", "retry"] } },
        { status: "running", leaseExpiresAt: { $lt: now } },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(1)
    .toArray()
    .then((rows: any[]) => rows[0] as OrganicChannelJob | undefined)
  if (!job) return { ok: true, processed: 0 }

  const attempts = Number(job.attempts || 0) + 1
  const leaseExpiresAt = new Date(Date.now() + 2 * 60_000)
  await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
    { _id: job._id },
    { $set: { status: "running", attempts, leaseExpiresAt, lastAttemptAt: new Date(), updatedAt: new Date() } },
  )
  job.status = "running"
  job.attempts = attempts

  let connection: Awaited<ReturnType<typeof createTelegramUserGateway>> | null = null
  try {
    connection = await createTelegramUserGateway()
    const completed = await processOrganicChannelJob(job, {
      gateway: connection.gateway,
      checkpoint: async (changes) => {
        await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
          { _id: job._id },
          { $set: { ...changes, leaseExpiresAt: new Date(Date.now() + 2 * 60_000), updatedAt: new Date() } },
        )
      },
    })
    await db.collection("organicTradeChannels").updateOne(
      { channelId: completed.channelBotApiId },
      {
        $set: {
          channelId: completed.channelBotApiId,
          ticker: completed.ticker,
          title: `$${completed.ticker} - Organic Trade Notifications`,
          profileId: completed.profileId,
          subscribeCommand: completed.subscribeCommand,
          inviteLink: completed.inviteLink,
          setupStatus: "complete",
          automated: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    )
    await notifySource(completed, organicChannelCompletionMessage(
      completed.inviteLink,
      completed.subscribeCommand,
      connection.sumoBotUsername,
    ))
    return { ok: true, processed: 1, jobId: completed._id, status: "complete" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const nextStatus = attempts >= 5 ? "failed" : "retry"
    await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
      { _id: job._id },
      { $set: { status: nextStatus, lastError: message.slice(0, 1000), updatedAt: new Date() } },
    )
    await notifySource(job, nextStatus === "failed"
      ? `❌ $${job.ticker} organic channel setup stopped after 5 attempts. Last error: ${message}`
      : `⚠️ $${job.ticker} organic channel setup hit a temporary error and will retry automatically. ${message}`)
    return { ok: false, processed: 1, jobId: job._id, status: nextStatus, error: message }
  } finally {
    await connection?.close().catch(() => undefined)
  }
}

export async function runOrganicChannelCron() {
  if (activeRun) return activeRun
  activeRun = runOneOrganicChannelJob().finally(() => {
    activeRun = null
  })
  return activeRun
}
