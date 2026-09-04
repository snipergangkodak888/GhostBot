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

export async function renameProject(projectId: string, requestedName: string, metadata: { telegramId?: number | null; source?: string } = {}) {
  const name = String(requestedName || "").trim().slice(0, 80)
  if (!name || !/[a-z0-9]/i.test(name)) return { ok: false as const, error: "Send a project name with at least one letter or number." }

  const db = await getDb()
  const project = await db.collection("opsProjects").findOne({ _id: projectId })
  if (!project) return { ok: false as const, error: "Project not found." }

  const projects = await db.collection("opsProjects").find({}).toArray()
  const duplicate = projects.find((row: any) => String(row._id) !== String(projectId) && normalize(row.name) === normalize(name))
  if (duplicate) return { ok: false as const, error: `A project named ${duplicate.name} already exists. Choose a unique name instead.` }

  const previousName = String(project.name || "").trim()
  if (previousName === name) return { ok: true as const, project, previousName, changed: false as const }

  const now = new Date()
  await db.collection("opsProjects").updateOne(
    { _id: project._id },
    { $set: { name, projectNameUpdatedAt: now, projectNameUpdatedByTelegramId: metadata.telegramId || null, updatedAt: now } },
  )
  await Promise.all([
    db.collection("opsProjectNotes").updateMany({ projectId: String(project._id) }, { $set: { projectName: name, updatedAt: now } }),
    db.collection("opsSheets").updateMany({ projectId: String(project._id) }, { $set: { projectName: name, updatedAt: now } }),
    db.collection("revenueFeeEvents").updateMany({ projectId: String(project._id) }, { $set: { projectName: name, updatedAt: now.toISOString() } }),
    db.collection("opsPayroll").updateMany({ projectId: String(project._id) }, { $set: { project: name, updatedAt: now } }),
  ])
  await db.collection("opsProjectLifecycleEvents").insertOne({
    projectId: String(project._id),
    projectName: name,
    action: "renamed",
    previousProjectName: previousName,
    source: metadata.source || "manual",
    telegramId: metadata.telegramId || null,
    createdAt: now,
  })

  const renamed = await db.collection("opsProjects").findOne({ _id: project._id })
  return { ok: true as const, project: renamed || { ...project, name, updatedAt: now }, previousName, changed: true as const }
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
