import * as chrono from "chrono-node"

export const TEAM_TIME_ZONE = "America/New_York"

export const TIME_ZONE_OPTIONS = [
  { key: "pt", label: "Pacific", timeZone: "America/Los_Angeles" },
  { key: "mt", label: "Mountain", timeZone: "America/Denver" },
  { key: "ct", label: "Central", timeZone: "America/Chicago" },
  { key: "et", label: "Eastern", timeZone: "America/New_York" },
  { key: "utc", label: "UTC", timeZone: "UTC" },
  { key: "london", label: "London", timeZone: "Europe/London" },
  { key: "cyprus", label: "Cyprus", timeZone: "Asia/Nicosia" },
] as const

const ZONE_LABELS: Record<string, string> = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Los_Angeles": "PT",
  "UTC": "UTC",
}

export function isValidTimeZone(timeZone: unknown) {
  const value = String(timeZone || "").trim()
  if (!value) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function normalizeTimeZone(timeZone: unknown) {
  const raw = String(timeZone || "").trim()
  if (!raw) return ""
  const option = TIME_ZONE_OPTIONS.find((item) => item.key === raw.toLowerCase() || item.label.toLowerCase() === raw.toLowerCase())
  const value = option?.timeZone || raw
  return isValidTimeZone(value) ? value : ""
}

export function timeZoneFromOption(key: unknown) {
  return TIME_ZONE_OPTIONS.find((item) => item.key === String(key || "").toLowerCase())?.timeZone || ""
}

export function detectExplicitTimeZone(text: unknown) {
  const value = String(text || "")
  const iana = value.match(/\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+\b/)?.[0]
  if (iana && isValidTimeZone(iana)) return iana

  const aliases: Array<[RegExp, string]> = [
    [/\b(?:PST|PDT|PT|Pacific(?:\s+Time)?)\b/i, "America/Los_Angeles"],
    [/\b(?:MST|MDT|MT|Mountain(?:\s+Time)?)\b/i, "America/Denver"],
    [/\b(?:CST|CDT|CT|Central(?:\s+Time)?)\b/i, "America/Chicago"],
    [/\b(?:EST|EDT|ET|Eastern(?:\s+Time)?)\b/i, "America/New_York"],
    [/\b(?:London(?:\s+Time)?|BST)\b/i, "Europe/London"],
    [/\b(?:Cyprus(?:\s+Time)?|EEST)\b/i, "Asia/Nicosia"],
    [/\b(?:UTC|GMT)\b/i, "UTC"],
  ]
  return aliases.find(([pattern]) => pattern.test(value))?.[1] || ""
}

export function partsInTimeZone(date: Date, timeZone: string) {
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

export function dateKeyInTimeZone(date: Date, timeZone = TEAM_TIME_ZONE) {
  const parts = partsInTimeZone(date, timeZone)
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

  if (/[zZ]$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }

  let normalized = raw.replace(" ", "T")

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
  const match = raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    || raw.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i)
    || (/\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw)
      ? raw.match(/\b(\d{1,2})(?::(\d{2}))?\b/i)
      : null)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const meridiem = String(match[3] || "").toLowerCase().replace(/\./g, "")
  if (hour > 23 || minute > 59) return null
  if (meridiem === "pm" && hour < 12) hour += 12
  if (meridiem === "am" && hour === 12) hour = 0
  return { hour, minute }
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function naturalCalendarParts(raw: string, timeZone: string, now: Date) {
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }

  const named = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i)
  const reversed = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:,?\s+(\d{4}))?\b/i)
  const match = named
    ? { month: MONTH_INDEX[named[1].toLowerCase()], day: Number(named[2]), year: Number(named[3] || 0) }
    : reversed
      ? { month: MONTH_INDEX[reversed[2].toLowerCase()], day: Number(reversed[1]), year: Number(reversed[3] || 0) }
      : null
  if (!match) return null

  const current = partsInTimeZone(now, timeZone)
  let year = match.year || current.year
  if (!match.year && (match.month < current.month || (match.month === current.month && match.day < current.day))) year += 1
  return { year, month: match.month, day: match.day }
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

export function parseNaturalTeamDateTime(value: unknown, timeZone = TEAM_TIME_ZONE, now = new Date()) {
  const raw = String(value || "").trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?(?:[zZ]|[+-]\d{2}:\d{2})?$/.test(raw)) {
    return parseTeamDateTime(raw, timeZone)
  }

  const relative = parseRelativeTeamDateTime(raw, timeZone, now)
  if (relative) return relative

  const calendar = naturalCalendarParts(raw, timeZone, now)
  if (calendar) {
    const clock = parsedClock(raw) || { hour: 9, minute: 0 }
    const parsed = zonedDateTimeToUtc(calendar.year, calendar.month, calendar.day, clock.hour, clock.minute, 0, timeZone)
    const verified = partsInTimeZone(parsed, timeZone)
    if (verified.year === calendar.year && verified.month === calendar.month && verified.day === calendar.day) return parsed
    return null
  }

  const direct = parseTeamDateTime(raw, timeZone)
  if (direct) return direct
  return parseContextualTeamDateTime(raw, { timeZone, now }).date
}

export type ContextualTeamDateTimeIssue = "unrecognized" | "missing_time" | "ambiguous_meridiem" | "invalid_local_time"

export type ContextualTeamDateTimeResult = {
  date: Date | null
  timeZone: string
  issue?: ContextualTeamDateTimeIssue
  resolvedDateKey?: string
  usedDefaultDate?: boolean
  usedDefaultTime?: boolean
}

type ContextualTeamDateTimeOptions = {
  timeZone?: string
  now?: Date
  defaultDate?: string | Date | null
  defaultTime?: string | Date | null
}

function withoutTimeZoneWords(value: string) {
  return value
    .replace(/\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+\b/g, " ")
    .replace(/\b(?:PST|PDT|PT|Pacific(?:\s+Time)?|MST|MDT|MT|Mountain(?:\s+Time)?|CST|CDT|CT|Central(?:\s+Time)?|EST|EDT|ET|Eastern(?:\s+Time)?|London(?:\s+Time)?|BST|Cyprus(?:\s+Time)?|EEST|UTC|GMT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hasAmbiguousMeridiem(value: string) {
  if (/\b(?:a\.?m\.?|p\.?m\.?|noon|midnight)\b/i.test(value)) return false
  const match = value.match(/(?:^|\bat\s+)(\d{1,2})(?::(\d{2}))?(?:\s|$)/i)
  if (!match) return false
  const hour = Number(match[1])
  return hour >= 1 && hour <= 12
}

function datePartsFromDefault(value: string | Date | null | undefined, timeZone: string) {
  if (!value) return null
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    return { year, month, day, hour: 0, minute: 0, second: 0 }
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : partsInTimeZone(date, timeZone)
}

/**
 * Parses an edit-time expression while preserving missing date/time components
 * from the launch being edited. Chrono performs language extraction; final UTC
 * construction stays in our IANA timezone code so DST remains deterministic.
 */
export function parseContextualTeamDateTime(value: unknown, options: ContextualTeamDateTimeOptions = {}): ContextualTeamDateTimeResult {
  const raw = String(value || "").trim()
  const requestedZone = detectExplicitTimeZone(raw) || normalizeTimeZone(options.timeZone) || TEAM_TIME_ZONE
  if (!raw) return { date: null, timeZone: requestedZone, issue: "unrecognized" }
  if (hasAmbiguousMeridiem(raw)) return { date: null, timeZone: requestedZone, issue: "ambiguous_meridiem" }

  const now = options.now || new Date()
  const nowParts = partsInTimeZone(now, requestedZone)
  const referenceWallClock = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second))
  const source = withoutTimeZoneWords(raw)
  const result = chrono.casual.parse(source, { instant: referenceWallClock, timezone: "UTC" }, { forwardDate: true })[0]
  const sameTime = /\b(?:same|this)\s+time\b/i.test(raw)
  const defaultDate = datePartsFromDefault(options.defaultDate, requestedZone)
  const defaultTime = datePartsFromDefault(options.defaultTime, requestedZone)

  if (!result && sameTime && defaultDate && defaultTime) {
    return {
      date: zonedDateTimeToUtc(defaultDate.year, defaultDate.month, defaultDate.day, defaultTime.hour, defaultTime.minute, 0, requestedZone),
      timeZone: requestedZone,
      resolvedDateKey: `${defaultDate.year}-${String(defaultDate.month).padStart(2, "0")}-${String(defaultDate.day).padStart(2, "0")}`,
      usedDefaultDate: true,
      usedDefaultTime: true,
    }
  }
  if (!result) return { date: null, timeZone: requestedZone, issue: "unrecognized" }

  const explicitDate = result.start.isCertain("day") || result.start.isCertain("month") || result.start.isCertain("year") || result.start.isCertain("weekday")
  const explicitTime = result.start.isCertain("hour")
  const year = explicitDate ? Number(result.start.get("year")) : Number(defaultDate?.year || nowParts.year)
  const month = explicitDate ? Number(result.start.get("month")) : Number(defaultDate?.month || nowParts.month)
  const day = explicitDate ? Number(result.start.get("day")) : Number(defaultDate?.day || nowParts.day)
  const resolvedDateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

  let hour: number | null = explicitTime ? Number(result.start.get("hour")) : null
  let minute = explicitTime ? Number(result.start.get("minute") || 0) : 0
  let usedDefaultTime = false
  if ((!explicitTime || sameTime) && defaultTime) {
    hour = defaultTime.hour
    minute = defaultTime.minute
    usedDefaultTime = true
  }
  if (hour == null) return { date: null, timeZone: requestedZone, issue: "missing_time", resolvedDateKey }

  const date = zonedDateTimeToUtc(year, month, day, hour, minute, 0, requestedZone)
  const verified = partsInTimeZone(date, requestedZone)
  if (verified.year !== year || verified.month !== month || verified.day !== day || verified.hour !== hour || verified.minute !== minute) {
    return { date: null, timeZone: requestedZone, issue: "invalid_local_time", resolvedDateKey }
  }
  return {
    date,
    timeZone: requestedZone,
    resolvedDateKey,
    usedDefaultDate: !explicitDate,
    usedDefaultTime,
  }
}

export function parseNaturalTeamDate(value: unknown, timeZone = TEAM_TIME_ZONE, now = new Date()) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const parsed = parseNaturalTeamDateTime(raw, timeZone, now)
  return parsed ? dateKeyInTimeZone(parsed, timeZone) : ""
}

export function temporalDateConflict(value: unknown, timeZone = TEAM_TIME_ZONE, now = new Date()) {
  const raw = String(value || "").trim()
  const relativeOffset = /\btomorrow\b/i.test(raw) ? 1 : /\btoday\b|\btonight\b/i.test(raw) ? 0 : null
  if (relativeOffset === null) return null

  const explicit = naturalCalendarParts(raw, timeZone, now)
  if (!explicit) return null
  const explicitDate = zonedDateTimeToUtc(explicit.year, explicit.month, explicit.day, 12, 0, 0, timeZone)
  const expected = new Date(now)
  const current = partsInTimeZone(expected, timeZone)
  const expectedDate = zonedDateTimeToUtc(current.year, current.month, current.day, 12, 0, 0, timeZone)
  expectedDate.setUTCDate(expectedDate.getUTCDate() + relativeOffset)
  const expectedKey = dateKeyInTimeZone(expectedDate, timeZone)
  const explicitKey = dateKeyInTimeZone(explicitDate, timeZone)
  if (expectedKey === explicitKey) return null
  return {
    relativeLabel: relativeOffset === 1 ? "tomorrow" : "today",
    expectedKey,
    explicitKey,
  }
}

export function normalizeReminderDueAt(payload: { dueAt?: unknown; timeZone?: unknown; timezone?: unknown }, now = new Date()) {
  const timeZone = normalizeTimeZone(payload.timeZone || payload.timezone) || TEAM_TIME_ZONE
  const parsed = parseNaturalTeamDateTime(payload.dueAt, timeZone, now)
  if (!parsed) return null
  return { dueAt: parsed.toISOString(), timeZone }
}

export type ReminderRecurrence = "none" | "hourly" | "daily" | "weekly"

export function reminderRecurrenceFromText(text: unknown, requested?: unknown): ReminderRecurrence {
  const normalizedRequested = String(requested || "").trim().toLowerCase()
  if (["hourly", "daily", "weekly"].includes(normalizedRequested)) {
    return normalizedRequested as ReminderRecurrence
  }

  const normalized = String(text || "").trim().toLowerCase()
  if (/\b(?:every|each)\s+hour\b|\bhourly\b/.test(normalized)) return "hourly"
  if (/\b(?:every|each)\s+(?:day|morning|afternoon|evening|night)\b|\bdaily\b/.test(normalized)) return "daily"
  if (/\b(?:every|each)\s+week\b|\bweekly\b|\bevery\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/.test(normalized)) return "weekly"
  return "none"
}

export function nextRecurringDueAt(
  currentDueAt: string,
  recurrence: string,
  timeZone = TEAM_TIME_ZONE,
  now = new Date(),
) {
  const current = new Date(currentDueAt)
  if (Number.isNaN(current.getTime())) return null
  if (recurrence === "hourly") {
    const next = new Date(current)
    while (next.getTime() <= now.getTime()) next.setTime(next.getTime() + 60 * 60 * 1000)
    return next.toISOString()
  }
  const days = recurrence === "daily" ? 1 : recurrence === "weekly" ? 7 : 0
  if (!days) return null

  const zone = normalizeTimeZone(timeZone) || TEAM_TIME_ZONE
  const local = partsInTimeZone(current, zone)
  const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day, 12))
  let next = current
  do {
    calendar.setUTCDate(calendar.getUTCDate() + days)
    next = zonedDateTimeToUtc(
      calendar.getUTCFullYear(),
      calendar.getUTCMonth() + 1,
      calendar.getUTCDate(),
      local.hour,
      local.minute,
      local.second,
      zone,
    )
  } while (next.getTime() <= now.getTime())
  return next.toISOString()
}
