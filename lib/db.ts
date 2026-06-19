import { ObjectId } from "./object-id"
import { supabaseConfig, supabaseRest } from "./supabase"

type AnyDoc = Record<string, any>
type Filter = Record<string, any>
type SortSpec = Record<string, 1 | -1>

type StoredRow = {
  collection: string
  id: string
  data: AnyDoc
  created_at?: string
  updated_at?: string
}

const DOCUMENTS_TABLE = "documents"

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value))
}

function normalizeId(value: any): string {
  if (value instanceof ObjectId) return value.toString()
  if (value && typeof value === "object" && typeof value.toHexString === "function") return value.toHexString()
  return String(value)
}

function prepareDoc(doc: AnyDoc) {
  const next = clone(doc)
  next._id = next._id ? normalizeId(next._id) : new ObjectId().toString()
  return next
}

function readPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

function writePath(obj: any, path: string, value: any) {
  const parts = path.split(".")
  let cursor = obj
  for (const part of parts.slice(0, -1)) {
    cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
}

function deletePath(obj: any, path: string) {
  const parts = path.split(".")
  let cursor = obj
  for (const part of parts.slice(0, -1)) {
    cursor = cursor?.[part]
    if (!cursor) return
  }
  delete cursor[parts[parts.length - 1]]
}

function comparable(value: any): any {
  if (value instanceof ObjectId) return value.toString()
  if (value instanceof Date) return value.toISOString()
  return value
}

function valuesEqual(a: any, b: any) {
  const av = comparable(a)
  const bv = comparable(b)
  if (av instanceof Date || bv instanceof Date) return new Date(av).getTime() === new Date(bv).getTime()
  return av === bv || String(av) === String(bv)
}

function matchesOperator(actual: any, op: string, expected: any) {
  const av = comparable(actual)
  const ev = comparable(expected)
  switch (op) {
    case "$eq": return valuesEqual(actual, expected)
    case "$ne": return !valuesEqual(actual, expected)
    case "$gt": return av > ev
    case "$gte": return av >= ev
    case "$lt": return av < ev
    case "$lte": return av <= ev
    case "$in": return Array.isArray(expected) && expected.some((v) => valuesEqual(actual, v))
    case "$nin": return Array.isArray(expected) && !expected.some((v) => valuesEqual(actual, v))
    case "$exists": return expected ? actual !== undefined : actual === undefined
    case "$regex": return new RegExp(expected, "i").test(String(actual ?? ""))
    default: return false
  }
}

function matchesFilter(doc: AnyDoc, filter: Filter = {}): boolean {
  return Object.entries(filter || {}).every(([key, expected]) => {
    if (key === "$or") return Array.isArray(expected) && expected.some((f) => matchesFilter(doc, f))
    if (key === "$and") return Array.isArray(expected) && expected.every((f) => matchesFilter(doc, f))
    if (key === "$nor") return Array.isArray(expected) && !expected.some((f) => matchesFilter(doc, f))

    const actual = readPath(doc, key)
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)) {
      return Object.entries(expected).every(([op, value]) =>
        op.startsWith("$") ? matchesOperator(actual, op, value) : valuesEqual(readPath(actual, op), value)
      )
    }
    return valuesEqual(actual, expected)
  })
}

function applyProjection(doc: AnyDoc, projection?: Record<string, 0 | 1>) {
  if (!projection) return doc
  const entries = Object.entries(projection)
  if (!entries.length) return doc
  const include = entries.some(([, v]) => v === 1)
  const next: AnyDoc = include ? {} : clone(doc)

  for (const [key, value] of entries) {
    if (include && value === 1) writePath(next, key, readPath(doc, key))
    if (!include && value === 0) deletePath(next, key)
  }
  if (include && projection._id !== 0 && doc._id !== undefined) next._id = doc._id
  return next
}

function sortDocs(docs: AnyDoc[], sort?: SortSpec) {
  if (!sort) return docs
  const entries = Object.entries(sort)
  return docs.sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = readPath(a, key)
      const bv = readPath(b, key)
      if (av === bv) continue
      return (av > bv ? 1 : -1) * dir
    }
    return 0
  })
}

function applyUpdate(doc: AnyDoc, update: AnyDoc, isInsert = false) {
  const next = clone(doc)
  const hasOperators = Object.keys(update).some((key) => key.startsWith("$"))

  if (!hasOperators) return { ...next, ...clone(update) }

  for (const [op, changes] of Object.entries(update)) {
    if (op === "$set") Object.entries(changes as AnyDoc).forEach(([k, v]) => writePath(next, k, clone(v)))
    if (op === "$setOnInsert" && isInsert) Object.entries(changes as AnyDoc).forEach(([k, v]) => writePath(next, k, clone(v)))
    if (op === "$unset") Object.keys(changes as AnyDoc).forEach((k) => deletePath(next, k))
    if (op === "$inc") Object.entries(changes as AnyDoc).forEach(([k, v]) => writePath(next, k, Number(readPath(next, k) || 0) + Number(v)))
    if (op === "$push") {
      Object.entries(changes as AnyDoc).forEach(([k, v]) => {
        const current = readPath(next, k)
        writePath(next, k, [...(Array.isArray(current) ? current : []), clone(v)])
      })
    }
  }
  return next
}

function rowToDoc(row: StoredRow) {
  return { ...clone(row.data), _id: row.id }
}

async function fetchRows(collection: string): Promise<StoredRow[]> {
  if (!supabaseConfig.url || (!supabaseConfig.hasServiceRoleKey && !supabaseConfig.hasAnonKey)) {
    return []
  }

  return supabaseRest<StoredRow[]>(
    `${DOCUMENTS_TABLE}?collection=eq.${encodeURIComponent(collection)}&select=collection,id,data,created_at,updated_at`
  )
}

async function upsertDoc(collection: string, doc: AnyDoc) {
  if (!supabaseConfig.url || (!supabaseConfig.hasServiceRoleKey && !supabaseConfig.hasAnonKey)) {
    throw new Error("Supabase is not configured")
  }

  const prepared = prepareDoc(doc)
  await supabaseRest(`${DOCUMENTS_TABLE}?on_conflict=collection,id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      collection,
      id: normalizeId(prepared._id),
      data: prepared,
      updated_at: new Date().toISOString(),
    },
  })
  return prepared
}

class SupabaseCursor {
  private docsPromise: Promise<AnyDoc[]>
  private projection?: Record<string, 0 | 1>
  private sortSpec?: SortSpec
  private limitCount?: number
  private skipCount = 0

  constructor(docsPromise: Promise<AnyDoc[]>) {
    this.docsPromise = docsPromise
  }

  sort(sort: SortSpec) {
    this.sortSpec = sort
    return this
  }

  limit(limit: number) {
    this.limitCount = limit
    return this
  }

  skip(skip: number) {
    this.skipCount = skip
    return this
  }

  project(projection: Record<string, 0 | 1>) {
    this.projection = projection
    return this
  }

  async toArray() {
    let docs = await this.docsPromise
    docs = sortDocs(docs, this.sortSpec)
    if (this.skipCount) docs = docs.slice(this.skipCount)
    if (this.limitCount !== undefined) docs = docs.slice(0, this.limitCount)
    return docs.map((doc) => applyProjection(doc, this.projection))
  }
}

class SupabaseCollection {
  constructor(private readonly name: string) {}

  private async docs(filter: Filter = {}) {
    const rows = await fetchRows(this.name)
    return rows.map(rowToDoc).filter((doc) => matchesFilter(doc, filter))
  }

  find(filter: Filter = {}, options: { projection?: Record<string, 0 | 1> } = {}) {
    const cursor = new SupabaseCursor(this.docs(filter))
    if (options.projection) cursor.project(options.projection)
    return cursor
  }

  async findOne(filter: Filter = {}, options: { projection?: Record<string, 0 | 1>; sort?: SortSpec } = {}) {
    const cursor = new SupabaseCursor(this.docs(filter))
    if (options.sort) cursor.sort(options.sort)
    if (options.projection) cursor.project(options.projection)
    return (await cursor.limit(1).toArray())[0] || null
  }

  async countDocuments(filter: Filter = {}) {
    return (await this.docs(filter)).length
  }

  async estimatedDocumentCount() {
    return this.countDocuments({})
  }

  async insertOne(doc: AnyDoc) {
    const inserted = await upsertDoc(this.name, doc)
    return { acknowledged: true, insertedId: inserted._id }
  }

  async insertMany(docs: AnyDoc[]) {
    const insertedIds: Record<number, string> = {}
    for (let i = 0; i < docs.length; i++) {
      insertedIds[i] = (await upsertDoc(this.name, docs[i]))._id
    }
    return { acknowledged: true, insertedCount: docs.length, insertedIds }
  }

  async updateOne(filter: Filter, update: AnyDoc, options: { upsert?: boolean } = {}) {
    const existing = (await this.docs(filter))[0]
    if (existing) {
      await upsertDoc(this.name, applyUpdate(existing, update))
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedId: null }
    }
    if (options.upsert) {
      const base = Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== "object" || v instanceof ObjectId || v instanceof Date))
      const inserted = await upsertDoc(this.name, applyUpdate(base, update, true))
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: inserted._id }
    }
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: null }
  }

  async updateMany(filter: Filter, update: AnyDoc, options: { upsert?: boolean } = {}) {
    const docs = await this.docs(filter)
    for (const doc of docs) await upsertDoc(this.name, applyUpdate(doc, update))
    if (!docs.length && options.upsert) return this.updateOne(filter, update, options)
    return { acknowledged: true, matchedCount: docs.length, modifiedCount: docs.length }
  }

  async findOneAndUpdate(filter: Filter, update: AnyDoc, options: { upsert?: boolean; returnDocument?: "before" | "after" } = {}) {
    const before = (await this.docs(filter))[0] || null
    if (!before && !options.upsert) return null
    const next = applyUpdate(before || Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== "object")), update, !before)
    const saved = await upsertDoc(this.name, next)
    return options.returnDocument === "before" ? before : saved
  }

  async deleteOne(filter: Filter) {
    const doc = (await this.docs(filter))[0]
    if (!doc) return { acknowledged: true, deletedCount: 0 }
    await supabaseRest(`${DOCUMENTS_TABLE}?collection=eq.${encodeURIComponent(this.name)}&id=eq.${encodeURIComponent(normalizeId(doc._id))}`, { method: "DELETE" })
    return { acknowledged: true, deletedCount: 1 }
  }

  async deleteMany(filter: Filter = {}) {
    const docs = await this.docs(filter)
    for (const doc of docs) {
      await supabaseRest(`${DOCUMENTS_TABLE}?collection=eq.${encodeURIComponent(this.name)}&id=eq.${encodeURIComponent(normalizeId(doc._id))}`, { method: "DELETE" })
    }
    return { acknowledged: true, deletedCount: docs.length }
  }

  async distinct(field: string, filter: Filter = {}) {
    return Array.from(new Set((await this.docs(filter)).map((doc) => readPath(doc, field)).filter((v) => v !== undefined)))
  }

  aggregate(pipeline: AnyDoc[] = []) {
    const docsPromise = this.docs({}).then((docs) => runPipeline(docs, pipeline))
    return new SupabaseCursor(docsPromise)
  }

  async bulkWrite(operations: AnyDoc[]) {
    for (const op of operations) {
      if (op.updateOne) await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert })
      if (op.insertOne) await this.insertOne(op.insertOne.document)
      if (op.deleteOne) await this.deleteOne(op.deleteOne.filter)
    }
    return { acknowledged: true }
  }

  createIndex() {
    return Promise.resolve(`${this.name}_idx`)
  }
}

function runPipeline(initial: AnyDoc[], pipeline: AnyDoc[]) {
  let docs = [...initial]
  for (const stage of pipeline) {
    if (stage.$match) docs = docs.filter((doc) => matchesFilter(doc, stage.$match))
    if (stage.$sort) docs = sortDocs(docs, stage.$sort)
    if (stage.$limit) docs = docs.slice(0, stage.$limit)
    if (stage.$skip) docs = docs.slice(stage.$skip)
    if (stage.$count) docs = [{ [stage.$count]: docs.length }]
    if (stage.$group) docs = groupDocs(docs, stage.$group)
    if (stage.$project) docs = docs.map((doc) => projectAggregationDoc(doc, stage.$project))
  }
  return docs
}

function groupDocs(docs: AnyDoc[], spec: AnyDoc) {
  const groups = new Map<string, AnyDoc>()
  for (const doc of docs) {
    const id = typeof spec._id === "string" && spec._id.startsWith("$") ? readPath(doc, spec._id.slice(1)) : spec._id
    const key = JSON.stringify(id)
    if (!groups.has(key)) groups.set(key, { _id: id })
    const group = groups.get(key)!
    for (const [field, expr] of Object.entries(spec)) {
      if (field === "_id") continue
      if ((expr as AnyDoc).$sum !== undefined) {
        const value = (expr as AnyDoc).$sum
        group[field] = (group[field] || 0) + (typeof value === "number" ? value : Number(readPath(doc, String(value).replace(/^\$/, "")) || 0))
      }
      if ((expr as AnyDoc).$first !== undefined && group[field] === undefined) {
        group[field] = readPath(doc, String((expr as AnyDoc).$first).replace(/^\$/, ""))
      }
    }
  }
  return Array.from(groups.values())
}

function projectAggregationDoc(doc: AnyDoc, spec: AnyDoc) {
  const next: AnyDoc = {}
  for (const [key, value] of Object.entries(spec)) {
    if (value === 1) next[key] = readPath(doc, key)
    else if (value === 0) continue
    else if (typeof value === "string" && value.startsWith("$")) next[key] = readPath(doc, value.slice(1))
    else next[key] = value
  }
  return next
}

class SupabaseDb {
  databaseName = "supabase"

  collection(name: string) {
    return new SupabaseCollection(name)
  }

  async collections() {
    const listed = await this.listCollections()
    const rows = await listed.toArray()
    return rows.map(({ name }) => ({
      collectionName: name,
      find: (filter: Filter = {}) => this.collection(name).find(filter),
    }))
  }

  async createCollection(name: string) {
    return this.collection(name)
  }

  async listCollections() {
    const rows = await supabaseRest<Array<{ collection: string }>>(`${DOCUMENTS_TABLE}?select=collection`)
    const names = Array.from(new Set(rows.map((row) => row.collection)))
    return { toArray: async () => names.map((name) => ({ name })) }
  }
}

export async function getDb() {
  return new SupabaseDb()
}

export async function withDb<T>(fn: (db: SupabaseDb) => Promise<T>) {
  return fn(await getDb())
}

export { ObjectId }
