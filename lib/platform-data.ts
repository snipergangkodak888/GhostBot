import { getDb } from "./db"

const RESET_PRESERVED_COLLECTIONS = new Set([
  "admins",
  "settings",
])

const PROJECT_ID_KEYS = new Set([
  "projectid",
  "project_id",
  "projectids",
  "project_ids",
  "clientprojectid",
  "client_project_id",
])

const PROJECT_NAME_KEYS = new Set([
  "project",
  "projectname",
  "project_name",
])

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function matchesProjectReference(value: unknown, projectId: string, projectName: string, key = ""): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => matchesProjectReference(item, projectId, projectName, key))
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([childKey, childValue]) =>
      matchesProjectReference(childValue, projectId, projectName, childKey)
    )
  }

  const normalizedKey = normalize(key).replace(/[^a-z0-9_]/g, "")
  const normalizedValue = normalize(value)
  if (!normalizedValue) return false

  if (PROJECT_ID_KEYS.has(normalizedKey) || normalizedKey.endsWith("projectid")) {
    return normalizedValue === normalize(projectId)
  }
  if (PROJECT_NAME_KEYS.has(normalizedKey) || normalizedKey.endsWith("projectname")) {
    return Boolean(projectName) && normalizedValue === normalize(projectName)
  }
  return false
}

export async function deleteProjectCascade(projectId: string, knownProjectName?: string) {
  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  const projectName = String(knownProjectName || project?.name || "").trim()
  const collections = await db.collections()
  const deletedByCollection: Record<string, number> = {}

  for (const collection of collections) {
    const name = collection.collectionName
    const docs = await collection.find({}).toArray()
    let deleted = 0

    for (const doc of docs) {
      const isProjectRecord = name === "opsProjects" && String(doc._id) === projectId
      const isRelated = isProjectRecord || matchesProjectReference(doc, projectId, projectName)
      if (!isRelated) continue
      const result = await db.collection(name).deleteOne({ _id: doc._id })
      deleted += Number(result.deletedCount || 0)
    }

    if (deleted) deletedByCollection[name] = deleted
  }

  return {
    projectId,
    projectName,
    deleted: Object.values(deletedByCollection).reduce((sum, count) => sum + count, 0),
    deletedByCollection,
  }
}

export async function resetPlatformData() {
  const db = await getDb()
  const collections = await db.collections()
  const deletedByCollection: Record<string, number> = {}

  for (const collection of collections) {
    const name = collection.collectionName
    if (RESET_PRESERVED_COLLECTIONS.has(name)) continue
    const result = await db.collection(name).deleteMany({})
    const deleted = Number(result.deletedCount || 0)
    if (deleted) deletedByCollection[name] = deleted
  }

  return {
    preservedCollections: Array.from(RESET_PRESERVED_COLLECTIONS),
    deleted: Object.values(deletedByCollection).reduce((sum, count) => sum + count, 0),
    deletedByCollection,
  }
}

