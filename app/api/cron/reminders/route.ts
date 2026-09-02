import { NextRequest, NextResponse } from "next/server"
import { runReminderCron } from "@/lib/ops-cron"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

let activeRun: ReturnType<typeof runReminderCron> | null = null

export async function POST(req: NextRequest) {
  const expected = String(process.env.GHOSTBOT_INTERNAL_CRON_KEY || "")
  const received = String(req.headers.get("x-ghostbot-internal-cron") || "")
  if (!expected || received !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  if (activeRun) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_running" }, { status: 202 })
  }

  activeRun = runReminderCron()
  try {
    const result = await activeRun
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } finally {
    activeRun = null
  }
}
