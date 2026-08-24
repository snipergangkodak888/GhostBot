import { NextRequest, NextResponse } from "next/server"
import { runOrganicChannelCron } from "@/lib/organic-channel-jobs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const internalExpected = String(process.env.GHOSTBOT_INTERNAL_CRON_KEY || "")
  const internalReceived = String(req.headers.get("x-ghostbot-internal-cron") || "")
  const bearerExpected = String(process.env.CRON_SECRET || "")
  const bearerReceived = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const authorized = (internalExpected && internalReceived === internalExpected)
    || (bearerExpected && bearerReceived === bearerExpected)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const result = await runOrganicChannelCron()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
