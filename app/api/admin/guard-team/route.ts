import { NextRequest, NextResponse } from "next/server"
import { createGuardInviteCode, deactivateGuardMember, deleteGuardInviteCode, normalizeTeamAccessRole, updateGuardMemberLaunchDmAccess, updateGuardMemberRole } from "@/lib/team-access"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { getGuardEnrollmentDashboard, grantDiscoveredGuardAccess } from "@/lib/guard-enrollment"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const token = cookies().get("admin_token")?.value
  if (!token) return null
  try { return await verifyAdminToken(token) } catch { return null }
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const db = await getDb()
  const [members, codes, enrollment] = await Promise.all([
    db.collection("guardMembers").find({}).sort({ createdAt: -1 }).toArray(),
    db.collection("guardInviteCodes").find({ status: { $ne: "deleted" } }).sort({ createdAt: -1 }).toArray(),
    getGuardEnrollmentDashboard(),
  ])
  return NextResponse.json({ members, codes, ...enrollment })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

  if (action === "update-member-launch-dm-access") {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Enabled must be true or false" }, { status: 400 })
    const result = await updateGuardMemberLaunchDmAccess(String(body.id || ""), body.enabled, admin.sub)
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
