import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const db = await getDb()
  const projectId = new URL(req.url).searchParams.get("projectId")
  const filter = projectId ? { projectId } : {}
  const notes = await db.collection("opsProjectNotes").find(filter).sort({ createdAt: -1 }).limit(200).toArray()
  return NextResponse.json({ notes })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const text = String(body.text || "").trim()
  const projectId = String(body.projectId || "").trim()
  if (!text) return NextResponse.json({ error: "Note is required" }, { status: 400 })
  if (!projectId) return NextResponse.json({ error: "Project is required" }, { status: 400 })

  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  if (!project) return NextResponse.json({ error: "Project was not found" }, { status: 404 })

  const user = await requireUser().catch(() => null)
  const authorName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || (user.username ? `@${user.username}` : "Team member")
    : String(body.authorName || "Team member").trim().slice(0, 80) || "Team member"
  const now = new Date()
  const note = {
    text,
    projectId,
    projectName: project.name,
    authorName,
    authorTelegramId: user?.telegramId || null,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection("opsProjectNotes").insertOne(note)
  return NextResponse.json({ note: { ...note, _id: result.insertedId } })
}
