import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { getMemberTimeZone, saveMemberTimeZone } from "@/lib/team-access"
import { normalizeTimeZone } from "@/lib/team-timezone"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ timeZone: await getMemberTimeZone(user.telegramId) })
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const timeZone = normalizeTimeZone(body.timeZone)
  if (!timeZone) return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
  const result = await saveMemberTimeZone(user.telegramId, timeZone, "mini-app")
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
