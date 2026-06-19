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

  for (const key of ["title", "category", "body", "source"]) {
    if (typeof body[key] === "string") update[key] = body[key].trim()
  }

  const db = await getDb()
  await db.collection("opsDocs").updateOne(idFilter(params.id), { $set: update })
  const doc = await db.collection("opsDocs").findOne(idFilter(params.id))
  return NextResponse.json({ doc })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const db = await getDb()
  await db.collection("opsDocs").deleteOne(idFilter(params.id))
  return NextResponse.json({ ok: true })
}
