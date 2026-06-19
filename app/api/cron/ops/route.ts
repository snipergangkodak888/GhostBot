import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { runOpsSuperCron } from "@/lib/ops-cron"

export const dynamic = "force-dynamic"

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

  const result = await runOpsSuperCron()
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
