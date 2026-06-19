import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { formatPayrollSnapshot } from "@/lib/payroll-snapshot"
import { getTelegramBotToken, sendTelegramText } from "@/lib/telegram-bot"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const db = await getDb()
  const [entry, channels, token] = await Promise.all([
    db.collection("dailyPayrollEntries").findOne({ date }),
    db.collection("channels").find({ isActive: true }).toArray(),
    getTelegramBotToken(),
  ])
  if (!entry) return NextResponse.json({ error: "Save this payroll day first" }, { status: 404 })
  if (!token) return NextResponse.json({ error: "Telegram bot token is not configured" }, { status: 400 })
  const destinations = channels
    .filter((channel) => String(channel.chatId || "").trim())
    .map((channel) => ({
      chatId: String(channel.chatId).trim(),
      name: String(channel.name || channel.chatId).trim(),
    }))
  if (!destinations.length) {
    return NextResponse.json(
      { error: "No active channel or group is configured in Admin Panel" },
      { status: 400 },
    )
  }

  const text = formatPayrollSnapshot(entry)
  const results = await Promise.all(destinations.map(async (destination) => ({
    ...destination,
    sent: await sendTelegramText(token, destination.chatId, text),
  })))
  const sent = results.filter((result) => result.sent).length
  if (!sent) return NextResponse.json({ error: "Telegram did not accept the payroll snapshot" }, { status: 502 })
  return NextResponse.json({
    sent,
    destinations: destinations.length,
    failed: results.filter((result) => !result.sent).map((result) => result.name),
  })
}
