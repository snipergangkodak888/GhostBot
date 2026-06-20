import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { resetPlatformData } from "@/lib/platform-data"

export const dynamic = "force-dynamic"

type BackupCollections = Record<string, any[]>

async function requireAdmin() {
  const token = cookies().get("admin_token")?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

function validCollectionName(value: string) {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value)
}

function parseBackupPayload(body: any): BackupCollections {
  const source = body?.format === "ghost-platform-backup"
    ? body.collections
    : body

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Invalid backup payload.")
  }

  const collections: BackupCollections = {}
  for (const [name, docs] of Object.entries(source)) {
    if (!validCollectionName(name)) throw new Error(`Invalid collection name: ${name}`)
    if (!Array.isArray(docs)) throw new Error(`Collection ${name} must contain an array.`)
    collections[name] = docs.map((doc) => {
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error(`Collection ${name} contains an invalid document.`)
      }
      return JSON.parse(JSON.stringify(doc))
    })
  }
  return collections
}

async function readAllCollections(): Promise<BackupCollections> {
  const db = await getDb()
  const collections = await db.collections()
  const result: BackupCollections = {}
  for (const collection of collections) {
    result[collection.collectionName] = await collection.find({}).toArray()
  }
  return result
}

async function replaceAllCollections(collections: BackupCollections) {
  const db = await getDb()
  const existing = await db.collections()

  for (const collection of existing) {
    await db.collection(collection.collectionName).deleteMany({})
  }

  for (const [name, docs] of Object.entries(collections)) {
    if (docs.length) await db.collection(name).insertMany(docs)
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const collections = await readAllCollections()
    const documentCount = Object.values(collections).reduce((sum, docs) => sum + docs.length, 0)
    const payload = {
      format: "ghost-platform-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      summary: {
        collections: Object.keys(collections).length,
        documents: documentCount,
      },
      collections,
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ghost_platform_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json"`,
      },
    })
  } catch (error: any) {
    console.error("Backup export error:", error)
    return NextResponse.json({ error: error?.message || "Failed to export backup" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const imported = parseBackupPayload(await req.json())
    const previous = await readAllCollections()

    try {
      await replaceAllCollections(imported)
    } catch (restoreError) {
      await replaceAllCollections(previous).catch((rollbackError) => {
        console.error("Backup rollback failed:", rollbackError)
      })
      throw restoreError
    }

    const documentCount = Object.values(imported).reduce((sum, docs) => sum + docs.length, 0)
    return NextResponse.json({
      success: true,
      message: "Full platform backup restored.",
      collections: Object.keys(imported).length,
      documents: documentCount,
    })
  } catch (error: any) {
    console.error("Backup import error:", error)
    return NextResponse.json({ error: error?.message || "Failed to import backup" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (body?.confirmation !== "RESET PLATFORM DATA") {
    return NextResponse.json({ error: "Confirmation phrase did not match." }, { status: 400 })
  }

  try {
    const result = await resetPlatformData()
    return NextResponse.json({
      success: true,
      message: "Platform data reset completed. Admin accounts and settings were preserved.",
      ...result,
    })
  } catch (error: any) {
    console.error("Platform reset error:", error)
    return NextResponse.json({ error: error?.message || "Failed to reset platform data" }, { status: 500 })
  }
}
