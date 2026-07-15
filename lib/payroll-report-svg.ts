import type { PayrollDailyReport } from "@/lib/payroll-daily-report"
import { reportMoney } from "@/lib/payroll-daily-report"

const W = 1500
const PAD = 10
const GAP = 8
const ROW = 24
const HDR = 28
const SUB = 24
const FONT = "Arial, Helvetica, sans-serif"
const FONT_BOLD = "Arial, Helvetica, sans-serif"
const CELL_PAD = 5

const C = {
  black: "#111111",
  white: "#ffffff",
  grid: "#222222",
  green: "#1f8f66",
  greenDark: "#0d5c3f",
  greenLight: "#c8efd9",
  red: "#b53a48",
  redDark: "#8f2f3a",
  redLight: "#ffd9de",
  blue: "#2f6db0",
  incomeTotal: "#1f8f66",
  expenseTotal: "#b53a48",
  typeBlue: "#2f6db0",
  profitBg: "#e8f7ee",
  profitBgMisc: "#eef5fb",
  headerBg: "#2a2a2a",
  thBg: "#e8e8e8",
  thText: "#111111",
  totalBg: "#fafafa",
  titleGreen: "#3ecf8e",
}

function sheetColumns() {
  const contentW = W - PAD * 2
  const colBudget = contentW - GAP * 4
  const team = 218
  const daily = 300
  const misc = 228
  const referrals = 300
  const dist = colBudget - team - daily - misc - referrals
  return { team, daily, misc, referrals, dist, contentW }
}

function columnX(col: ReturnType<typeof sheetColumns>, index: number) {
  const keys = ["team", "daily", "misc", "referrals", "dist"] as const
  let x = PAD
  for (let i = 0; i < index; i += 1) {
    x += col[keys[i]] + GAP
  }
  return x
}

let clipCounter = 0

function nextClipId() {
  clipCounter += 1
  return `clip-${clipCounter}`
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function money(value: number) {
  return `$${reportMoney(value)}`
}

function charWidth(char: string, fontSize: number, mono = false, bold = false) {
  const scale = bold ? 1.06 : 1
  if (mono) return fontSize * 0.62 * scale
  if (/[iIl1.]/.test(char)) return fontSize * 0.34 * scale
  if (/[MW%@]/.test(char)) return fontSize * 0.72 * scale
  if (/[A-Z$]/.test(char)) return fontSize * 0.62 * scale
  return fontSize * 0.52 * scale
}

function textWidth(label: string, fontSize: number, mono = false, bold = false) {
  return Array.from(label).reduce((sum, char) => sum + charWidth(char, fontSize, mono, bold), 0)
}

function truncate(label: string, maxWidth: number, fontSize: number, mono = false, bold = false) {
  const clean = String(label || "")
  if (textWidth(clean, fontSize, mono, bold) <= maxWidth) return clean
  let result = clean
  while (result.length > 1 && textWidth(`${result}…`, fontSize, mono, bold) > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

type TextMode = "truncate" | "fit" | "clip" | "fit-truncate"

type TextOpts = {
  size?: number
  minSize?: number
  weight?: number | string
  fill?: string
  anchor?: "start" | "middle" | "end"
  family?: string
  mono?: boolean
  mode?: TextMode
}

function fitFontSize(label: string, maxWidth: number, maxSize: number, minSize: number, mono = false, bold = false) {
  let size = maxSize
  while (size > minSize && textWidth(label, size, mono, bold) > maxWidth) {
    size -= 0.25
  }
  return size
}

function resolveText(label: string, innerW: number, maxSize: number, minSize: number, mode: TextMode, mono = false, bold = false) {
  if (mode === "clip") {
    return { size: maxSize, value: label }
  }
  if (mode === "fit" || mode === "fit-truncate") {
    const size = fitFontSize(label, innerW, maxSize, minSize, mono, bold)
    if (mode === "fit" || textWidth(label, size, mono, bold) <= innerW) {
      return { size, value: label }
    }
    return { size, value: truncate(label, innerW, size, mono, bold) }
  }
  const size = maxSize
  return { size, value: truncate(label, innerW, size, mono, bold) }
}

function clippedText(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  opts: TextOpts = {},
) {
  const pad = CELL_PAD
  const innerW = Math.max(0, width - pad * 2)
  const mono = opts.mono || opts.family?.includes("Courier") || false
  const bold = Number(opts.weight ?? 400) >= 600
  const mode = opts.mode ?? "fit-truncate"
  const maxSize = opts.size ?? 11
  const minSize = opts.minSize ?? 7
  const { size, value } = resolveText(label, innerW, maxSize, minSize, mode, mono, bold)
  const anchor = opts.anchor ?? "start"
  const tx = anchor === "end" ? x + width - pad : anchor === "middle" ? x + width / 2 : x + pad
  const ty = y + height / 2
  const clipId = nextClipId()
  const family = bold ? FONT_BOLD : (opts.family || FONT)

  return `
    <clipPath id="${clipId}"><rect x="${x + 0.5}" y="${y + 0.5}" width="${Math.max(0, width - 1)}" height="${Math.max(0, height - 1)}"/></clipPath>
    <text clip-path="url(#${clipId})" x="${tx}" y="${ty}" dominant-baseline="middle" font-family="${family}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? C.black}" text-anchor="${anchor}">${esc(value)}</text>
  `
}

function panelTitle(x: number, y: number, w: number, title: string, accent: "green" | "red" | "black" | "blue") {
  const bg = accent === "green" ? C.green : accent === "red" ? C.red : accent === "blue" ? C.blue : C.black
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${HDR}" fill="${bg}" stroke="${C.black}" stroke-width="1.5"/>
    ${clippedText(x, y, w, HDR, title.toUpperCase(), { size: 12, weight: 700, fill: C.white, anchor: "middle", mode: "fit" })}
  `
}

type Cell = { text: string; align?: "left" | "center" | "right"; style?: string; size?: number; bold?: boolean; mode?: TextMode }

type TableOpts = {
  x: number
  y: number
  width: number
  title: string
  accent: "green" | "red" | "black" | "blue"
  headers: string[]
  colWidths: number[]
  rows: Cell[][]
  footer?: { label: string; value: string; tone: "income" | "expense" }
  minRows?: number
}

function drawTable(opts: TableOpts) {
  const parts: string[] = []
  let y = opts.y
  const x = opts.x
  const w = opts.width

  parts.push(panelTitle(x, y, w, opts.title, opts.accent))
  y += HDR

  let cx = x
  opts.headers.forEach((header, index) => {
    const cw = opts.colWidths[index]
    parts.push(`<rect x="${cx}" y="${y}" width="${cw}" height="${SUB}" fill="${C.thBg}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(clippedText(cx, y, cw, SUB, header, { size: 9.5, weight: 700, fill: C.thText, mode: "fit", minSize: 7 }))
    cx += cw
  })
  y += SUB

  const bodyRows = Math.max(opts.rows.length, opts.minRows ?? 0)
  for (let rowIndex = 0; rowIndex < bodyRows; rowIndex += 1) {
    const row = opts.rows[rowIndex]
    cx = x
    for (let colIndex = 0; colIndex < opts.colWidths.length; colIndex += 1) {
      const cw = opts.colWidths[colIndex]
      const cell = row?.[colIndex]
      const fill = cell?.style === "on"
        ? C.greenLight
        : cell?.style === "off"
          ? C.redLight
          : cell?.style === "type"
            ? C.typeBlue
            : C.white
      const textFill = cell?.style === "type" ? C.white : cell?.style === "on" ? "#12784d" : cell?.style === "off" ? "#9c2330" : C.black
      parts.push(`<rect x="${cx}" y="${y}" width="${cw}" height="${ROW}" fill="${fill}" stroke="${C.grid}" stroke-width="1"/>`)
      if (cell) {
        const align = cell.align ?? "left"
        const isMoney = cell.text.startsWith("$")
        const size = cell.size ?? (cell.style === "wallet" ? 8.5 : cell.style === "type" ? 9 : 11)
        parts.push(clippedText(cx, y, cw, ROW, cell.text, {
          size,
          weight: cell.bold || cell.style === "on" || cell.style === "off" || isMoney ? 700 : 500,
          fill: textFill,
          anchor: align === "right" ? "end" : align === "center" ? "middle" : "start",
          family: cell.style === "wallet" ? "Courier New, monospace" : FONT,
          mono: cell.style === "wallet",
          mode: cell.mode ?? "fit-truncate",
          minSize: cell.style === "wallet" ? 6.5 : 7,
        }))
      }
      cx += cw
    }
    y += ROW
  }

  if (opts.footer) {
    const labelW = opts.colWidths.slice(0, -1).reduce((sum, width) => sum + width, 0)
    const valueW = opts.colWidths[opts.colWidths.length - 1]
    const tone = opts.footer.tone === "expense" ? C.expenseTotal : C.incomeTotal
    parts.push(`<rect x="${x}" y="${y}" width="${labelW}" height="${ROW}" fill="${C.totalBg}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(`<rect x="${x + labelW}" y="${y}" width="${valueW}" height="${ROW}" fill="${tone}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(clippedText(x, y, labelW, ROW, opts.footer.label, { size: 11, weight: 700, mode: "fit" }))
    parts.push(clippedText(x + labelW, y, valueW, ROW, opts.footer.value, { size: 11, weight: 700, fill: C.white, anchor: "end", mode: "fit" }))
    y += ROW
  }

  parts.push(`<rect x="${x}" y="${opts.y}" width="${w}" height="${y - opts.y}" fill="none" stroke="${C.black}" stroke-width="2"/>`)
  return { svg: parts.join(""), height: y - opts.y }
}

function profitBlock(
  x: number,
  y: number,
  w: number,
  profit: number,
  shares: PayrollDailyReport["dailyProfitShares"],
  variant: "daily" | "misc",
) {
  const visible = shares.filter((row) => row.amount !== 0 || row.percentage > 0)
  const shareRowH = 19
  const blockH = 36 + visible.length * shareRowH + 10
  const parts: string[] = []
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${blockH}" fill="${variant === "daily" ? C.profitBg : C.profitBgMisc}" stroke="${C.black}" stroke-width="2"/>`)
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${36}" fill="${C.greenDark}" stroke="${C.black}" stroke-width="1"/>`)
  parts.push(clippedText(x, y, w * 0.45, 36, "PROFIT:", { size: 14, weight: 700, fill: C.white, mode: "fit" }))
  parts.push(clippedText(x + w * 0.45, y, w * 0.55, 36, money(profit), { size: 14, weight: 700, fill: C.white, anchor: "end", mode: "fit" }))

  let sy = y + 36
  for (const row of visible) {
    parts.push(clippedText(x, sy, w * 0.68, shareRowH, `${row.name} (${row.percentage}%)`, { size: 10, weight: 600, mode: "fit-truncate" }))
    parts.push(clippedText(x + w * 0.68, sy, w * 0.32, shareRowH, money(row.amount), { size: 10, weight: 700, anchor: "end", mode: "fit" }))
    sy += shareRowH
  }
  return { svg: parts.join(""), height: blockH }
}

function distributionsPanel(x: number, y: number, w: number, report: PayrollDailyReport) {
  const parts: string[] = []
  let cy = y

  parts.push(`<rect x="${x}" y="${cy}" width="${w}" height="${HDR}" fill="${C.black}" stroke="${C.black}" stroke-width="1.5"/>`)
  parts.push(clippedText(x, cy, w, HDR, "DAILY DISTRIBUTIONS", { size: 12, weight: 700, fill: C.white, anchor: "middle", mode: "fit" }))
  cy += HDR

  parts.push(`<rect x="${x}" y="${cy}" width="${w}" height="${SUB}" fill="${C.headerBg}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(x, cy, w, SUB, "WALLETS + AMOUNTS", { size: 10, weight: 700, fill: C.white, anchor: "middle", mode: "fit" }))
  cy += SUB

  const colWidths = [Math.floor(w * 0.24), Math.floor(w * 0.2), w - Math.floor(w * 0.24) - Math.floor(w * 0.2)]
  const headers = ["RECIEVER:", "AMOUNT:", "WALLET / SOURCE"]
  let cx = x
  headers.forEach((header, index) => {
    parts.push(`<rect x="${cx}" y="${cy}" width="${colWidths[index]}" height="${SUB}" fill="${C.thBg}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(clippedText(cx, cy, colWidths[index], SUB, header, { size: 9, weight: 700, fill: C.thText, mode: "fit", minSize: 7 }))
    cx += colWidths[index]
  })
  cy += SUB

  for (const row of report.distributions) {
    cx = x
    const cells: Cell[] = [
      { text: row.receiver, bold: true },
      { text: money(row.amount), align: "right" },
      { text: row.wallet, style: "wallet" },
    ]
    cells.forEach((cell, index) => {
      parts.push(`<rect x="${cx}" y="${cy}" width="${colWidths[index]}" height="${ROW}" fill="${C.white}" stroke="${C.grid}" stroke-width="1"/>`)
      parts.push(clippedText(cx, cy, colWidths[index], ROW, cell.text, {
        size: cell.style === "wallet" ? 8.5 : 11,
        weight: cell.bold || cell.align === "right" ? 700 : 600,
        anchor: cell.align === "right" ? "end" : "start",
        family: cell.style === "wallet" ? "Courier New, monospace" : FONT,
        mono: cell.style === "wallet",
        mode: "fit-truncate",
        minSize: cell.style === "wallet" ? 6.5 : 7,
      }))
      cx += colWidths[index]
    })
    cy += ROW
  }

  const labelW = colWidths[0] + colWidths[1]
  parts.push(`<rect x="${x}" y="${cy}" width="${labelW}" height="${ROW}" fill="${C.black}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(`<rect x="${x + labelW}" y="${cy}" width="${colWidths[2]}" height="${ROW}" fill="${C.black}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(x, cy, labelW, ROW, "TOTAL", { size: 11, weight: 700, fill: C.white, mode: "fit" }))
  parts.push(clippedText(x + labelW, cy, colWidths[2], ROW, money(report.totalDistributed), { size: 11, weight: 700, fill: C.white, anchor: "end", mode: "fit" }))
  cy += ROW

  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${cy - y}" fill="none" stroke="${C.black}" stroke-width="2"/>`)
  return { svg: parts.join(""), height: cy - y }
}

function notesPanel(x: number, y: number, w: number, notes: string) {
  const h = 88
  const parts: string[] = []
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${HDR}" fill="${C.black}" stroke="${C.black}" stroke-width="1.5"/>`)
  parts.push(clippedText(x, y, w, HDR, "NOTES", { size: 12, weight: 700, fill: C.white, anchor: "middle", mode: "fit" }))
  parts.push(`<rect x="${x}" y="${y + HDR}" width="${w}" height="${h - HDR}" fill="${C.white}" stroke="${C.black}" stroke-width="2"/>`)
  if (notes.trim()) {
    parts.push(clippedText(x, y + HDR, w, h - HDR, notes.trim(), { size: 11, fill: "#444", mode: "fit-truncate", minSize: 8 }))
  }
  return { svg: parts.join(""), height: h }
}

function rulesPanel(x: number, y: number, w: number, report: PayrollDailyReport) {
  const parts: string[] = []
  let cy = y

  parts.push(panelTitle(x, cy, w, "Payroll Rules", "blue"))
  cy += HDR

  const topCol = Math.floor(w / 2)
  const headers = ["Day Type", "Recipient"]
  let cx = x
  headers.forEach((header) => {
    parts.push(`<rect x="${cx}" y="${cy}" width="${topCol}" height="${SUB}" fill="${C.thBg}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(clippedText(cx, cy, topCol, SUB, header, { size: 9.5, weight: 700, fill: C.thText, mode: "fit" }))
    cx += topCol
  })
  cy += SUB

  cx = x
  parts.push(`<rect x="${cx}" y="${cy}" width="${topCol}" height="${ROW}" fill="${C.white}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(cx, cy, topCol, ROW, report.rules.dayType, { size: 10, weight: 600, mode: "fit-truncate" }))
  cx += topCol
  parts.push(`<rect x="${cx}" y="${cy}" width="${topCol}" height="${ROW}" fill="${C.white}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(cx, cy, topCol, ROW, report.rules.recipient, { size: 10, weight: 600, mode: "fit-truncate" }))
  cy += ROW

  parts.push(`<rect x="${x}" y="${cy}" width="${w}" height="${SUB}" fill="${C.thBg}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(x, cy, w, SUB, "Amount", { size: 9.5, weight: 700, fill: C.thText, mode: "fit" }))
  cy += SUB

  parts.push(`<rect x="${x}" y="${cy}" width="${w}" height="${ROW + 4}" fill="${C.white}" stroke="${C.grid}" stroke-width="1"/>`)
  parts.push(clippedText(x, cy, w, ROW + 4, report.rules.amount, { size: 9.5, weight: 600, mode: "fit-truncate", minSize: 8, anchor: "middle" }))
  cy += ROW + 4

  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${cy - y}" fill="none" stroke="${C.black}" stroke-width="2"/>`)
  return { svg: parts.join(""), height: cy - y }
}

export function renderPayrollReportSvg(report: PayrollDailyReport) {
  clipCounter = 0
  const col = sheetColumns()
  const xTeam = columnX(col, 0)
  const xDaily = columnX(col, 1)
  const xMisc = columnX(col, 2)
  const xReferrals = columnX(col, 3)
  const xDist = columnX(col, 4)
  const sheetInnerW = col.contentW

  const startY = 54
  const pairedIncomeRows = Math.max(report.dailyIncome.length, report.miscIncome.length, 8)

  const teamTable = drawTable({
    x: xTeam,
    y: startY,
    width: col.team,
    title: "Team — Payroll",
    accent: "red",
    headers: ["MEMBER:", "STATUS:", "EXPENSE:"],
    colWidths: [92, 56, col.team - 148],
    rows: report.teamPayroll.map((row) => [
      { text: row.name, bold: true },
      { text: row.status, align: "center", style: row.status === "ON" ? "on" : "off" },
      { text: money(row.expense), align: "right" },
    ]),
    footer: { label: "TOTAL:", value: money(report.totalPayroll), tone: "expense" },
  })

  const dailyTable = drawTable({
    x: xDaily,
    y: startY,
    width: col.daily,
    title: "Daily — Income",
    accent: "green",
    headers: ["CLIENT:", "TYPE:", "INCOME:"],
    colWidths: [88, 112, col.daily - 200],
    rows: report.dailyIncome.map((row) => [
      { text: row.client, bold: true },
      { text: row.type, align: "center", style: "type" },
      { text: money(row.income), align: "right" },
    ]),
    footer: { label: "TOTAL:", value: money(report.totalDailyIncome), tone: "income" },
    minRows: pairedIncomeRows,
  })

  const miscTable = drawTable({
    x: xMisc,
    y: startY,
    width: col.misc,
    title: "Misc — Income",
    accent: "green",
    headers: ["CLIENT:", "INCOME:"],
    colWidths: [132, col.misc - 132],
    rows: report.miscIncome.map((row) => [
      { text: row.client, bold: true },
      { text: money(row.income), align: "right" },
    ]),
    footer: { label: "TOTAL:", value: money(report.totalMiscIncome), tone: "income" },
    minRows: pairedIncomeRows,
  })

  const profitY = startY + dailyTable.height + GAP
  const dailyProfit = profitBlock(xDaily, profitY, col.daily, report.dailyProfit, report.dailyProfitShares, "daily")
  const miscProfit = profitBlock(xMisc, profitY, col.misc, report.miscProfit, report.miscProfitShares, "misc")

  const referralsTable = drawTable({
    x: xReferrals,
    y: startY,
    width: col.referrals,
    title: "Referrals — Expense",
    accent: "red",
    headers: ["REFERRER / %:", "CLIENT:", "WALLET:", "AMOUNT:"],
    colWidths: [86, 66, 98, col.referrals - 250],
    rows: report.referrals.map((row) => [
      { text: `${row.referrer} / ${row.percentage}%`, bold: true },
      { text: row.client },
      { text: row.wallet, style: "wallet" },
      { text: money(row.amount), align: "right" },
    ]),
    footer: { label: "TOTAL:", value: money(report.totalReferrals), tone: "expense" },
    minRows: 4,
  })

  const distPanel = distributionsPanel(xDist, startY, col.dist, report)

  const incomeColumnHeight = dailyTable.height + GAP + dailyProfit.height

  const mainHeight = Math.max(
    teamTable.height,
    incomeColumnHeight,
    miscTable.height + GAP + miscProfit.height,
    referralsTable.height,
    distPanel.height,
  )

  const footerY = startY + mainHeight + GAP
  const rules = rulesPanel(xTeam, footerY, col.team, report)
  const notes = notesPanel(xDist, footerY, col.dist, report.notes)

  const height = footerY + Math.max(rules.height, notes.height) + PAD
  const borderW = sheetInnerW + 4
  const borderH = height - PAD + 2

  const titleBar = `
    <rect x="${PAD}" y="${PAD}" width="${sheetInnerW - 156}" height="${34}" fill="${C.black}" stroke="${C.black}" stroke-width="1.5"/>
    ${clippedText(PAD + 12, PAD, sheetInnerW - 168, 34, "GHOST DAILY INCOME + EXPENSES", { size: 22, weight: 700, fill: C.titleGreen, mode: "fit" })}
    <rect x="${PAD + sheetInnerW - 156}" y="${PAD}" width="${156}" height="${34}" fill="${C.white}" stroke="${C.black}" stroke-width="1.5"/>
    ${clippedText(PAD + sheetInnerW - 156, PAD, 156, 16, "TODAY'S DATE:", { size: 9, weight: 700, anchor: "middle", mode: "fit" })}
    ${clippedText(PAD + sheetInnerW - 156, PAD + 14, 156, 20, report.displayDate, { size: 16, weight: 700, anchor: "middle", mode: "fit" })}
  `

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" text-rendering="optimizeLegibility">
    <rect width="100%" height="100%" fill="#ececec"/>
    <rect x="${PAD - 2}" y="${PAD - 2}" width="${borderW}" height="${borderH}" fill="${C.white}" stroke="${C.black}" stroke-width="2"/>
    ${titleBar}
    ${teamTable.svg}
    ${dailyTable.svg}
    ${dailyProfit.svg}
    ${miscTable.svg}
    ${miscProfit.svg}
    ${referralsTable.svg}
    ${distPanel.svg}
    ${rules.svg}
    ${notes.svg}
  </svg>`
}

export const PAYROLL_REPORT_WIDTH = W
