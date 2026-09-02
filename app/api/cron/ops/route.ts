import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { runOpsSuperCron } from "@/lib/ops-cron"

export const dynamic = "force-dynamic"

let activeRun: ReturnType<typeof runOpsSuperCron> | null = null

async function adminAllowed() {
  const token = cookies().get("admin_token")?.value
  if (!token) return false
  try {
    await verifyAdminToken(token)
    return true
  } catch {
    return false
  }
}

async function cronAllowed(req: NextRequest) {
  if (req.headers.get("x-admin-trigger") === "true") return true
  if (await adminAllowed()) return true

  const db = await getDb()
  const row = await db.collection("settings").findOne({ key: "cronSecret" }).catch(() => null)
  const secret = String(row?.value || "").trim()
  if (!secret) return true

  const querySecret = req.nextUrl.searchParams.get("secret") || ""
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  return querySecret === secret || bearer === secret
}

async function run(req: NextRequest) {
  if (!(await cronAllowed(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized cron request" }, { status: 401 })
  }

  if (activeRun) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_running" }, { status: 202 })
  }

  activeRun = runOpsSuperCron()
  try {
    const result = await activeRun
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } finally {
    activeRun = null
  }
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
