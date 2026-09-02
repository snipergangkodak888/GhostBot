import { addDays, minuteToLabel, scheduleDateKey, scheduleWeekStart, sliceForInstant } from "@/lib/trader-schedule"
import { ensureTraderRoster, getScheduleWeek } from "@/lib/trader-schedule-store"
import type { CoverageSlice, SchedulePayload, ShiftAssignment, TraderProfile } from "@/lib/trader-schedule-types"

function names(ids: string[], roster: Map<string, TraderProfile>) {
  return ids.map((id) => roster.get(id)?.displayName || id).join(" + ") || "None"
}

function assignmentRole(row: ShiftAssignment) {
  const labels = []
  if (row.roles.includes("admin")) labels.push("Admin")
  if (row.roles.includes("lead")) labels.push("Lead")
  else if (row.roles.includes("trading")) labels.push("Trading")
  if (row.roles.includes("launch_support")) labels.push("Launch support")
  if (row.roles.includes("on_call")) labels.push("On call")
  return labels.join(" · ")
}

function dateIndex(weekStart: string, date: string) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${weekStart}T12:00:00Z`)) / 86_400_000)
}

export async function loadPublishedSchedule(date = scheduleDateKey()) {
  const weekStart = scheduleWeekStart(new Date(`${date}T12:00:00-04:00`))
  const [week, rosterRows] = await Promise.all([getScheduleWeek(weekStart), ensureTraderRoster()])
  return { week, payload: week.published, rosterRows, roster: new Map(rosterRows.map((row) => [row.id, row])) }
}

function nextSlice(payload: SchedulePayload, current: CoverageSlice) {
  return payload.coverageSlices?.find((slice) => Date.parse(slice.startAt) >= Date.parse(current.endAt)) || null
}

export async function formatCurrentTraderShift(now = new Date()) {
  const date = scheduleDateKey(now)
  const { week, payload, roster } = await loadPublishedSchedule(date)
  if (!payload) return `No schedule has been published for the week of ${week.weekStart}.`
  const current = sliceForInstant(payload, now)
  if (!current) return `No published shift is active right now.\n\nWeek of ${week.weekStart} · revision ${week.publishedRevision}`
  const next = nextSlice(payload, current)
  const support = current.support.length ? `\nSupport: ${names(current.support, roster)}` : ""
  const nextLine = next ? `\nNext handoff: ${new Date(next.startAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET → ${names(next.active, roster)}` : ""
  return [
    `🟢 On shift now · until ${new Date(current.endAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`,
    "",
    `Admin: ${names(current.admins, roster)}`,
    `Trading: ${names(current.traders, roster)}${support}${nextLine}`,
    `Coverage: ${current.grade === "ideal" ? "Admin covered · paired floor" : current.grade === "solo" ? "Admin covered · solo interval" : "Admin gap"}`,
    "",
    `Published week ${week.weekStart} · r${week.publishedRevision}`,
  ].join("\n")
}

export async function formatTraderShiftDay(date: string) {
  const { week, payload, roster } = await loadPublishedSchedule(date)
  if (!payload) return `No schedule has been published for ${date}.`
  const rows = payload.assignments.filter((row) => row.date === date).sort((a, b) => a.startMinute - b.startMinute)
  if (!rows.length) return `No shifts are scheduled for ${date}.`
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  return [
    `📅 ${label} · ET`,
    "",
    ...rows.map((row) => `${minuteToLabel(row.startMinute)}–${minuteToLabel(row.endMinute)} · ${roster.get(row.traderId)?.displayName || row.traderId}\n   ${assignmentRole(row)}${row.teamNote ? ` · ${row.teamNote}` : ""}`),
    "",
    `Published r${week.publishedRevision}`,
  ].join("\n")
}

export async function formatMyTraderShifts(telegramId: number) {
  const date = scheduleDateKey()
  const { week, payload, rosterRows } = await loadPublishedSchedule(date)
  const trader = rosterRows.find((row) => row.telegramId === telegramId)
  if (!trader) return "Your Telegram account is not linked to a trader profile yet. A manager can link it from the roster."
  if (!payload) return `No schedule has been published for the week of ${week.weekStart}.`
  const todayIndex = dateIndex(week.weekStart, date)
  const rows = payload.assignments.filter((row) => row.traderId === trader.id && dateIndex(week.weekStart, row.date) >= todayIndex).sort((a, b) => rowSort(a, b)).slice(0, 8)
  return [
    `👤 ${trader.displayName} · My shifts`,
    `Week of ${week.weekStart} · ${payload.hoursByTrader?.[trader.id] || 0}h scheduled`,
    "",
    ...(rows.length ? rows.map((row) => `${new Date(`${row.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${minuteToLabel(row.startMinute)}–${minuteToLabel(row.endMinute)}\n${assignmentRole(row)}${row.teamNote ? ` · ${row.teamNote}` : ""}`) : ["No remaining shifts this week."]),
  ].join("\n")
}

function rowSort(a: ShiftAssignment, b: ShiftAssignment) { return a.date.localeCompare(b.date) || a.startMinute - b.startMinute }

export function shiftCommandButtons() {
  return [[
    { text: "Now", callback_data: "shift:now" },
    { text: "Today", callback_data: "shift:today" },
    { text: "Tomorrow", callback_data: "shift:tomorrow" },
  ], [{ text: "Week map", callback_data: "shift:week" }, { text: "My shifts", callback_data: "shift:mine" }]]
}

export function weekDates(weekStart: string) { return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) }
