import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { ObjectId } from "@/lib/object-id"
import { normalizeSheetValues, stringifyCsv } from "@/lib/sheet-files"
import { normalizeSheetKind, valuesForKind } from "@/lib/sheet-schemas"

export const dynamic = "force-dynamic"

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

async function findSheet(id: string) {
  const db = await getDb()
  const sheet = await db.collection("opsSheets").findOne(idFilter(id))
  return { db, sheet }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { sheet } = await findSheet(params.id)
  if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  if (searchParams.get("format") === "csv") {
    const csv = stringifyCsv(normalizeSheetValues(sheet.values))
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${String(sheet.title || "sheet").replace(/[^a-z0-9-_]+/gi, "_")}.csv"`,
      },
    })
  }

  return NextResponse.json({ sheet, values: normalizeSheetValues(sheet.values) })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const { db, sheet } = await findSheet(params.id)
  if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 })

  const nextKind = typeof body.sheetType === "string" ? normalizeSheetKind(body.sheetType) : normalizeSheetKind(sheet.sheetType)
  const values = valuesForKind(nextKind, body.values)
  const update: Record<string, any> = {
    tabName: typeof body.tabName === "string" ? body.tabName.trim() : sheet.tabName || "",
    values,
    updatedAt: new Date(),
  }
  if (typeof body.title === "string") update.title = body.title.trim()
  if (typeof body.category === "string") update.category = body.category.trim()
  if (typeof body.sheetType === "string") update.sheetType = body.sheetType.trim()
  if (typeof body.description === "string") update.description = body.description.trim()
  if (typeof body.projectId === "string") update.projectId = body.projectId.trim()
  if (typeof body.projectName === "string") update.projectName = body.projectName.trim()
  await db.collection("opsSheets").updateOne(idFilter(params.id), { $set: update })
  const updated = await db.collection("opsSheets").findOne(idFilter(params.id))
  return NextResponse.json({ sheet: updated, values })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { db, sheet } = await findSheet(params.id)
  if (!sheet) return NextResponse.json({ ok: true })

  await db.collection("opsSheets").deleteOne(idFilter(params.id))
  return NextResponse.json({ ok: true })
}
