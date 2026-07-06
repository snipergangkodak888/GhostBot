export const TEAM_TIME_ZONE = "America/New_York"

const ZONE_LABELS: Record<string, string> = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Los_Angeles": "PT",
  "UTC": "UTC",
}

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

export function teamZoneLabel(timeZone = TEAM_TIME_ZONE) {
  return ZONE_LABELS[timeZone] || timeZone.split("/").pop()?.replace(/_/g, " ") || timeZone
}

export function formatTeamDateTime(value: string | Date, timeZone = TEAM_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "No date"
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
  return `${label} ${teamZoneLabel(timeZone)}`
}

export function teamNowParts(timeZone = TEAM_TIME_ZONE) {
  return partsInTimeZone(new Date(), timeZone)
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone = TEAM_TIME_ZONE,
) {
  let candidate = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsInTimeZone(new Date(candidate), timeZone)
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second)
    const actualMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    candidate += desiredMs - actualMs
  }
  return new Date(candidate)
}

export function parseTeamDateTime(value: unknown, timeZone = TEAM_TIME_ZONE) {
  const raw = String(value || "").trim()
  if (!raw) return null

  if (/[+-]\d{2}:\d{2}$/.test(raw)) {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }

  let normalized = raw.replace(" ", "T")
  if (/[zZ]$/.test(normalized)) {
    normalized = normalized.replace(/[zZ]$/, "")
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (match) {
    const [, year, month, day, hour = "09", minute = "00", second = "00"] = match
    return zonedDateTimeToUtc(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      timeZone,
    )
  }

  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

export function normalizeReminderDueAt(payload: { dueAt?: unknown; timeZone?: unknown; timezone?: unknown }) {
  const timeZone = String(payload.timeZone || payload.timezone || TEAM_TIME_ZONE).trim() || TEAM_TIME_ZONE
  const parsed = parseTeamDateTime(payload.dueAt, timeZone)
  if (!parsed) return null
  return { dueAt: parsed.toISOString(), timeZone }
}
