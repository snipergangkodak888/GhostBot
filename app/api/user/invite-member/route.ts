import { NextResponse } from "next/server"
import { createGuardInviteCode } from "@/lib/team-access"

export const dynamic = "force-dynamic"

export async function POST() {
  const code = await createGuardInviteCode(7)
  return NextResponse.json({ code })
}
