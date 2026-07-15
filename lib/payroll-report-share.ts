import { getDb } from "@/lib/db"
import { loadDailyPayrollReport } from "@/lib/payroll-daily-report"
import { renderPayrollReportPng } from "@/lib/payroll-report-image"
import { formatPayrollSnapshot } from "@/lib/payroll-snapshot"
import { getTelegramBotToken, sendTelegramPhoto, sendTelegramText } from "@/lib/telegram-bot"

export type PayrollShareMode = "text" | "report" | "both"

type ShareDestination = {
  chatId: string
  name: string
}

export async function listActivePayrollShareDestinations(): Promise<ShareDestination[]> {
  const db = await getDb()
  const channels = await db.collection("channels").find({ isActive: true }).toArray()
  return channels
    .filter((channel) => String(channel.chatId || "").trim())
    .map((channel) => ({
      chatId: String(channel.chatId).trim(),
      name: String(channel.name || channel.chatId).trim(),
    }))
}

export async function sharePayrollDay(params: {
  date: string
  mode: PayrollShareMode
}) {
  const date = String(params.date || "").slice(0, 10)
  const mode = params.mode
  const db = await getDb()
  const [entry, destinations, token] = await Promise.all([
    db.collection("dailyPayrollEntries").findOne({ date }),
    listActivePayrollShareDestinations(),
    getTelegramBotToken(),
  ])

  if (!entry) {
    return { ok: false as const, status: 404, error: "Save this payroll day first" }
  }
  if (!token) {
    return { ok: false as const, status: 400, error: "Telegram bot token is not configured" }
  }
  if (!destinations.length) {
    return {
      ok: false as const,
      status: 400,
      error: "No active channel or group is configured in Admin Panel",
    }
  }

  let report: Awaited<ReturnType<typeof loadDailyPayrollReport>> | null = null
  let png: Buffer | null = null
  if (mode === "report" || mode === "both") {
    report = await loadDailyPayrollReport(date)
    if (!report) {
      return { ok: false as const, status: 404, error: "No payroll report available for that date" }
    }
    png = await renderPayrollReportPng(report)
  }

  const text = mode === "text" || mode === "both" ? formatPayrollSnapshot(entry) : ""
  const caption = report ? `GHOST DAILY INCOME + EXPENSES · ${report.displayDate}` : ""

  const results = await Promise.all(
    destinations.map(async (destination) => {
      let sentText = false
      let sentReport = false

      if (png) {
        sentReport = await sendTelegramPhoto(token, destination.chatId, png, caption)
      }
      if (text) {
        sentText = await sendTelegramText(token, destination.chatId, text)
      }

      return {
        ...destination,
        sent: mode === "both" ? sentReport && sentText : mode === "report" ? sentReport : sentText,
        sentText,
        sentReport,
      }
    }),
  )

  const sent = results.filter((result) => result.sent).length
  if (!sent) {
    return { ok: false as const, status: 502, error: "Telegram did not accept the payroll share" }
  }

  return {
    ok: true as const,
    mode,
    sent,
    destinations: destinations.length,
    failed: results.filter((result) => !result.sent).map((result) => result.name),
  }
}
