import { getDb } from "@/lib/db"
import { projectLaunchAt, projectLaunchDateKey } from "@/lib/project-lifecycle"
import { launchMethodLabel, normalizeLaunchMethod } from "@/lib/launch-method"
import { launchPad } from "@/lib/launch-math"

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
    month: "short",
    day: "numeric",
  }).format(date)
}

function launchTimeLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LAUNCH_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date) + " ET"
}

function launchLocation(project: any) {
  const chain = String(project.chain || project.revenueChain || "").toLowerCase()
  const chainLabel = chain === "solana" ? "Solana"
    : chain === "robinhood" ? "Robinhood"
      : chain === "bnb" ? "BNB Chain"
        : chain === "ethereum" ? "Ethereum"
          : chain === "base" ? "Base"
            : "Chain TBD"
  const venue = launchPad(String(project.launchVenue || ""))?.name
    ?.replace(/^Uniswap\s+/i, "Uni ")
    .replace(/\s*\(full range\)$/i, "")
  return venue ? `${chainLabel}/${venue}` : chainLabel
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

export async function formatLaunchDaySchedule(value: string | Date, _options: { morning?: boolean } = {}) {
  const parsed = dateParts(value)
  if (!parsed) return "⚠️ I could not determine the launch date."
  const launches = await getLaunchesForDay(parsed.date)
  const header = parsed.key === launchDateKey(new Date()) ? `Today’s Launches — ${launchDayLabel(parsed.date)}` : `Launches — ${launchDayLabel(parsed.date)}`
  const lines = launches.map((project: any) => {
    const launchAt = projectLaunchAt(project)
    const method = normalizeLaunchMethod(project.launchMethod) ? ` · ${launchMethodLabel(project.launchMethod)}` : ""
    return `${launchAt ? launchTimeLabel(launchAt) : "TBD"} — ${project.name || "Unnamed project"} · ${launchLocation(project)}${method}`
  })
  return [
    header,
    "",
    ...(lines.length ? lines : ["No launches scheduled."]),
  ].join("\n")
}
