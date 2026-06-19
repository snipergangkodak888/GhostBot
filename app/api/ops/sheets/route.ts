import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { normalizeSheetValues, parseCsv } from "@/lib/sheet-files"
import { defaultValuesForKind, getSheetSchema, normalizeSheetKind, valuesForKind } from "@/lib/sheet-schemas"

export const dynamic = "force-dynamic"

async function saveSheetRecord(input: {
  title: string
  tabName: string
  category: string
  sheetType: string
  description: string
  projectId: string
  projectName: string
  values: string[][]
  sourceType: "blank" | "csv"
}) {
  const db = await getDb()
  const record = {
    title: input.title,
    tabName: input.tabName,
    category: input.category,
    sheetType: input.sheetType,
    description: input.description || "",
    projectId: input.projectId || "",
    projectName: input.projectName || "",
    values: input.values,
    sourceType: input.sourceType,
    updatedAt: new Date(),
    createdAt: new Date(),
  }

  const result = await db.collection("opsSheets").insertOne(record)
  return { ...record, _id: result.insertedId }
}

export async function GET() {
  const db = await getDb()
  const sheets = await db.collection("opsSheets").find({}).sort({ updatedAt: -1 }).toArray()
  return NextResponse.json({
    sheets,
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "create")

  const requestedType =
    typeof body.sheetType === "string" && body.sheetType.trim()
      ? body.sheetType.trim()
      : typeof body.type === "string"
        ? body.type.trim()
        : typeof body.tag === "string"
          ? body.tag.trim()
          : "custom"
  const sheetType = normalizeSheetKind(requestedType)
  const schema = getSheetSchema(sheetType)
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : schema.title
  const tabName = typeof body.tabName === "string" && body.tabName.trim() ? body.tabName.trim() : schema.tabName
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : schema.category
  const description = String(body.description || "").trim()
  const projectId = String(body.projectId || "").trim()
  const projectName = String(body.projectName || "").trim()
  const values = action === "upload"
    ? valuesForKind(sheetType, parseCsv(String(body.csv || "")))
    : normalizeSheetValues(body.values).length
      ? valuesForKind(sheetType, body.values)
      : defaultValuesForKind(sheetType)

  const record = await saveSheetRecord({
    title,
    tabName,
    category,
    sheetType,
    description,
    projectId,
    projectName,
    values,
    sourceType: action === "upload" ? "csv" : "blank",
  })

  return NextResponse.json({ sheet: record, values })
}
