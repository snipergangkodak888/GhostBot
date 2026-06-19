import { NextRequest, NextResponse } from "next/server"
import { createGuardInviteCode, deactivateGuardMember, deleteGuardInviteCode } from "@/lib/team-access"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const db = await getDb()
  const [members, codes] = await Promise.all([
    db.collection("guardMembers").find({}).sort({ createdAt: -1 }).toArray(),
    db.collection("guardInviteCodes").find({ status: { $ne: "deleted" } }).sort({ createdAt: -1 }).toArray(),
  ])
  return NextResponse.json({ members, codes })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "")

  if (action === "create-code") {
    const daysValid = Number(body.daysValid || 7)
    const code = await createGuardInviteCode(Number.isFinite(daysValid) ? daysValid : 7)
    return NextResponse.json({ code })
  }

  if (action === "deactivate-member") {
    const result = await deactivateGuardMember(String(body.id || ""))
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  }

  if (action === "delete-code") {
    const result = await deleteGuardInviteCode(String(body.id || ""))
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

