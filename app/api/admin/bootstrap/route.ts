import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireAdmin() {
  const token = cookies().get("admin_token")?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return NextResponse.json({
    ok: true,
    admin: {
      id: admin.sub || admin.id || "admin",
      email: admin.email || null,
    },
    app: "Ghost Team System",
    module: "operations",
  })
}
