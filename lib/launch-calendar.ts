import { getDb } from "@/lib/db"
import { projectLaunchAt, projectLaunchDateKey, projectLaunchTimingStatus } from "@/lib/project-lifecycle"
import { launchMethodLabel, normalizeLaunchMethod } from "@/lib/launch-method"

export const LAUNCH_TIME_ZONE = "America/New_York"

function dateParts(value: string | Date, timeZone = LAUNCH_TIME_ZONE) {
  const raw = String(value || "")
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ""
  return { key: `${part("year")}-${part("month")}-${part("day")}`, date }
}

export function launchDateKey(value: string | Date = new Date()) {
  return dateParts(value)?.key || ""
}

function launchDayLabel(value: string | Date) {
  const raw = String(value || "")
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw)
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LAUNCH_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function launchTimeLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LAUNCH_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date)
}

export async function getLaunchesForDay(value: string | Date) {
  const targetKey = launchDateKey(value)
  if (!targetKey) return []
  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  return projects
    .filter((project: any) => {
      return project.status !== "inactive" && projectLaunchDateKey(project, LAUNCH_TIME_ZONE) === targetKey
    })
    .sort((a: any, b: any) => {
      const aLaunch = projectLaunchAt(a)
      const bLaunch = projectLaunchAt(b)
      if (aLaunch && bLaunch) return aLaunch.getTime() - bLaunch.getTime()
      if (aLaunch) return -1
      if (bLaunch) return 1
      return String(a.name || "").localeCompare(String(b.name || ""))
    })
}

export async function formatLaunchDaySchedule(value: string | Date, options: { morning?: boolean } = {}) {
  const parsed = dateParts(value)
  if (!parsed) return "⚠️ I could not determine the launch date."
  const launches = await getLaunchesForDay(parsed.date)
  const header = options.morning ? "☀️ Today’s Launch Schedule" : "📅 Launch Schedule"
  const lines = launches.map((project: any) => {
    const owner = String(project.referrer || project.owner || "").trim()
    const launchAt = projectLaunchAt(project)
    const tentative = projectLaunchTimingStatus(project) === "tentative"
    const status = project.status === "active" ? "Active" : tentative ? "Tentative" : project.activationOverdue ? "Awaiting confirmation" : "Scheduled"
    const method = normalizeLaunchMethod(project.launchMethod) ? ` · ${launchMethodLabel(project.launchMethod)}` : ""
    return `• ${launchAt ? launchTimeLabel(launchAt) : "Time TBD"} — ${project.name || "Unnamed project"}${owner ? ` (${owner})` : ""} · ${status}${method}`
  })
  return [
    header,
    launchDayLabel(parsed.date),
    "",
    ...(lines.length ? lines : ["No launches scheduled."]),
  ].join("\n")
}
