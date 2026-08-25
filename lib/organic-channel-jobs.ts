import "server-only"

import { getDb, ObjectId } from "./db"
import {
  ORGANIC_CHANNEL_JOB_COLLECTION,
  processOrganicChannelJob,
  type OrganicChannelJob,
} from "./organic-channel-automation"
import {
  classifyOrganicTelegramError,
  nextOrganicChannelEligibleAt,
  organicChannelRatePolicy,
} from "./organic-channel-policy"
import { createTelegramUserGateway, telegramUserAutomationConfig } from "./telegram-user-client"
import { getTelegramBotToken, sendTelegramMessage } from "./telegram-bot"
import { normalizeOrganicTicker, organicChannelCompletionMessage, validOrganicTicker, validSumoProfileId } from "./organic-channel-setup"

export const ORGANIC_CHANNEL_STATE_COLLECTION = "organicChannelAutomationState"
const GLOBAL_STATE_ID = "global"
const ACTIVE_STATUSES = ["queued", "running", "retry"]

type OrganicAutomationState = {
  _id: string
  circuitOpen?: boolean
  circuitReason?: string
  circuitJobId?: string
  circuitOpenedAt?: string | Date
  updatedAt?: string | Date
}

async function automationState(db: Awaited<ReturnType<typeof getDb>>) {
  return (await db.collection(ORGANIC_CHANNEL_STATE_COLLECTION).findOne({ _id: GLOBAL_STATE_ID }) || {
    _id: GLOBAL_STATE_ID,
    circuitOpen: false,
  }) as OrganicAutomationState
}

async function openAutomationCircuit(
  db: Awaited<ReturnType<typeof getDb>>,
  job: OrganicChannelJob,
  reason: string,
) {
  const now = new Date()
  await db.collection(ORGANIC_CHANNEL_STATE_COLLECTION).updateOne(
    { _id: GLOBAL_STATE_ID },
    {
      $set: {
        circuitOpen: true,
        circuitReason: reason.slice(0, 1000),
        circuitJobId: job._id,
        circuitOpenedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  )
}

function parseDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""))
  return Number.isFinite(date.getTime()) ? date : null
}

async function channelCreationHistory(db: Awaited<ReturnType<typeof getDb>>) {
  const cutoff = Date.now() - 24 * 60 * 60_000
  const jobs = await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION)
    .find({}, { projection: { channelCreatedAt: 1, createdAt: 1, channel: 1 } })
    .toArray()
  return jobs
    .map((job: any) => parseDate(job.channelCreatedAt || (job.channel ? job.createdAt : null)))
    .filter((date): date is Date => Boolean(date && date.getTime() >= cutoff))
}

export async function organicChannelAutomationStatus() {
  const db = await getDb()
  const policy = organicChannelRatePolicy()
  const state = await automationState(db)
  return {
    enabled: policy.enabled,
    circuitOpen: Boolean(state.circuitOpen),
    circuitReason: String(state.circuitReason || ""),
    policy,
  }
}

export async function queueOrganicChannelJob(params: {
  ticker: string
  profileId: string
  sourceChatId: string
  requestedByTelegramId: number
}) {
  const ticker = normalizeOrganicTicker(params.ticker)
  const profileId = String(params.profileId || "").trim()
  if (!validOrganicTicker(ticker)) throw new Error("Invalid organic channel ticker")
  if (!validSumoProfileId(profileId)) throw new Error("Invalid Sumo profile ID")

  const db = await getDb()
  const matching = await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION)
    .find({ ticker, profileId })
    .sort({ createdAt: -1 })
    .toArray() as OrganicChannelJob[]
  const complete = matching.find((job) => job.status === "complete" && job.inviteLink && job.subscribeCommand)
  if (complete) {
    return { job: complete, alreadyQueued: false, alreadyComplete: true, requiresReview: false, ...(await organicChannelAutomationStatus()) }
  }
  const active = matching.find((job) => ACTIVE_STATUSES.includes(job.status))
  if (active) {
    return { job: active, alreadyQueued: true, alreadyComplete: false, requiresReview: false, ...(await organicChannelAutomationStatus()) }
  }
  const partial = matching.find((job) => Boolean(job.channel || job.channelCreatedAt))
  if (partial) {
    return { job: partial, alreadyQueued: false, alreadyComplete: false, requiresReview: true, ...(await organicChannelAutomationStatus()) }
  }

  const now = new Date()
  const job: OrganicChannelJob = {
    _id: new ObjectId().toString(),
    ticker,
    profileId,
    sourceChatId: String(params.sourceChatId),
    requestedByTelegramId: Number(params.requestedByTelegramId),
    stage: "queued",
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).insertOne(job)
  return { job, alreadyQueued: false, alreadyComplete: false, requiresReview: false, ...(await organicChannelAutomationStatus()) }
}

async function notifySource(job: OrganicChannelJob, text: string) {
  const token = await getTelegramBotToken()
  if (!token || !job.sourceChatId) return
  await sendTelegramMessage(token, job.sourceChatId, text)
}

let activeRun: Promise<Record<string, any>> | null = null

async function runOneOrganicChannelJob() {
  const connectionConfig = telegramUserAutomationConfig()
  if (!connectionConfig.configured) {
    return { ok: true, processed: 0, skipped: "not_configured", missing: connectionConfig.missing }
  }

  const policy = organicChannelRatePolicy()
  if (!policy.enabled) return { ok: true, processed: 0, skipped: "disabled" }

  const db = await getDb()
  const state = await automationState(db)
  if (state.circuitOpen) {
    return { ok: true, processed: 0, skipped: "circuit_open", reason: state.circuitReason || "Manual review required" }
  }

  const now = new Date()
  const job = await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION)
    .find({
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

  const history = await channelCreationHistory(db)
  const rateEligibleAt = nextOrganicChannelEligibleAt(history, now, policy)
  const jobEligibleAt = parseDate(job.nextEligibleAt)
  const eligibleAt = new Date(Math.max(rateEligibleAt.getTime(), jobEligibleAt?.getTime() || 0))
  if (eligibleAt.getTime() > now.getTime()) {
    await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
      { _id: job._id },
      { $set: { status: "queued", nextEligibleAt: eligibleAt, updatedAt: now } },
    )
    return { ok: true, processed: 0, scheduled: 1, jobId: job._id, nextEligibleAt: eligibleAt.toISOString() }
  }

  const attempts = Number(job.attempts || 0) + 1
  const leaseExpiresAt = new Date(Date.now() + 2 * 60_000)
  await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
    { _id: job._id },
    {
      $set: {
        status: "running",
        attempts,
        leaseExpiresAt,
        nextEligibleAt: null,
        lastAttemptAt: now,
        updatedAt: now,
      },
    },
  )
  job.status = "running"
  job.attempts = attempts
  job.nextEligibleAt = undefined

  let connection: Awaited<ReturnType<typeof createTelegramUserGateway>> | null = null
  try {
    connection = await createTelegramUserGateway()
    const completed = await processOrganicChannelJob(job, {
      gateway: connection.gateway,
      checkpoint: async (changes) => {
        Object.assign(job, changes)
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
    const decision = classifyOrganicTelegramError(error)
    const message = decision.message.slice(0, 1000)

    if (decision.kind === "flood_wait") {
      const retryAt = new Date(Date.now() + (Number(decision.retryAfterSeconds || 60) + 5) * 1000)
      const changes: Record<string, any> = {
        status: "queued",
        nextEligibleAt: retryAt,
        leaseExpiresAt: null,
        lastError: message,
        failureKind: decision.kind,
        updatedAt: new Date(),
      }
      // FLOOD_WAIT guarantees the create call was rejected, so the pre-call ambiguity guard can be safely reset.
      if (decision.operation === "create_channel" && job.stage === "channel_create_started") changes.stage = "queued"
      await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne({ _id: job._id }, { $set: changes })
      await notifySource(job, `⏳ $${job.ticker} setup is safely paused until ${retryAt.toISOString()} because Telegram requested a cooldown. No action will be retried before then.`)
      return { ok: true, processed: 1, jobId: job._id, status: "scheduled", nextEligibleAt: retryAt.toISOString() }
    }

    if (decision.kind === "transient_read" && attempts < 3) {
      const retryAt = new Date(Date.now() + Math.min(5 * 60_000, 30_000 * (2 ** (attempts - 1))))
      await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
        { _id: job._id },
        {
          $set: {
            status: "queued",
            nextEligibleAt: retryAt,
            leaseExpiresAt: null,
            lastError: message,
            failureKind: decision.kind,
            updatedAt: new Date(),
          },
        },
      )
      return { ok: true, processed: 1, jobId: job._id, status: "scheduled", nextEligibleAt: retryAt.toISOString() }
    }

    await db.collection(ORGANIC_CHANNEL_JOB_COLLECTION).updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          leaseExpiresAt: null,
          lastError: message,
          failureKind: decision.kind,
          updatedAt: new Date(),
        },
      },
    )
    if (decision.openCircuit) await openAutomationCircuit(db, job, message)
    await notifySource(job, [
      `❌ $${job.ticker} organic channel setup stopped safely.`,
      decision.openCircuit ? "All automated channel creation is now paused for manual review." : "This job will not retry automatically.",
      `Telegram error: ${message}`,
    ].join("\n"))
    return { ok: false, processed: 1, jobId: job._id, status: "failed", circuitOpen: decision.openCircuit, error: message }
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
