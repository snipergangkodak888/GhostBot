import { dateKeyInTimeZone, partsInTimeZone, zonedDateTimeToUtc } from "@/lib/team-timezone"
import { SCHEDULE_ROLES, SCHEDULE_TIME_ZONE, type CoverageSlice, type ScheduleIssue, type SchedulePayload, type ScheduleRole, type ShiftAssignment, type TraderProfile } from "@/lib/trader-schedule-types"

const DAY_MS = 86_400_000
const WEEK_MINUTES = 7 * 1_440

export const DEFAULT_TRADERS: TraderProfile[] = [
  { id: "bands", displayName: "Bands", color: "#9B7BE6", canCoverAdmin: true, active: true, targetHoursMin: 32, targetHoursMax: 40, sortOrder: 10 },
  { id: "moo", displayName: "Moo", color: "#F59E42", canCoverAdmin: false, active: true, targetHoursMin: 32, targetHoursMax: 40, sortOrder: 20 },
  { id: "litwick", displayName: "Litwick", color: "#4A90E2", canCoverAdmin: true, active: true, targetHoursMin: 24, targetHoursMax: 32, sortOrder: 30 },
  { id: "ray", displayName: "Ray", color: "#68C17A", canCoverAdmin: false, active: true, targetHoursMin: 32, targetHoursMax: 40, sortOrder: 40 },
  { id: "cazam", displayName: "Cazam", color: "#F2C14E", canCoverAdmin: true, active: true, targetHoursMin: 32, targetHoursMax: 40, sortOrder: 50 },
  { id: "memo", displayName: "Memo", color: "#49C2C7", canCoverAdmin: false, active: true, targetHoursMin: 30, targetHoursMax: 35, sortOrder: 60 },
]

function pad(value: number) { return String(value).padStart(2, "0") }

export function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function scheduleWeekStart(value: Date | string = new Date(), timeZone = SCHEDULE_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = partsInTimeZone(date, timeZone)
  const noon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
  const mondayOffset = (noon.getUTCDay() + 6) % 7
  noon.setUTCDate(noon.getUTCDate() - mondayOffset)
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`
}

export function dateIndexInWeek(weekStart: string, date: string) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${weekStart}T12:00:00Z`)) / DAY_MS)
}

export function minuteToLabel(minute: number) {
  const normalized = ((minute % 1_440) + 1_440) % 1_440
  const hour = Math.floor(normalized / 60)
  const mins = normalized % 60
  const period = hour >= 12 ? "PM" : "AM"
  const displayHour = hour % 12 || 12
  return `${displayHour}:${pad(mins)} ${period}`
}

function localMinuteToUtc(date: string, minute: number, timeZone = SCHEDULE_TIME_ZONE) {
  const extraDays = Math.floor(minute / 1_440)
  const localDate = addDays(date, extraDays)
  const localMinute = ((minute % 1_440) + 1_440) % 1_440
  const [year, month, day] = localDate.split("-").map(Number)
  return zonedDateTimeToUtc(year, month, day, Math.floor(localMinute / 60), localMinute % 60, 0, timeZone)
}

function roles(value: unknown): ScheduleRole[] {
  const values = Array.isArray(value) ? value : []
  return Array.from(new Set(values.filter((role): role is ScheduleRole => SCHEDULE_ROLES.includes(role as ScheduleRole))))
}

export function cleanAssignment(value: Partial<ShiftAssignment>): ShiftAssignment | null {
  const traderId = String(value.traderId || "").trim().toLowerCase()
  const date = String(value.date || "")
  const startMinute = Math.round(Number(value.startMinute))
  const endMinute = Math.round(Number(value.endMinute))
  if (!traderId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null
  return {
    id: String(value.id || crypto.randomUUID()),
    traderId,
    date,
    startMinute,
    endMinute,
    roles: roles(value.roles),
    teamNote: String(value.teamNote || "").trim().slice(0, 240),
    managementNote: String(value.managementNote || "").trim().slice(0, 500),
  }
}

function assignmentAbsoluteRange(weekStart: string, assignment: ShiftAssignment) {
  const dayIndex = dateIndexInWeek(weekStart, assignment.date)
  return { start: dayIndex * 1_440 + assignment.startMinute, end: dayIndex * 1_440 + assignment.endMinute }
}

function rangeLabel(weekStart: string, start: number, end: number) {
  const date = addDays(weekStart, Math.floor(start / 1_440))
  return `${date} ${minuteToLabel(start)}–${minuteToLabel(end)}`
}

export function compileSchedule(weekStart: string, source: SchedulePayload, roster: TraderProfile[], timeZone = SCHEDULE_TIME_ZONE): SchedulePayload {
  const rosterById = new Map(roster.map((trader) => [trader.id, trader]))
  const assignments = (source.assignments || []).map(cleanAssignment).filter(Boolean) as ShiftAssignment[]
  const issues: ScheduleIssue[] = []
  const valid: Array<{ assignment: ShiftAssignment; start: number; end: number }> = []

  for (const assignment of assignments) {
    const range = assignmentAbsoluteRange(weekStart, assignment)
    const profile = rosterById.get(assignment.traderId)
    if (!profile?.active) issues.push({ severity: "error", code: "unknown_trader", message: `Unknown or inactive trader: ${assignment.traderId}`, assignmentId: assignment.id, traderId: assignment.traderId })
    if (range.start < 0 || range.start >= WEEK_MINUTES || range.end <= range.start || range.end > WEEK_MINUTES + 1_440) {
      issues.push({ severity: "error", code: "invalid_time", message: "Shift time is outside this week or ends before it starts.", assignmentId: assignment.id, traderId: assignment.traderId })
      continue
    }
    if (!assignment.roles.length) issues.push({ severity: "error", code: "missing_role", message: "Every shift needs at least one role.", assignmentId: assignment.id, traderId: assignment.traderId })
    if (assignment.roles.includes("admin") && !profile?.canCoverAdmin) issues.push({ severity: "error", code: "admin_ineligible", message: `${profile?.displayName || assignment.traderId} cannot cover admin duty.`, assignmentId: assignment.id, traderId: assignment.traderId })
    if (range.end - range.start > 720) issues.push({ severity: "warning", code: "long_shift", message: `${profile?.displayName || assignment.traderId} is scheduled for more than 12 hours.`, assignmentId: assignment.id, traderId: assignment.traderId })
    valid.push({ assignment, ...range })
  }

  const dayBoundaries = Array.from({ length: 8 }, (_, index) => index * 1_440)
  const boundaries = Array.from(new Set([...dayBoundaries, ...valid.flatMap((row) => [Math.max(0, row.start), Math.min(WEEK_MINUTES, row.end)])])).sort((a, b) => a - b)
  const coverageSlices: CoverageSlice[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const activeRows = valid.filter((row) => row.start < end && row.end > start)
    const admins = Array.from(new Set(activeRows.filter((row) => row.assignment.roles.includes("admin")).map((row) => row.assignment.traderId)))
    const traders = Array.from(new Set(activeRows.filter((row) => row.assignment.roles.some((role) => role === "trading" || role === "lead")).map((row) => row.assignment.traderId)))
    const support = Array.from(new Set(activeRows.filter((row) => row.assignment.roles.some((role) => role === "launch_support" || role === "on_call")).map((row) => row.assignment.traderId)))
    const active = Array.from(new Set([...admins, ...traders, ...support]))
    const grade = admins.length === 0 ? "uncovered" : active.length >= 2 ? "ideal" : "solo"
    const date = addDays(weekStart, Math.floor(start / 1_440))
    const startMinute = start % 1_440
    const endDate = addDays(weekStart, Math.floor(end / 1_440))
    const endMinute = end % 1_440
    coverageSlices.push({
      startMinute: start,
      endMinute: end,
      startAt: localMinuteToUtc(date, startMinute, timeZone).toISOString(),
      endAt: localMinuteToUtc(endDate, endMinute, timeZone).toISOString(),
      admins, traders, support, active, grade,
    })
    if (grade === "uncovered") issues.push({ severity: "error", code: "admin_gap", message: `No admin coverage: ${rangeLabel(weekStart, start, end)}`, date, startMinute, endMinute })
    else if (grade === "solo") issues.push({ severity: "warning", code: "solo_coverage", message: `Admin is working solo: ${rangeLabel(weekStart, start, end)}`, date, startMinute, endMinute })
  }

  for (const trader of roster.filter((row) => row.active)) {
    const own = valid.filter((row) => row.assignment.traderId === trader.id).sort((a, b) => a.start - b.start)
    for (let index = 1; index < own.length; index += 1) {
      if (own[index].start < own[index - 1].end) issues.push({ severity: "warning", code: "overlap", message: `${trader.displayName} has overlapping assignments.`, assignmentId: own[index].assignment.id, traderId: trader.id })
    }
  }

  const hoursByTrader: Record<string, number> = {}
  for (const trader of roster) {
    const intervals = valid.filter((row) => row.assignment.traderId === trader.id).map((row) => [row.start, row.end] as [number, number]).sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const interval of intervals) {
      const last = merged[merged.length - 1]
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
      else merged.push([...interval])
    }
    const hours = merged.reduce((sum, [start, end]) => sum + end - start, 0) / 60
    hoursByTrader[trader.id] = Math.round(hours * 100) / 100
    if (hours > trader.targetHoursMax) issues.push({ severity: "warning", code: "hours_high", message: `${trader.displayName} has ${hours}h, above the ${trader.targetHoursMax}h target.`, traderId: trader.id })
    if (hours > 0 && hours < trader.targetHoursMin) issues.push({ severity: "warning", code: "hours_low", message: `${trader.displayName} has ${hours}h, below the ${trader.targetHoursMin}h target.`, traderId: trader.id })
  }

  return { assignments, coverageSlices, issues, hoursByTrader, compiledAt: new Date().toISOString() }
}

function assignment(id: string, traderId: string, date: string, startMinute: number, endMinute: number, roles: ScheduleRole[], teamNote = ""): ShiftAssignment {
  return { id, traderId, date, startMinute, endMinute, roles, teamNote }
}

export function defaultWeekPayload(weekStart: string): SchedulePayload {
  const rows: ShiftAssignment[] = []
  rows.push(assignment(`${weekStart}-carry`, "litwick", weekStart, 0, 60, ["admin", "trading"], "Sunday carryover"))
  for (let day = 0; day < 5; day += 1) {
    const date = addDays(weekStart, day)
    rows.push(
      assignment(`${date}-bands`, "bands", date, 60, 540, ["admin", "trading"]),
      assignment(`${date}-moo`, "moo", date, 300, 780, ["trading"]),
      assignment(`${date}-litwick`, "litwick", date, 540, 1020, ["admin", "trading"]),
      assignment(`${date}-ray`, "ray", date, 780, 1200, ["trading"]),
      assignment(`${date}-cazam`, "cazam", date, 1020, 1500, ["admin", "trading"]),
      assignment(`${date}-litwick-support`, "litwick", date, 1020, 1200, ["launch_support"], "Launch support and oversight"),
    )
  }
  const saturday = addDays(weekStart, 5)
  const sunday = addDays(weekStart, 6)
  rows.push(
    assignment(`${saturday}-bands`, "bands", saturday, 60, 780, ["admin", "trading"], "Weekend 12-hour shift"),
    assignment(`${saturday}-moo`, "moo", saturday, 780, 1500, ["trading"], "Weekend 12-hour shift"),
    assignment(`${saturday}-cazam`, "cazam", saturday, 780, 1500, ["admin"]),
    assignment(`${sunday}-bands`, "bands", sunday, 60, 780, ["admin", "trading"], "Weekend 12-hour shift"),
    assignment(`${sunday}-moo`, "moo", sunday, 780, 1500, ["trading"], "Weekend 12-hour shift"),
    assignment(`${sunday}-litwick`, "litwick", sunday, 780, 1500, ["admin"]),
  )
  return { assignments: rows }
}

export function sliceForInstant(payload: SchedulePayload | null | undefined, instant = new Date()) {
  return payload?.coverageSlices?.find((slice) => new Date(slice.startAt).getTime() <= instant.getTime() && new Date(slice.endAt).getTime() > instant.getTime()) || null
}

export function scheduleDateKey(instant = new Date()) { return dateKeyInTimeZone(instant, SCHEDULE_TIME_ZONE) }
