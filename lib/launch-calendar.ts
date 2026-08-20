import { getDb } from "@/lib/db"

export const LAUNCH_TIME_ZONE = "America/New_York"

function dateParts(value: string | Date, timeZone = LAUNCH_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
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
  const date = value instanceof Date ? value : new Date(value)
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
  const projects = await db.collection("opsProjects").find({ launchDate: { $exists: true } }).toArray()
  return projects
    .filter((project: any) => project.status !== "inactive" && project.launchDate && launchDateKey(project.launchDate) === targetKey)
    .sort((a: any, b: any) => new Date(a.launchDate).getTime() - new Date(b.launchDate).getTime())
}

export async function formatLaunchDaySchedule(value: string | Date, options: { morning?: boolean } = {}) {
  const parsed = dateParts(value)
  if (!parsed) return "⚠️ I could not determine the launch date."
  const launches = await getLaunchesForDay(parsed.date)
  const header = options.morning ? "☀️ Today’s Launch Schedule" : "📅 Launch Schedule"
  const lines = launches.map((project: any) => {
    const owner = String(project.referrer || project.owner || "").trim()
    return `• ${launchTimeLabel(project.launchDate)} — ${project.name || "Unnamed project"}${owner ? ` (${owner})` : ""}`
  })
  return [
    header,
    launchDayLabel(parsed.date),
    "",
    ...(lines.length ? lines : ["No launches scheduled."]),
  ].join("\n")
}
