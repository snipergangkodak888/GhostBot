import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { ObjectId } from "@/lib/object-id"

export const dynamic = "force-dynamic"

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const update: Record<string, any> = { updatedAt: new Date() }

  for (const key of ["member", "role", "project", "currency", "notes", "date"]) {
    if (typeof body[key] === "string") update[key] = body[key].trim()
  }
  if (body.projectId !== undefined) update.projectId = body.projectId ? String(body.projectId).trim() : null
  if (body.amount !== undefined) update.amount = Number(body.amount || 0)
  if (body.status === "pending" || body.status === "paid") update.status = body.status

  const db = await getDb()
  await db.collection("opsPayroll").updateOne(idFilter(params.id), { $set: update })
  const row = await db.collection("opsPayroll").findOne(idFilter(params.id))
  return NextResponse.json({ row })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const db = await getDb()
  await db.collection("opsPayroll").deleteOne(idFilter(params.id))
  return NextResponse.json({ ok: true })
}
