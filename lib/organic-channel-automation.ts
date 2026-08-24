import { organicChannelTitle, sumoSubscribeCommand } from "./organic-channel-setup"

export const ORGANIC_CHANNEL_JOB_COLLECTION = "organicChannelJobs"

export type OrganicChannelRef = {
  id: string
  accessHash: string
}

export type OrganicChannelStage =
  | "queued"
  | "channel_created"
  | "about_cleared"
  | "photo_set"
  | "sumo_admin_set"
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
  createdAt?: string | Date
  updatedAt?: string | Date
}

export type OrganicAutomationGateway = {
  preflight(): Promise<void>
  findChannelByMarker(marker: string): Promise<OrganicChannelRef | null>
  createBroadcastChannel(title: string, about: string): Promise<OrganicChannelRef>
  clearChannelAbout(channel: OrganicChannelRef): Promise<void>
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
  channel_created: 1,
  about_cleared: 2,
  photo_set: 3,
  sumo_admin_set: 4,
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

export function organicChannelMarker(jobId: string) {
  return `ghostbot-organic:${String(jobId).trim()}`
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
  const marker = organicChannelMarker(job._id)

  // Validate every credential and local asset before the first Telegram side effect.
  await deps.gateway.preflight()

  if (!reached(job, "channel_created")) {
    const existing = await deps.gateway.findChannelByMarker(marker)
    const channel = existing || await deps.gateway.createBroadcastChannel(
      organicChannelTitle(job.ticker),
      `GhostBot organic notifications · ${marker}`,
    )
    await save(job, deps, {
      channel,
      channelBotApiId: telegramChannelBotApiId(channel.id),
      stage: "channel_created",
    })
  }

  if (!job.channel) throw new Error("Organic channel reference is missing after creation")

  if (!reached(job, "about_cleared")) {
    await deps.gateway.clearChannelAbout(job.channel)
    await save(job, deps, { stage: "about_cleared" })
  }

  if (!reached(job, "photo_set")) {
    await deps.gateway.setChannelPhoto(job.channel)
    await save(job, deps, { stage: "photo_set" })
  }

  if (!reached(job, "sumo_admin_set")) {
    await deps.gateway.addSumoBotAsAdmin(job.channel)
    await save(job, deps, { stage: "sumo_admin_set" })
  }

  if (!reached(job, "command_ready")) {
    const command = sumoSubscribeCommand(job.channelBotApiId || telegramChannelBotApiId(job.channel.id), job.profileId)
    await save(job, deps, { subscribeCommand: command, stage: "command_ready" })
  }

  if (!reached(job, "invite_created")) {
    const inviteLink = await deps.gateway.createInviteLink(job.channel, `${job.ticker} client invite`.slice(0, 32))
    await save(job, deps, { inviteLink, stage: "invite_created" })
  }

  if (!job.inviteLink) throw new Error("Organic channel invite link is missing")

  await save(job, deps, { status: "complete", stage: "complete", lastError: "" })
  return job
}
