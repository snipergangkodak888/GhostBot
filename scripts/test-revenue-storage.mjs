import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import ts from "typescript"

// Model Supabase's response cap, so tests cover records outside the first page.
const rows = Array.from({ length: 2301 }, (_, index) => ({ collection: "revenueReceipts", id: String(index).padStart(24, "0"), data: { _id: String(index).padStart(24, "0"), eventKey: `event-${index}`, date: index > 2000 ? "2026-09-16" : "2026-09-15", chain: index % 2 ? "arc" : "solana", status: "unclassified" } }))
rows.push(...Array.from({ length: 2301 }, (_, index) => ({ collection: "quicknodeWebhookDeliveries", id: String(index).padStart(24, "0"), data: { nonce: `nonce-${index}`, walletRole: "revenue" } })))
const calls = []
class ObjectId {
  constructor(value) { this.value = value || "f".repeat(24) }
  toString() { return this.value }
}
async function rest(path, options = {}) {
  calls.push({ path, options })
  const url = new URL(path, "https://test.invalid/")
  if (options.method === "POST") {
    const row = options.body
    const index = rows.findIndex((item) => item.collection === row.collection && item.id === row.id)
    if (index >= 0 && options.headers?.Prefer.includes("ignore-duplicates")) return []
    if (index >= 0) rows[index] = structuredClone(row)
    else rows.push(structuredClone(row))
    return [row]
  }
  const filtered = rows.filter((row) => [...url.searchParams].every(([column, expression]) => {
    if (["select", "order", "limit"].includes(column)) return true
    const value = column.startsWith("data->>") ? row.data[column.slice(7)] : row[column]
    if (expression.startsWith("eq.")) return String(value) === expression.slice(3)
    if (expression.startsWith("gt.")) return String(value) > expression.slice(3)
    throw new Error(`Unsupported test predicate: ${column} ${expression}`)
  }))
  if (url.searchParams.get("order") === "id.asc") filtered.sort((a, b) => a.id.localeCompare(b.id))
  return structuredClone(filtered.slice(0, Math.min(1000, Number(url.searchParams.get("limit") || 1000))))
}
const module = { exports: {} }
const code = ts.transpileModule(fs.readFileSync("lib/db.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(`(function(exports, require, module) {${code}\n})(module.exports, require, module)`, { module, URLSearchParams, require: (id) => {
  if (id === "./object-id") return { ObjectId }
  if (id === "./supabase") return { supabaseConfig: { url: "https://test.invalid", hasServiceRoleKey: true }, supabaseRest: rest }
  throw new Error(`Unexpected import ${id}`)
} })
const db = await module.exports.getDb()
const receipts = db.collection("revenueReceipts")
assert.equal((await receipts.findOne({ eventKey: "event-2300" }))._id, "2300".padStart(24, "0"))
assert.equal(calls.length, 1)
assert.ok(calls[0].path.includes("data-%3E%3EeventKey=eq.event-2300"))
assert.equal((await db.collection("quicknodeWebhookDeliveries").findOne({ nonce: "nonce-2300", walletRole: "revenue" })).nonce, "nonce-2300")
assert.equal((await receipts.find({ date: "2026-09-16", chain: "arc" }).toArray()).length, 150)
const before = calls.length
assert.equal((await receipts.find({}).toArray()).length, 2301)
assert.equal(calls.length - before, 5)
assert.equal((await receipts.find({ $or: [{ eventKey: "event-1300" }, { eventKey: "event-2300" }] }).toArray()).length, 2)
await receipts.updateOne({ _id: "2300".padStart(24, "0") }, { $set: { status: "allocated" } })
assert.equal((await receipts.findOne({ eventKey: "event-2300" })).status, "allocated")
const inserted = await receipts.insertOneIfAbsent({ _id: "new-receipt", eventKey: "new-event", status: "allocated", allocations: [{ feeEventId: "fee-1" }] })
const repeated = await receipts.insertOneIfAbsent({ _id: "new-receipt", eventKey: "new-event", status: "unclassified", allocations: [] })
assert.equal(inserted.inserted, true)
assert.equal(repeated.inserted, false)
assert.equal((await receipts.findOne({ _id: "new-receipt" })).status, "allocated")
assert.equal((await receipts.findOne({ _id: "new-receipt" })).allocations.length, 1)
console.log("PASS: revenue server-side lookups, keyset pagination beyond 1,000 records, late-record updates, delivery nonce lookup and insert-only duplicate protection.")
