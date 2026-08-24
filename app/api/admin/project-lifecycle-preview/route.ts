import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { launchLifecycleMigrationPreview } from "@/lib/project-lifecycle"

export const dynamic = "force-dynamic"

export async function GET() {
  const token = cookies().get("admin_token")?.value
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await verifyAdminToken(token)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = await getDb()
  const projects = await db.collection("opsProjects").find({}).toArray()
  const preview = launchLifecycleMigrationPreview(projects)
  return NextResponse.json({
    dryRun: true,
    projectCount: preview.length,
    changeCount: preview.filter((row) => row.changed).length,
    changes: preview.filter((row) => row.changed),
    unchanged: preview.filter((row) => !row.changed),
  })
}
