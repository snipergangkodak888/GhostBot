import { NextRequest, NextResponse } from "next/server"
import { runLaunchScheduleCron } from "@/lib/ops-cron"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const expected = String(process.env.GHOSTBOT_INTERNAL_CRON_KEY || "")
  const received = String(req.headers.get("x-ghostbot-internal-cron") || "")
  if (!expected || received !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const result = await runLaunchScheduleCron()
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
