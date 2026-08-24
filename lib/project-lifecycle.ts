import { getDb } from "@/lib/db"
import { LAUNCH_PADS } from "@/lib/launch-math"
import { cleanRevenueChain } from "@/lib/revenue-projects"
import { dateKeyInTimeZone, TEAM_TIME_ZONE } from "@/lib/team-timezone"

export const PROJECT_STATUSES = ["scheduled", "active", "inactive"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export const PROJECT_LAUNCH_TIMING_STATUSES = ["tentative", "confirmed"] as const
export type ProjectLaunchTimingStatus = (typeof PROJECT_LAUNCH_TIMING_STATUSES)[number]

const CHAIN_BY_LAUNCH_CHAIN = {
  sol: "solana",
  eth: "ethereum",
  bsc: "bnb",
  base: "base",
  rh: "robinhood",
} as const

function validDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""))
  return Number.isNaN(date.getTime()) ? null : date
}

export function projectLaunchAt(project: any) {
  return validDate(project?.launchAt || project?.launchDate)
}

export function projectTentativeLaunchDate(project: any) {
  const value = String(project?.tentativeLaunchDate || "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

export function projectLaunchTimingStatus(project: any): ProjectLaunchTimingStatus {
  return projectTentativeLaunchDate(project) && !projectLaunchAt(project) ? "tentative" : "confirmed"
}

export function projectLaunchDateKey(project: any, timeZone = TEAM_TIME_ZONE) {
  const tentative = projectTentativeLaunchDate(project)
  if (tentative && !projectLaunchAt(project)) return tentative
  const launchAt = projectLaunchAt(project)
  return launchAt ? dateKeyInTimeZone(launchAt, project?.launchTimeZone || timeZone) : ""
}

export function nextDateKey(value: string | Date, timeZone = TEAM_TIME_ZONE) {
  const date = validDate(value)
  if (!date) return ""
  const currentKey = dateKeyInTimeZone(date, timeZone)
  const anchor = new Date(`${currentKey}T12:00:00Z`)
  anchor.setUTCDate(anchor.getUTCDate() + 1)
  return anchor.toISOString().slice(0, 10)
}

export function normalizeProjectStatus(value: unknown, launchAt?: unknown, now = new Date()): ProjectStatus {
  const status = String(value || "").trim().toLowerCase()
  if (status === "inactive") return "inactive"
  if (status === "active") return "active"
  if (status === "scheduled" || status === "in_progress") return "scheduled"
  const launch = validDate(launchAt)
  return launch && launch.getTime() > now.getTime() ? "scheduled" : "active"
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s.-]+/g, "[\\s.-]*")
}

export function cleanLaunchProjectName(value: unknown) {
  const cleaned = String(value || "")
    .replace(/[()"“”'‘’]/g, " ")
    .replace(/^(?:please\s+)?(?:(?:add|put|schedule|set|move|reschedule)\s+)?(?:the\s+)?(?:project\s+)?/i, "")
    .replace(/\s+(?:project)$/i, "")
    .replace(/[,:;.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned && cleaned === cleaned.toLowerCase()) return cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  return cleaned
}

export function cleanLaunchProjectNameFromRequest(value: unknown, request: unknown) {
  let cleaned = cleanLaunchProjectName(value)
  const config = inferLaunchConfiguration(request)
  if (!config.launchVenue || !cleaned) return cleaned
  const venue = LAUNCH_PADS.find((pad) => pad.id === config.launchVenue)
  const terms = new Set<string>([
    venue?.id || "",
    venue?.name || "",
    venue?.id === "pumpfun" ? "pump fun" : "",
    venue?.id === "fourmeme" ? "four meme" : "",
    venue?.id === "aero" ? "aerodrome" : "",
    config.chain,
    config.chain === "solana" ? "solana" : "",
    config.chain === "bnb" ? "bsc" : "",
    config.quoteToken,
  ].filter(Boolean))
  const suffixPattern = Array.from(terms).sort((a, b) => b.length - a.length).map(escapedPattern).join("|")
  if (!suffixPattern) return cleaned
  for (let index = 0; index < 6; index++) {
    const next = cleaned.replace(new RegExp(`(?:\\s|[/·|,-])+(?:${suffixPattern})$`, "i"), "").trim()
    if (!next || next === cleaned) break
    cleaned = next
  }
  return cleanLaunchProjectName(cleaned)
}

export function inferLaunchConfiguration(text: unknown) {
  const raw = String(text || "")
  const lower = raw.toLowerCase()
  const explicitChain = /\bsolana\b/i.test(raw) ? "solana"
    : /\b(?:bnb|bsc|binance smart chain|bnb chain)\b/i.test(raw) ? "bnb"
      : /\bbase\b/i.test(raw) ? "base"
        : /\brobinhood(?: chain)?\b/i.test(raw) ? "robinhood"
          : /\b(?:ethereum|mainnet)\b/i.test(raw) ? "ethereum"
            : ""
  const venue = LAUNCH_PADS.find((pad) => {
    const aliases = [pad.id, pad.name]
    if (pad.id === "pumpfun") aliases.push("pump fun")
    if (pad.id === "aero") aliases.push("aerodrome")
    if (pad.id === "fourmeme") aliases.push("four meme")
    return aliases.some((alias) => new RegExp(`\\b${escapedPattern(alias)}\\b`, "i").test(lower))
  })
  const chain = cleanRevenueChain(explicitChain || (venue ? CHAIN_BY_LAUNCH_CHAIN[venue.chainId] : ""))
  const quoteMatch = raw.match(/\b(SOL|ETH|BNB|USDC|USDT)\s+(?:quote(?:\s+token)?|pair)\b/i)
    || raw.match(/\b(?:quote(?:\s+token)?|quoted\s+in|pair(?:ed)?\s+with)\s*(?:is|:)?\s*(SOL|ETH|BNB|USDC|USDT)\b/i)
  const quoteToken = String(quoteMatch?.[1] || venue?.symbol || "").toUpperCase()
  return {
    launchVenue: venue?.id || "",
    launchVenueLabel: venue?.name || "",
    launchFundingAsset: venue?.symbol || "",
    chain,
    quoteToken,
  }
}

export function projectQuoteToken(project: any) {
  const direct = String(project?.quoteToken || "").trim().toUpperCase()
  if (direct) return direct
  const assets = Array.isArray(project?.quoteAssets) ? project.quoteAssets.map((asset: any) => String(asset || "").trim().toUpperCase()).filter(Boolean) : []
  return assets.length === 1 ? assets[0] : ""
}

export function projectActivationReadiness(project: any) {
  const missing: string[] = []
  const chain = cleanRevenueChain(project?.chain || project?.revenueChain)
  const quoteToken = projectQuoteToken(project)
  const referrerStatus = String(project?.referrerStatus || (project?.referrer || project?.referrerAccountId ? "assigned" : "pending"))
  if (!chain) missing.push("chain")
  if (!quoteToken) missing.push("quote token")
  if (!project?.feeConfigurationConfirmed) missing.push("fee configuration")
  if (project?.dailyTradingFeeEnabled === true && !(Number(project?.dailyTradingFeeUsd) > 0)) missing.push("daily trading fee")
  if (!['assigned', 'none'].includes(referrerStatus)) missing.push("referrer decision")
  return { ready: missing.length === 0, missing, chain, quoteToken, referrerStatus }
}

export type ProjectActivationIntent = "scheduled" | "now"
export type ProjectReadinessStep = "standard_fees" | "no_referrer"

const projectLifecycleLocks = new Map<string, Promise<void>>()

async function withProjectLifecycleLock<T>(projectId: string, work: () => Promise<T>) {
  const previous = projectLifecycleLocks.get(projectId) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  projectLifecycleLocks.set(projectId, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (projectLifecycleLocks.get(projectId) === tail) projectLifecycleLocks.delete(projectId)
  }
}

export function activationLifecycleFields(project: any, params: {
  actual: "scheduled" | "now"
  telegramId?: number | null
  source: "launch_chat_confirmation" | "manual_dashboard"
  now?: Date
}) {
  const now = params.now || new Date()
  const scheduledAt = projectLaunchAt(project)
  const actualLaunchAt = params.actual === "scheduled" && scheduledAt ? scheduledAt : now
  return {
    status: "active" as const,
    actualLaunchAt: actualLaunchAt.toISOString(),
    activatedAt: now.toISOString(),
    activationSource: params.source,
    activatedByTelegramId: params.telegramId || null,
    dailyFeeStartDate: nextDateKey(actualLaunchAt, project.launchTimeZone || TEAM_TIME_ZONE),
    activationOverdue: false,
    nextActivationPromptAt: null,
    launchTimingStatus: "confirmed" as const,
    tentativeLaunchDate: null,
    pendingActivationIntent: null,
    pendingActivationRequestedAt: null,
    pendingActivationRequestedByTelegramId: null,
    updatedAt: now,
  }
}

export function tentativeLifecycleFields(params: {
  tentativeLaunchDate: string
  launchTimeZone?: string
  launchChatId?: number | string | null
  telegramId?: number | null
  previous?: any
}) {
  const tentativeLaunchDate = String(params.tentativeLaunchDate || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tentativeLaunchDate)) throw new Error("A valid tentative launch day is required")
  const previousLaunchAt = projectLaunchAt(params.previous)
  const previousTentativeDate = projectTentativeLaunchDate(params.previous)
  const changed = previousLaunchAt || (previousTentativeDate && previousTentativeDate !== tentativeLaunchDate)
  const history = changed
    ? [{
        launchAt: previousLaunchAt?.toISOString() || null,
        tentativeLaunchDate: previousTentativeDate || null,
        changedAt: new Date().toISOString(),
        changedByTelegramId: params.telegramId || null,
      }]
    : []
  return {
    status: "scheduled" as const,
    launchAt: null,
    launchDate: null,
    launchTimingStatus: "tentative" as const,
    tentativeLaunchDate,
    launchTimeZone: params.launchTimeZone || params.previous?.launchTimeZone || TEAM_TIME_ZONE,
    launchChatId: params.launchChatId == null ? params.previous?.launchChatId || null : String(params.launchChatId),
    scheduledByTelegramId: params.telegramId || params.previous?.scheduledByTelegramId || null,
    scheduleVersion: Number(params.previous?.scheduleVersion || 0) + 1,
    ...(history.length ? { launchScheduleHistory: [...(params.previous?.launchScheduleHistory || []), ...history] } : {}),
    activationPromptCount: 0,
    activationPromptSentAt: null,
    nextActivationPromptAt: null,
    activationOverdue: false,
    pendingActivationIntent: null,
    pendingActivationRequestedAt: null,
    pendingActivationRequestedByTelegramId: null,
  }
}

export function scheduledLifecycleFields(params: {
  launchAt: string | Date
  launchTimeZone?: string
  launchChatId?: number | string | null
  telegramId?: number | null
  previous?: any
}) {
  const launchAt = validDate(params.launchAt)
  if (!launchAt) throw new Error("A valid launch time is required")
  const previousLaunch = projectLaunchAt(params.previous)
  const previousTentativeDate = projectTentativeLaunchDate(params.previous)
  const history = (previousLaunch && previousLaunch.getTime() !== launchAt.getTime()) || previousTentativeDate
    ? [{ launchAt: previousLaunch?.toISOString() || null, tentativeLaunchDate: previousTentativeDate || null, changedAt: new Date().toISOString(), changedByTelegramId: params.telegramId || null }]
    : []
  return {
    status: "scheduled" as const,
    launchAt: launchAt.toISOString(),
    launchDate: launchAt.toISOString(),
    launchTimingStatus: "confirmed" as const,
    tentativeLaunchDate: null,
    launchTimeZone: params.launchTimeZone || params.previous?.launchTimeZone || TEAM_TIME_ZONE,
    launchChatId: params.launchChatId == null ? params.previous?.launchChatId || null : String(params.launchChatId),
    scheduledByTelegramId: params.telegramId || params.previous?.scheduledByTelegramId || null,
    scheduleVersion: Number(params.previous?.scheduleVersion || 0) + 1,
    ...(history.length ? { launchScheduleHistory: [...(params.previous?.launchScheduleHistory || []), ...history] } : {}),
    activationPromptCount: 0,
    activationPromptSentAt: null,
    nextActivationPromptAt: null,
    activationOverdue: false,
    pendingActivationIntent: null,
    pendingActivationRequestedAt: null,
    pendingActivationRequestedByTelegramId: null,
  }
}

export async function activateScheduledProject(params: {
  projectId: string
  telegramId: number
  actual: "scheduled" | "now"
  now?: Date
  expectedScheduleVersion?: number
}) {
  return withProjectLifecycleLock(params.projectId, async () => {
    const db = await getDb()
    const project = await db.collection("opsProjects").findOne({ _id: params.projectId })
    if (!project) return { ok: false as const, error: "Project not found" }
    if (project.status === "active") return { ok: true as const, alreadyActive: true, project }
    if (project.status !== "scheduled" && project.status !== "in_progress") return { ok: false as const, error: "Only scheduled projects can be activated" }
    if (params.expectedScheduleVersion != null && Number(project.scheduleVersion || 0) !== params.expectedScheduleVersion) {
      return { ok: false as const, error: "This launch schedule was updated. Use the newest confirmation message." }
    }
    const readiness = projectActivationReadiness(project)
    const now = params.now || new Date()
    if (!readiness.ready) {
      const pending = {
        pendingActivationIntent: params.actual,
        pendingActivationRequestedAt: now.toISOString(),
        pendingActivationRequestedByTelegramId: params.telegramId,
        updatedAt: now,
      }
      const pendingResult = await db.collection("opsProjects").updateOne(
        { _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion },
        { $set: pending },
      )
      if (!pendingResult.modifiedCount) return { ok: false as const, error: "The project changed before activation. Use the newest launch confirmation." }
      return { ok: false as const, error: `Complete ${readiness.missing.join(", ")} before activation.`, readiness, project: { ...project, ...pending } }
    }
    const update = activationLifecycleFields(project, { actual: params.actual, telegramId: params.telegramId, source: "launch_chat_confirmation", now })
    const result = await db.collection("opsProjects").updateOne(
      { _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion },
      { $set: update },
    )
    if (!result.modifiedCount) return { ok: false as const, error: "The project changed before activation. Refresh and try again." }
    await db.collection("opsProjectLifecycleEvents").insertOne({ projectId: String(project._id), projectName: project.name, action: "activated", ...update, createdAt: now })
    return { ok: true as const, project: { ...project, ...update }, activated: true as const, dailyFeeStartDate: update.dailyFeeStartDate }
  })
}

export async function rescheduleProject(params: { projectId: string; launchAt: string | Date; telegramId: number; chatId?: number | string; timeZone?: string; expectedScheduleVersion?: number }) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: params.projectId })
  if (!project) return { ok: false as const, error: "Project not found" }
  if (project.status === "active") return { ok: false as const, error: "An active project cannot be moved back to Scheduled without an admin lifecycle change." }
  if (project.status === "inactive") return { ok: false as const, error: "An inactive project cannot be rescheduled." }
  if (params.expectedScheduleVersion != null && Number(project.scheduleVersion || 0) !== params.expectedScheduleVersion) return { ok: false as const, error: "This launch schedule was already updated. Use the newest confirmation message." }
  const fields = scheduledLifecycleFields({ launchAt: params.launchAt, launchTimeZone: params.timeZone, launchChatId: params.chatId, telegramId: params.telegramId, previous: project })
  const now = new Date()
  const result = await db.collection("opsProjects").updateOne({ _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion }, { $set: { ...fields, updatedAt: now } })
  if (!result.modifiedCount) return { ok: false as const, error: "The project changed before it could be rescheduled. Use the newest schedule." }
  await db.collection("opsProjectLifecycleEvents").insertOne({ projectId: String(project._id), projectName: project.name, action: "rescheduled", previousLaunchAt: projectLaunchAt(project)?.toISOString() || null, launchAt: fields.launchAt, telegramId: params.telegramId, createdAt: now })
  return { ok: true as const, project: { ...project, ...fields } }
}

export async function setTentativeProjectLaunchDate(params: { projectId: string; tentativeLaunchDate: string; telegramId: number; chatId?: number | string; timeZone?: string; expectedScheduleVersion?: number }) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: params.projectId })
  if (!project) return { ok: false as const, error: "Project not found" }
  if (project.status === "active") return { ok: false as const, error: "An active project cannot be moved back to tentative timing." }
  if (project.status === "inactive") return { ok: false as const, error: "An inactive project cannot be rescheduled." }
  if (params.expectedScheduleVersion != null && Number(project.scheduleVersion || 0) !== params.expectedScheduleVersion) return { ok: false as const, error: "This launch schedule was already updated. Use the newest schedule." }
  let fields
  try {
    fields = tentativeLifecycleFields({ tentativeLaunchDate: params.tentativeLaunchDate, launchTimeZone: params.timeZone, launchChatId: params.chatId, telegramId: params.telegramId, previous: project })
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "A valid tentative launch day is required" }
  }
  const now = new Date()
  const result = await db.collection("opsProjects").updateOne({ _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion }, { $set: { ...fields, updatedAt: now } })
  if (!result.modifiedCount) return { ok: false as const, error: "The project changed before it could be rescheduled. Use the newest schedule." }
  await db.collection("opsProjectLifecycleEvents").insertOne({ projectId: String(project._id), projectName: project.name, action: "timing_marked_tentative", previousLaunchAt: projectLaunchAt(project)?.toISOString() || null, tentativeLaunchDate: fields.tentativeLaunchDate, telegramId: params.telegramId, createdAt: now })
  return { ok: true as const, project: { ...project, ...fields } }
}

export async function cancelScheduledProject(projectId: string, telegramId: number, now = new Date(), expectedScheduleVersion?: number) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  if (!project) return { ok: false as const, error: "Project not found" }
  if (project.status === "active") return { ok: false as const, error: "Deactivate active projects from project management." }
  if (project.status === "inactive") return { ok: true as const, alreadyInactive: true, project }
  if (expectedScheduleVersion != null && Number(project.scheduleVersion || 0) !== expectedScheduleVersion) return { ok: false as const, error: "This launch schedule was already updated. Use the newest confirmation message." }
  const update = { status: "inactive", inactivatedAt: now.toISOString(), inactivationSource: "launch_cancelled", inactivatedByTelegramId: telegramId, nextActivationPromptAt: null, activationOverdue: false, pendingActivationIntent: null, pendingActivationRequestedAt: null, pendingActivationRequestedByTelegramId: null, updatedAt: now }
  const result = await db.collection("opsProjects").updateOne({ _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion }, { $set: update })
  if (!result.modifiedCount) return { ok: false as const, error: "The project changed before cancellation. Use the newest schedule." }
  await db.collection("opsProjectLifecycleEvents").insertOne({ projectId: String(project._id), projectName: project.name, action: "cancelled", telegramId, createdAt: now })
  return { ok: true as const, project: { ...project, ...update } }
}

export async function completeProjectReadinessStep(params: {
  projectId: string
  telegramId: number
  step: ProjectReadinessStep
  expectedScheduleVersion?: number
  resumeActivation?: ProjectActivationIntent
  now?: Date
}) {
  return withProjectLifecycleLock(params.projectId, async () => {
    const db = await getDb()
    const project = await db.collection("opsProjects").findOne({ _id: params.projectId })
    if (!project) return { ok: false as const, error: "Project not found" }
    if (project.status === "active") {
      return {
        ok: true as const,
        alreadyActive: true as const,
        activated: true as const,
        project,
        readiness: projectActivationReadiness(project),
        dailyFeeStartDate: project.dailyFeeStartDate || null,
      }
    }
    if (project.status !== "scheduled" && project.status !== "in_progress") return { ok: false as const, error: "Only scheduled projects can be prepared for activation" }
    if (params.expectedScheduleVersion != null && Number(project.scheduleVersion || 0) !== params.expectedScheduleVersion) {
      return { ok: false as const, error: "This launch schedule was updated. Use the newest confirmation message." }
    }

    const now = params.now || new Date()
    let prerequisiteUpdate: Record<string, any>
    if (params.step === "no_referrer") {
      prerequisiteUpdate = {
        referrerStatus: "none",
        referrerConfirmedAt: now.toISOString(),
        referrerConfirmedByTelegramId: params.telegramId,
        updatedAt: now,
      }
    } else {
      const currentReadiness = projectActivationReadiness(project)
      if (!currentReadiness.chain || !currentReadiness.quoteToken) return { ok: false as const, error: "Set the chain and quote token before confirming fees." }
      prerequisiteUpdate = {
        chain: currentReadiness.chain,
        revenueChain: currentReadiness.chain,
        quoteToken: currentReadiness.quoteToken,
        quoteAssets: [currentReadiness.quoteToken],
        dailyTradingFeeEnabled: true,
        dailyTradingFeeUsd: Number(project.dailyTradingFeeUsd || 500),
        launchFeeUsd: Number(project.launchFeeUsd || 1000),
        feeConfigurationConfirmed: true,
        feeConfigurationConfirmedAt: now.toISOString(),
        feeConfigurationConfirmedByTelegramId: params.telegramId,
        updatedAt: now,
      }
    }

    const preparedProject = { ...project, ...prerequisiteUpdate }
    const readiness = projectActivationReadiness(preparedProject)
    const storedIntent = ["scheduled", "now"].includes(String(project.pendingActivationIntent || ""))
      ? project.pendingActivationIntent as ProjectActivationIntent
      : undefined
    const activationIntent = params.resumeActivation || storedIntent
    const activationUpdate = readiness.ready && activationIntent
      ? activationLifecycleFields(preparedProject, { actual: activationIntent, telegramId: params.telegramId, source: "launch_chat_confirmation", now })
      : null
    const update = { ...prerequisiteUpdate, ...(activationUpdate || {}) }
    const result = await db.collection("opsProjects").updateOne(
      { _id: project._id, status: project.status, scheduleVersion: project.scheduleVersion },
      { $set: update },
    )
    if (!result.modifiedCount) {
      const latest = await db.collection("opsProjects").findOne({ _id: project._id })
      if (latest?.status === "active") return { ok: true as const, alreadyActive: true as const, activated: true as const, project: latest, readiness: projectActivationReadiness(latest), dailyFeeStartDate: latest.dailyFeeStartDate || null }
      return { ok: false as const, error: "The project changed before setup was completed. Use the newest launch confirmation." }
    }

    const updatedProject = { ...preparedProject, ...(activationUpdate || {}) }
    if (activationUpdate) {
      await db.collection("opsProjectLifecycleEvents").insertOne({ projectId: String(project._id), projectName: project.name, action: "activated", ...activationUpdate, createdAt: now })
    }
    return {
      ok: true as const,
      project: updatedProject,
      readiness,
      activated: Boolean(activationUpdate),
      dailyFeeStartDate: activationUpdate?.dailyFeeStartDate || null,
    }
  })
}

export async function confirmNoProjectReferrer(projectId: string, telegramId: number, expectedScheduleVersion?: number) {
  return completeProjectReadinessStep({ projectId, telegramId, step: "no_referrer", expectedScheduleVersion })
}

export async function confirmStandardProjectFees(projectId: string, telegramId: number, expectedScheduleVersion?: number) {
  return completeProjectReadinessStep({ projectId, telegramId, step: "standard_fees", expectedScheduleVersion })
}

export function launchLifecycleMigrationPreview(projects: any[], now = new Date()) {
  return projects.map((project) => {
    const launchAt = projectLaunchAt(project)
    const currentStatus = String(project.status || "active")
    let proposedStatus: ProjectStatus = currentStatus === "inactive" ? "inactive" : "active"
    let reason = "Past or undated operational project remains active"
    if (currentStatus === "inactive") reason = "Inactive project remains inactive"
    else if (launchAt && launchAt.getTime() > now.getTime()) {
      proposedStatus = "scheduled"
      reason = "Future launch should await coordinator confirmation"
    } else if (currentStatus === "in_progress") {
      proposedStatus = launchAt && launchAt.getTime() > now.getTime() ? "scheduled" : "active"
      reason = "Legacy In Progress status requires lifecycle normalization"
    }
    return { projectId: String(project._id), name: project.name, currentStatus, proposedStatus, launchAt: launchAt?.toISOString() || null, changed: currentStatus !== proposedStatus, reason }
  })
}
