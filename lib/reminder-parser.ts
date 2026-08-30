import * as chrono from "chrono-node"
import {
  detectExplicitTimeZone,
  nextRecurringDueAt,
  normalizeTimeZone,
  parseNaturalTeamDateTime,
  reminderRecurrenceFromText,
  TEAM_TIME_ZONE,
  type ReminderRecurrence,
} from "@/lib/team-timezone"

export type ParsedReminderRequest = {
  ok: true
  text: string
  dueAt: string
  timeZone: string
  recurrence: ReminderRecurrence
  targetMode: "unspecified" | "everyone" | "creator" | "specific"
  targetUsernames: string[]
} | {
  ok: false
  issue: "missing_title" | "missing_time" | "unrecognized_time" | "past_time"
}

export function isReminderRequest(text: unknown) {
  const value = String(text || "").trim()
  if (/\b(?:delete|remove|cancel|dismiss|list|show|view)\b[^.?!]{0,40}\bremind(?:er|ers)?\b/i.test(value)) return false
  return /\bremind\s+(?:me|us|the\s+team|team|everyone|this\s+chat|@[a-z0-9_]+)/i.test(value)
    || /\b(?:add|create|set|schedule)\s+(?:a\s+)?reminder\b/i.test(value)
    || /^\s*reminder\b/i.test(value)
}

function hasUsableTime(text: string, now: Date) {
  return chrono.casual.parse(text, now, { forwardDate: true }).some((result) => result.start.isCertain("hour"))
    || /\bin\s+\d+\s*(?:minutes?|hours?|days?|weeks?)\b/i.test(text)
    || /\b(?:noon|midnight)\b/i.test(text)
    || /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(text)
    || /\bat\s+\d{1,2}:\d{2}\b/i.test(text)
    || /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\b/.test(text)
}

function removeChronoDates(text: string, now: Date, preserveBareDayPart = false) {
  let result = text
  const matches = chrono.casual.parse(text, now, { forwardDate: true })
  for (const match of [...matches].sort((a, b) => b.index - a.index)) {
    if (preserveBareDayPart && /^(?:the\s+)?(?:morning|afternoon|evening|night)$/i.test(match.text.trim())) continue
    result = `${result.slice(0, match.index)} ${result.slice(match.index + match.text.length)}`
  }
  return result
}

function naturalReminderText(text: string, now: Date) {
  const explicitSubject = text.match(/\b(?:for|about)\s+(.+)$/i)?.[1]
    || text.match(/\bto\s+(.+)$/i)?.[1]
  let title = removeChronoDates(explicitSubject || text, now, Boolean(explicitSubject))
  return title
    .replace(/^\s*\/?(?:setreminder|ai)\b\s*/i, "")
    .replace(/^\s*remind(?:er)?\s+(?:(?:me|us|the\s+team|team|everyone|this\s+chat)\s+)?(?:to\s+)?/i, "")
    .replace(/@[a-z0-9_]+/gi, " ")
    .replace(/^\s*remind(?:er)?\s+/i, "")
    .replace(/^\s*(?:and|,)+\s*/i, "")
    .replace(/^\s*(?:for|about|that|to)\s+/i, "")
    .replace(/\b(?:every|each)\s+(?:hour|day|morning|afternoon|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b(?:hourly|daily|weekly|today|tomorrow|tonight|every|each)\b/gi, " ")
    .replace(/\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+\b/g, " ")
    .replace(/\b(?:PST|PDT|PT|MST|MDT|MT|CST|CDT|CT|EST|EDT|ET|UTC|GMT)\b/gi, " ")
    .replace(/^\s*(?:at|on|by|for|about|that|to|do)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "")
    .trim()
}

export function parseReminderRequest(
  value: unknown,
  options: { timeZone?: string; now?: Date } = {},
): ParsedReminderRequest {
  const text = String(value || "").trim()
  const now = options.now && !Number.isNaN(options.now.getTime()) ? options.now : new Date()
  const timeZone = detectExplicitTimeZone(text) || normalizeTimeZone(options.timeZone) || TEAM_TIME_ZONE
  if (!text) return { ok: false, issue: "missing_title" }

  const pipeParts = text.includes("|") ? text.split("|").map((part) => part.trim()) : null
  const reminderText = pipeParts
    ? String(pipeParts[2] || pipeParts[0] || "").trim()
    : naturalReminderText(text, now)
  const dueText = pipeParts ? String(pipeParts[1] || "").trim() : text
  const repeat = pipeParts ? pipeParts[3] : undefined
  const targetUsernames = Array.from(new Set(Array.from(text.matchAll(/@([a-z0-9_]+)/gi)).map((match) => match[1].toLowerCase())))
  const targetMode = targetUsernames.length
    ? "specific" as const
    : /\bremind\s+me\b/i.test(text)
      ? "creator" as const
      : /\bremind\s+(?:us|the\s+team|team|everyone|this\s+chat)\b/i.test(text)
        ? "everyone" as const
        : "unspecified" as const

  if (!reminderText) return { ok: false, issue: "missing_title" }
  if (!dueText || !hasUsableTime(dueText, now)) return { ok: false, issue: "missing_time" }

  const parsedDueAt = parseNaturalTeamDateTime(dueText, timeZone, now)
  if (!parsedDueAt) return { ok: false, issue: "unrecognized_time" }
  const recurrence = reminderRecurrenceFromText(text, repeat)
  const nextDueAt = parsedDueAt.getTime() <= now.getTime() && recurrence !== "none"
    ? nextRecurringDueAt(parsedDueAt.toISOString(), recurrence, timeZone, now)
    : parsedDueAt.toISOString()
  if (!nextDueAt || new Date(nextDueAt).getTime() <= now.getTime()) return { ok: false, issue: "past_time" }

  return {
    ok: true,
    text: reminderText,
    dueAt: nextDueAt,
    timeZone,
    recurrence,
    targetMode,
    targetUsernames,
  }
}

export function reminderRequestError(result: Extract<ParsedReminderRequest, { ok: false }>) {
  if (result.issue === "missing_title") return "What should I remind you about?"
  if (result.issue === "missing_time") return "What time should I use? Try “WWR injection today at 8 PM ET”."
  if (result.issue === "past_time") return "That time has already passed. Send a future time, such as “tomorrow at 8 PM ET”."
  return "I couldn’t understand the date and time. Try “WWR injection today at 8 PM ET” or “in 20 minutes check WWR”."
}
