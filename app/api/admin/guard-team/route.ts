import { NextRequest, NextResponse } from "next/server"
import { createGuardInviteCode, deactivateGuardMember, deleteGuardInviteCode, normalizeTeamAccessRole, updateGuardMemberRole } from "@/lib/team-access"
import { getDb } from "@/lib/db"
import { getGuardEnrollmentDashboard, grantDiscoveredGuardAccess } from "@/lib/guard-enrollment"

export const dynamic = "force-dynamic"

export async function GET() {
  const db = await getDb()
  const [members, codes, enrollment] = await Promise.all([
    db.collection("guardMembers").find({}).sort({ createdAt: -1 }).toArray(),
    db.collection("guardInviteCodes").find({ status: { $ne: "deleted" } }).sort({ createdAt: -1 }).toArray(),
    getGuardEnrollmentDashboard(),
  ])
  return NextResponse.json({ members, codes, ...enrollment })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "")

  if (action === "create-code") {
    const daysValid = Number(body.daysValid || 7)
    const code = await createGuardInviteCode(Number.isFinite(daysValid) ? daysValid : 7, normalizeTeamAccessRole(body.accessRole))
    return NextResponse.json({ code })
  }

  if (action === "update-member-role") {
    const result = await updateGuardMemberRole(String(body.id || ""), normalizeTeamAccessRole(body.accessRole))
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  }

  if (action === "grant-discovered-access") {
    const result = await grantDiscoveredGuardAccess(Number(body.telegramId), normalizeTeamAccessRole(body.accessRole))
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
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
