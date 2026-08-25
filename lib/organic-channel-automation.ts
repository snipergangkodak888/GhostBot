import { organicChannelTitle, sumoSubscribeCommand } from "./organic-channel-setup"
import type { OrganicTelegramOperation } from "./organic-channel-policy"

export const ORGANIC_CHANNEL_JOB_COLLECTION = "organicChannelJobs"

export type OrganicChannelRef = {
  id: string
  accessHash: string
}

export type OrganicChannelStage =
  | "queued"
  | "channel_create_started"
  | "channel_created"
  // Legacy checkpoints retained so existing jobs remain readable.
  | "about_cleared"
  | "photo_set"
  | "sumo_admin_set"
  | "requester_admin_set"
  | "command_ready"
  | "invite_created"
  | "complete"

export type OrganicChannelJob = {
  _id: string
  ticker: string
  profileId: string
  sourceChatId: string
  requestedByTelegramId: number
  stage: OrganicChannelStage
  status: "queued" | "running" | "retry" | "complete" | "failed"
  channel?: OrganicChannelRef
  channelBotApiId?: string
  inviteLink?: string
  subscribeCommand?: string
  attempts?: number
  lastError?: string
  nextEligibleAt?: string | Date
  channelCreatedAt?: string | Date
  failureKind?: string
  createdAt?: string | Date
  updatedAt?: string | Date
}

export type OrganicAutomationGateway = {
  preflight(): Promise<void>
  createBroadcastChannel(title: string, about: string): Promise<OrganicChannelRef>
  setChannelPhoto(channel: OrganicChannelRef): Promise<void>
  addSumoBotAsAdmin(channel: OrganicChannelRef): Promise<void>
  createInviteLink(channel: OrganicChannelRef, title: string): Promise<string>
}

export type OrganicAutomationDependencies = {
  gateway: OrganicAutomationGateway
  checkpoint(changes: Partial<OrganicChannelJob>): Promise<void>
}

const STAGE_NUMBER: Record<OrganicChannelStage, number> = {
  queued: 0,
  channel_create_started: 1,
  channel_created: 2,
  about_cleared: 2,
  photo_set: 3,
  sumo_admin_set: 4,
  requester_admin_set: 4,
  command_ready: 5,
  invite_created: 6,
  complete: 7,
}

function reached(job: OrganicChannelJob, stage: OrganicChannelStage) {
  return STAGE_NUMBER[job.stage] >= STAGE_NUMBER[stage]
}

function apply(job: OrganicChannelJob, changes: Partial<OrganicChannelJob>) {
  Object.assign(job, changes)
}

async function save(job: OrganicChannelJob, deps: OrganicAutomationDependencies, changes: Partial<OrganicChannelJob>) {
  apply(job, changes)
  await deps.checkpoint(changes)
}

export class OrganicChannelOperationError extends Error {
  operation: OrganicTelegramOperation
  cause?: unknown

  constructor(operation: OrganicTelegramOperation, error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.name = "OrganicChannelOperationError"
    this.operation = operation
    this.cause = error
  }
}

async function telegramOperation<T>(operation: OrganicTelegramOperation, action: () => Promise<T>) {
  try {
    return await action()
  } catch (error) {
    throw new OrganicChannelOperationError(operation, error)
  }
}

export function telegramChannelBotApiId(rawChannelId: string | number) {
  const raw = BigInt(String(rawChannelId).trim())
  const zero = BigInt(0)
  return String(-(BigInt("1000000000000") + (raw < zero ? -raw : raw)))
}

export async function processOrganicChannelJob(
  original: OrganicChannelJob,
  deps: OrganicAutomationDependencies,
) {
  const job: OrganicChannelJob = { ...original, channel: original.channel ? { ...original.channel } : undefined }

  // Validate every credential and local asset before the first Telegram side effect.
  await telegramOperation("preflight", () => deps.gateway.preflight())

  if (!reached(job, "channel_created")) {
    if (job.stage === "channel_create_started") {
      throw new OrganicChannelOperationError(
        "create_channel",
        new Error("Channel creation outcome is unknown; manual reconciliation is required before another create request"),
      )
    }
    await save(job, deps, { stage: "channel_create_started" })
    const channel = await telegramOperation("create_channel", () => deps.gateway.createBroadcastChannel(
      organicChannelTitle(job.ticker),
      "",
    ))
    await save(job, deps, {
      channel,
      channelBotApiId: telegramChannelBotApiId(channel.id),
      channelCreatedAt: new Date(),
      stage: "channel_created",
    })
  }

  if (!job.channel) throw new Error("Organic channel reference is missing after creation")

  if (!reached(job, "photo_set")) {
    await telegramOperation("set_photo", () => deps.gateway.setChannelPhoto(job.channel!))
    await save(job, deps, { stage: "photo_set" })
  }

  if (!reached(job, "sumo_admin_set")) {
    await telegramOperation("add_sumo_admin", () => deps.gateway.addSumoBotAsAdmin(job.channel!))
    await save(job, deps, { stage: "sumo_admin_set" })
  }

  if (!reached(job, "command_ready")) {
    const command = sumoSubscribeCommand(job.channelBotApiId || telegramChannelBotApiId(job.channel.id), job.profileId)
    await save(job, deps, { subscribeCommand: command, stage: "command_ready" })
  }

  if (!reached(job, "invite_created")) {
    const inviteLink = await telegramOperation("create_invite", () => deps.gateway.createInviteLink(
      job.channel!,
      `${job.ticker} client invite`.slice(0, 32),
    ))
    await save(job, deps, { inviteLink, stage: "invite_created" })
  }

  if (!job.inviteLink) throw new Error("Organic channel invite link is missing")

  await save(job, deps, { status: "complete", stage: "complete", lastError: "" })
  return job
}
