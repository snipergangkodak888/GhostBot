import { dateKeyInTimeZone, TEAM_TIME_ZONE } from "@/lib/team-timezone"

export const DAILY_PROJECT_REVIEW_HOUR_ET = 20

export type DailyProjectReviewProject = {
  projectId: string
  name: string
  activeSince?: string | null
}

export type DailyProjectReviewRecord = {
  _id: string
  chatId: string
  chatTitle?: string
  dateKey: string
  projects: DailyProjectReviewProject[]
  selectedProjectIds?: string[]
  status?: "pending" | "confirming" | "completed"
  completedAction?: "kept_active" | "deactivated"
  completedByTelegramId?: number | null
  completedByName?: string
  deactivatedProjectIds?: string[]
}

type ReviewButton = { text: string; callback_data: string }

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function dailyProjectReviewId(chatId: number | string, dateKey: string) {
  return `daily-project-review:${String(chatId)}:${dateKey}`
}

export function dailyProjectReviewDateKey(now = new Date()) {
  return dateKeyInTimeZone(now, TEAM_TIME_ZONE)
}

export function activeProjectReviewStart(project: any) {
  const candidates = [project?.actualLaunchAt, project?.activatedAt, project?.launchAt, project?.launchDate, project?.createdAt]
  for (const candidate of candidates) {
    const date = candidate instanceof Date ? candidate : new Date(String(candidate || ""))
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function activeAgeLabel(activeSince: string | null | undefined, now: Date) {
  const started = activeSince ? new Date(activeSince) : null
  if (!started || Number.isNaN(started.getTime())) return "active"
  const days = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 86_400_000))
  if (days === 0) return "active today"
  if (days === 1) return "active 1 day"
  return `active ${days} days`
}

export function dailyProjectReviewText(params: {
  review: DailyProjectReviewRecord
  now?: Date
  stage?: "select" | "confirm" | "complete"
  currentActiveProjects?: DailyProjectReviewProject[]
}) {
  const now = params.now || new Date()
  const selected = new Set(params.review.selectedProjectIds || [])
  const projects = params.review.projects || []
  const currentActive = params.currentActiveProjects || projects.filter((project) => !params.review.deactivatedProjectIds?.includes(project.projectId))
  const selectedProjects = projects.filter((project) => selected.has(project.projectId))

  if (params.stage === "confirm") {
    return [
      "⚠️ <b>Deactivate selected projects?</b>",
      "",
      ...selectedProjects.map((project) => `• ${escapeHtml(project.name)}`),
      "",
      "They will disappear from active-project views and stop generating new daily fee expectations. Revenue history, files, and notes stay intact.",
    ].join("\n")
  }

  if (params.stage === "complete" || params.review.status === "completed") {
    const deactivated = new Set(params.review.deactivatedProjectIds || [])
    const deactivatedProjects = projects.filter((project) => deactivated.has(project.projectId))
    return [
      "✅ <b>End-of-day project check complete</b>",
      "",
      deactivatedProjects.length
        ? `<b>Deactivated (${deactivatedProjects.length})</b>\n${deactivatedProjects.map((project) => `• ${escapeHtml(project.name)}`).join("\n")}`
        : "No projects were deactivated.",
      "",
      `<b>Still active (${currentActive.length})</b>${currentActive.length ? `\n${currentActive.map((project) => `• ${escapeHtml(project.name)}`).join("\n")}` : "\nNone"}`,
      params.review.completedByName ? `\nReviewed by ${escapeHtml(params.review.completedByName)}.` : "",
    ].filter(Boolean).join("\n")
  }

  return [
    "🌙 <b>End-of-day project check</b>",
    "",
    "Are all of these projects still active?",
    "",
    ...projects.map((project, index) => `${selected.has(project.projectId) ? "🛑" : "🟢"} ${index + 1}. <b>${escapeHtml(project.name)}</b> · ${activeAgeLabel(project.activeSince, now)}`),
    "",
    selected.size
      ? `${selected.size} selected to deactivate. Review the selection before applying it.`
      : "Select any projects that have finished, or confirm that all are still active.",
  ].join("\n")
}

export function dailyProjectReviewButtons(review: DailyProjectReviewRecord, stage: "select" | "confirm" = "select") {
  const selected = new Set(review.selectedProjectIds || [])
  if (stage === "confirm") {
    return [
      [{ text: `Deactivate ${selected.size} project${selected.size === 1 ? "" : "s"}`, callback_data: `eod:confirm:${review.dateKey}` }],
      [{ text: "⬅️ Change selection", callback_data: `eod:back:${review.dateKey}` }],
    ] satisfies ReviewButton[][]
  }

  const projectButtons: ReviewButton[][] = []
  for (let index = 0; index < review.projects.length; index += 2) {
    projectButtons.push(review.projects.slice(index, index + 2).map((project, offset) => ({
      text: `${selected.has(project.projectId) ? "✅" : "▫️"} ${project.name}`.slice(0, 32),
      callback_data: `eod:pick:${review.dateKey}:${index + offset}`,
    })))
  }
  return [
    ...projectButtons,
    ...(selected.size
      ? [[{ text: `Review ${selected.size} to deactivate`, callback_data: `eod:review:${review.dateKey}` }]]
      : [[{ text: "✅ All still active", callback_data: `eod:keep:${review.dateKey}` }]]),
  ] satisfies ReviewButton[][]
}
