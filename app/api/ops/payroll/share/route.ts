import { NextResponse } from "next/server"
import { sharePayrollDay, type PayrollShareMode } from "@/lib/payroll-report-share"

export const dynamic = "force-dynamic"

function parseShareMode(value: unknown): PayrollShareMode {
  const mode = String(value || "text").toLowerCase()
  if (mode === "report" || mode === "image" || mode === "png") return "report"
  if (mode === "both") return "both"
  return "text"
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const mode = parseShareMode(body.mode ?? body.format)

  const result = await sharePayrollDay({ date, mode })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    mode: result.mode,
    sent: result.sent,
    destinations: result.destinations,
    failed: result.failed,
  })
}
