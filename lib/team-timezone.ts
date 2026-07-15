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

export function teamDateKey(offsetDays = 0, timeZone = TEAM_TIME_ZONE) {
  const now = teamNowParts(timeZone)
  const anchor = zonedDateTimeToUtc(now.year, now.month, now.day, 12, 0, 0, timeZone)
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays)
  const parts = partsInTimeZone(anchor, timeZone)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
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

function parsedClock(raw: string) {
  if (/\bnoon\b/i.test(raw)) return { hour: 12, minute: 0 }
  if (/\bmidnight\b/i.test(raw)) return { hour: 0, minute: 0 }
  const match = raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const meridiem = String(match[3] || "").toLowerCase().replace(/\./g, "")
  if (hour > 23 || minute > 59) return null
  if (meridiem === "pm" && hour < 12) hour += 12
  if (meridiem === "am" && hour === 12) hour = 0
  return { hour, minute }
}

export function parseRelativeTeamDateTime(value: unknown, timeZone = TEAM_TIME_ZONE, now = new Date()) {
  const raw = String(value || "").trim().toLowerCase()
  if (!raw) return null

  const offset = raw.match(/\bin\s+(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\b/i)
  if (offset) {
    const amount = Number(offset[1])
    const unit = offset[2].toLowerCase()
    const multiplier = unit.startsWith("minute") ? 60_000 : unit.startsWith("hour") ? 3_600_000 : unit.startsWith("day") ? 86_400_000 : 604_800_000
    return new Date(now.getTime() + amount * multiplier)
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  const weekdayIndex = weekdays.findIndex((day) => new RegExp(`\\b(?:next\\s+)?${day}\\b`, "i").test(raw))
  const relativeDay = /\btomorrow\b/.test(raw) ? 1 : /\btoday\b|\btonight\b/.test(raw) ? 0 : null
  if (relativeDay === null && weekdayIndex < 0) return null

  const current = partsInTimeZone(now, timeZone)
  const currentAnchor = new Date(Date.UTC(current.year, current.month - 1, current.day, 12))
  let addDays = relativeDay ?? 0
  if (weekdayIndex >= 0) {
    const currentWeekday = currentAnchor.getUTCDay()
    addDays = (weekdayIndex - currentWeekday + 7) % 7
    if (addDays === 0) addDays = 7
  }
  currentAnchor.setUTCDate(currentAnchor.getUTCDate() + addDays)

  const clock = parsedClock(raw) || (/\btonight\b/.test(raw) ? { hour: 19, minute: 0 } : { hour: 9, minute: 0 })
  return zonedDateTimeToUtc(
    currentAnchor.getUTCFullYear(),
    currentAnchor.getUTCMonth() + 1,
    currentAnchor.getUTCDate(),
    clock.hour,
    clock.minute,
    0,
    timeZone,
  )
}

export function normalizeReminderDueAt(payload: { dueAt?: unknown; timeZone?: unknown; timezone?: unknown }, now = new Date()) {
  const timeZone = String(payload.timeZone || payload.timezone || TEAM_TIME_ZONE).trim() || TEAM_TIME_ZONE
  const parsed = parseTeamDateTime(payload.dueAt, timeZone) || parseRelativeTeamDateTime(payload.dueAt, timeZone, now)
  if (!parsed) return null
  return { dueAt: parsed.toISOString(), timeZone }
}
