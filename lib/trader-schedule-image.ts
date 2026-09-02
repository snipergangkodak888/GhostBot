import { existsSync } from "node:fs"
import { minuteToLabel, scheduleWeekStart } from "@/lib/trader-schedule"
import { ensureTraderRoster, getScheduleWeek } from "@/lib/trader-schedule-store"
import type { SchedulePayload, TraderProfile } from "@/lib/trader-schedule-types"

const W = 1600
const LEFT = 160
const RIGHT = 36
const TOP = 118
const DAY_H = 146
const ROW_H = 18
const GRID_W = W - LEFT - RIGHT
const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function daySvg(payload: SchedulePayload, roster: TraderProfile[], weekStart: string, dayIndex: number) {
  const date = new Date(Date.parse(`${weekStart}T12:00:00Z`) + dayIndex * 86_400_000).toISOString().slice(0, 10)
  const y = TOP + dayIndex * DAY_H
  const rows = roster.filter((row) => row.active)
  const gridLines = Array.from({ length: 25 }, (_, hour) => { const x = LEFT + hour / 24 * GRID_W; return `<line x1="${x}" y1="${y + 28}" x2="${x}" y2="${y + DAY_H - 8}" stroke="#243145" stroke-width="1"/>${hour < 24 ? `<text x="${x + GRID_W / 48}" y="${y + 20}" text-anchor="middle" font-size="10" fill="#8090a8">${String(hour).padStart(2, "0")}</text>` : ""}` }).join("")
  const shifts = payload.assignments.filter((row) => row.date === date).map((row) => {
    const traderIndex = rows.findIndex((trader) => trader.id === row.traderId)
    if (traderIndex < 0) return ""
    const trader = rows[traderIndex]
    const x = LEFT + row.startMinute / 1440 * GRID_W
    const width = Math.max(4, (Math.min(1440, row.endMinute) - row.startMinute) / 1440 * GRID_W)
    const sy = y + 30 + traderIndex * ROW_H
    const label = width > 90 ? `${minuteToLabel(row.startMinute).replace(":00", "")}–${minuteToLabel(row.endMinute).replace(":00", "")}` : trader.displayName
    return `<rect x="${x}" y="${sy}" width="${width}" height="${ROW_H - 3}" rx="4" fill="${trader.color}"/><text x="${x + 5}" y="${sy + 11}" font-size="9" font-weight="700" fill="#07101a">${esc(label)}</text>`
  }).join("")
  const labels = rows.map((trader, index) => `<circle cx="${20}" cy="${y + 39 + index * ROW_H}" r="4" fill="${trader.color}"/><text x="31" y="${y + 43 + index * ROW_H}" font-size="11" font-weight="700" fill="#dce6f5">${esc(trader.displayName)}</text>`).join("")
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
  return `<rect x="12" y="${y}" width="${W - 24}" height="${DAY_H - 6}" rx="12" fill="#0d1522" stroke="#1e2b3d"/><text x="20" y="${y + 20}" font-size="13" font-weight="800" fill="#ffffff">${esc(dayLabel)}</text>${gridLines}${labels}${shifts}`
}

export function renderTraderScheduleSvg(weekStart: string, revision: number, payload: SchedulePayload, roster: TraderProfile[]) {
  const height = TOP + 7 * DAY_H + 24
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="100%" height="100%" fill="#05080e"/><rect x="12" y="12" width="${W - 24}" height="82" rx="16" fill="#16243a"/><circle cx="51" cy="53" r="25" fill="#2f80ff"/><text x="51" y="61" text-anchor="middle" font-family="Arial" font-size="25" font-weight="900" fill="#fff">G</text><text x="88" y="47" font-family="Arial" font-size="25" font-weight="900" fill="#fff">Ghost Trader Schedule</text><text x="88" y="70" font-family="Arial" font-size="12" fill="#a7b7cd">Week of ${esc(weekStart)} · Eastern Time · Published revision ${revision}</text><text x="${W - 36}" y="47" text-anchor="end" font-family="Arial" font-size="13" font-weight="700" fill="#80b4ff">24/7 ADMIN COVERAGE</text>${Array.from({ length: 7 }, (_, index) => daySvg(payload, roster, weekStart, index)).join("")}</svg>`
}

export async function renderPublishedTraderSchedulePng(weekStart = scheduleWeekStart()) {
  const [week, roster] = await Promise.all([getScheduleWeek(weekStart), ensureTraderRoster()])
  if (!week.published) throw new Error("No published schedule is available for this week.")
  const svg = renderTraderScheduleSvg(weekStart, week.publishedRevision, week.published, roster)
  const { Resvg } = await import("@resvg/resvg-js")
  const candidates = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].filter(existsSync)
  const resvg = new Resvg(svg, { font: { fontFiles: candidates, defaultFontFamily: "Arial", sansSerifFamily: "Arial" } })
  return { png: Buffer.from(resvg.render().asPng()), week }
}
