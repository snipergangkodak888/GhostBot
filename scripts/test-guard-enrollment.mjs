#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import Module from "node:module"
import ts from "typescript"

const rows = new Map()
let nextId = 1
const valuesEqual = (left, right) => String(left) === String(right)
const matches = (row, query = {}) => Object.entries(query).every(([key, expected]) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$ne" in expected) return !valuesEqual(row?.[key], expected.$ne)
  }
  return valuesEqual(row?.[key], expected)
})
const sortRows = (items, sort = {}) => {
  const [key, direction] = Object.entries(sort)[0] || []
  if (!key) return items
  return [...items].sort((left, right) => {
    const a = new Date(left?.[key] || 0).getTime() || String(left?.[key] || "").localeCompare(String(right?.[key] || ""))
    const b = new Date(right?.[key] || 0).getTime() || String(right?.[key] || "").localeCompare(String(left?.[key] || ""))
    return (a > b ? 1 : a < b ? -1 : 0) * Number(direction || 1)
  })
}
const applyUpdate = (document, update) => {
  Object.assign(document, update.$set || {})
  for (const key of Object.keys(update.$unset || {})) delete document[key]
  for (const [key, amount] of Object.entries(update.$inc || {})) document[key] = Number(document[key] || 0) + Number(amount)
}
const memoryDb = {
  collection(name) {
    if (!rows.has(name)) rows.set(name, [])
    const collection = rows.get(name)
    return {
      find(query = {}) {
        let found = collection.filter((row) => matches(row, query))
        return {
          sort(sort) {
            found = sortRows(found, sort)
            return this
          },
          async toArray() { return found },
        }
      },
      async findOne(query = {}, options = {}) {
        const found = collection.filter((row) => matches(row, query))
        return (options.sort ? sortRows(found, options.sort) : found)[0] || null
      },
      async insertOne(document) {
        const saved = { ...document, _id: document._id || `${name}-${nextId++}` }
        collection.push(saved)
        return { insertedId: saved._id }
      },
      async updateOne(query, update, options = {}) {
        let document = collection.find((row) => matches(row, query))
        if (!document && options.upsert) {
          document = { ...query, ...(update.$setOnInsert || {}), _id: query._id || `${name}-${nextId++}` }
          collection.push(document)
        }
        if (document) applyUpdate(document, update)
        return { matchedCount: document ? 1 : 0, modifiedCount: document ? 1 : 0 }
      },
      async updateMany(query, update) {
        const found = collection.filter((row) => matches(row, query))
        for (const document of found) applyUpdate(document, update)
        return { matchedCount: found.length, modifiedCount: found.length }
      },
      async countDocuments(query = {}) { return collection.filter((row) => matches(row, query)).length },
    }
  },
}

const telegramMembers = new Map()
const administratorRows = [
  { status: "creator", user: { id: 11, first_name: "Team", last_name: "Owner", username: "owner" } },
  { status: "administrator", user: { id: 12, first_name: "Ops", username: "ops_admin" } },
]
const telegramApiJson = async (_token, method, payload) => {
  if (method === "getChatAdministrators") return { ok: true, result: administratorRows }
  if (method === "getChatMemberCount") return { ok: true, result: 8 }
  if (method === "getChatMember") {
    return { ok: true, result: telegramMembers.get(Number(payload.user_id)) || { status: "left", user: { id: Number(payload.user_id) } } }
  }
  throw new Error(`Unexpected Telegram method: ${method}`)
}

const path = "lib/guard-enrollment.ts"
const source = fs.readFileSync(path, "utf8")
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const loaded = new Module(path)
const originalLoad = loaded.require.bind(loaded)
loaded.require = (id) => {
  if (id === "@/lib/db") return { getDb: async () => memoryDb }
  if (id === "@/lib/telegram-bot") return { telegramApiJson }
  if (id === "@/lib/team-access") return { normalizeTeamAccessRole: (role) => role === "admin" ? "admin" : "member" }
  return originalLoad(id)
}
loaded._compile(code, path)
const guard = loaded.exports

await memoryDb.collection("opsChatProfiles").insertOne({ chatId: "-1001", title: "Launch Chat", profile: "launch", status: "active" })

const link = await guard.createGuardEnrollmentLink({ chatId: -1001, chatTitle: "Launch Chat", chatType: "supergroup", profile: "launch", telegramId: 11 })
assert.equal(guard.guardEnrollmentTokenFromText(`/start ${guard.guardEnrollmentStartParameter(link.token)}`), link.token)
assert.match(guard.guardEnrollmentUrl("@ghost_test_bot", link.token), /^https:\/\/t\.me\/ghost_test_bot\?start=guard_/)
assert.ok(guard.guardEnrollmentStartParameter(link.token).length <= 64)
const reused = await guard.createGuardEnrollmentLink({ chatId: -1001, profile: "launch", telegramId: 11 })
assert.equal(reused.token, link.token)

const synced = await guard.syncTelegramChatAdministrators({ token: "test", chat: { id: -1001, title: "Launch Chat", type: "supergroup" } })
assert.deepEqual(synced, { administrators: 2, memberCount: 8 })
assert.equal(rows.get("guardMembers")?.length || 0, 0, "Telegram administrators must not be auto-promoted to Guard admin")
assert.equal(rows.get("guardChatMembers").length, 2)
await guard.recordGuardChatMember({ chat: { id: -1001, title: "Launch Chat" }, member: { status: "member", user: administratorRows[0].user }, source: "message_seen" })
assert.equal(rows.get("guardChatMembers").find((row) => row.telegramId === 11).isTelegramAdmin, true, "Seeing an admin message must not downgrade their Telegram status")

telegramMembers.set(20, { status: "member", user: { id: 20, first_name: "Launch", last_name: "Member", username: "launch_member" } })
const redeemed = await guard.verifyAndRedeemGuardEnrollment({
  text: `/start ${guard.guardEnrollmentStartParameter(link.token)}`,
  telegramId: 20,
  user: telegramMembers.get(20).user,
  token: "test",
})
assert.equal(redeemed.ok, true)
assert.equal(redeemed.accessRole, "member")
assert.equal(rows.get("guardMembers").find((row) => row.telegramId === 20).enrollmentManaged, true)
assert.equal(rows.get("users").find((row) => row.telegramId === 20).guardAccess, "active")

const redeemedAgain = await guard.verifyAndRedeemGuardEnrollment({ text: guard.guardEnrollmentStartParameter(link.token), telegramId: 20, user: telegramMembers.get(20).user, token: "test" })
assert.equal(redeemedAgain.ok, true)
assert.equal(rows.get("guardMembers").filter((row) => row.telegramId === 20).length, 1)

const outsider = await guard.verifyAndRedeemGuardEnrollment({ text: guard.guardEnrollmentStartParameter(link.token), telegramId: 99, user: { id: 99 }, token: "test" })
assert.equal(outsider.ok, false)
assert.match(outsider.error, /join the configured/i)

const rotated = await guard.createGuardEnrollmentLink({ chatId: -1001, profile: "launch", telegramId: 11, rotate: true })
assert.notEqual(rotated.token, link.token)
const oldLink = await guard.verifyAndRedeemGuardEnrollment({ text: guard.guardEnrollmentStartParameter(link.token), telegramId: 20, user: telegramMembers.get(20).user, token: "test" })
assert.equal(oldLink.ok, false)
assert.match(oldLink.error, /invalid or revoked/i)

await guard.revokeGuardEnrollmentLinks(-1001, 11)
const revoked = await guard.verifyAndRedeemGuardEnrollment({ text: guard.guardEnrollmentStartParameter(rotated.token), telegramId: 20, user: telegramMembers.get(20).user, token: "test" })
assert.equal(revoked.ok, false)

const joined = await guard.handleGuardChatMemberUpdate({ chat: { id: -1001, title: "Launch Chat", type: "supergroup" }, new_chat_member: { status: "administrator", user: { id: 30, first_name: "New", username: "new_admin" } } })
assert.equal(joined.activated, true)
assert.equal(rows.get("guardMembers").find((row) => row.telegramId === 30).accessRole, "member", "Telegram admin status must not grant Guard admin")
await guard.handleGuardChatMemberUpdate({ chat: { id: -1001, title: "Launch Chat", type: "supergroup" }, new_chat_member: { status: "left", user: { id: 30, first_name: "New" } } })
assert.equal(rows.get("guardMembers").find((row) => row.telegramId === 30).status, "inactive")

const granted = await guard.grantDiscoveredGuardAccess(11, "admin")
assert.equal(granted.ok, true)
assert.equal(rows.get("guardMembers").find((row) => row.telegramId === 11).enrollmentManaged, false)
await guard.handleGuardChatMemberUpdate({ chat: { id: -1001, title: "Launch Chat", type: "supergroup" }, new_chat_member: { status: "left", user: administratorRows[0].user } })
assert.equal(rows.get("guardMembers").find((row) => row.telegramId === 11).status, "active", "Manually managed access must survive leaving a chat")

const botRemoved = await guard.handleGuardBotMembershipUpdate({ chat: { id: -1001 }, new_chat_member: { status: "left", user: { id: 999, is_bot: true } } })
assert.equal(botRemoved.active, false)
assert.equal(rows.get("opsChatProfiles")[0].status, "inactive")
await guard.handleGuardBotMembershipUpdate({ chat: { id: -1001 }, new_chat_member: { status: "administrator", user: { id: 999, is_bot: true } } })
assert.equal(rows.get("opsChatProfiles")[0].status, "active")

const dashboard = await guard.getGuardEnrollmentDashboard()
assert.equal(dashboard.groups.length, 1)
assert.equal(dashboard.groups[0].telegramMemberCount, 8)
assert.ok(dashboard.groups[0].discoveredCount >= dashboard.groups[0].enrolledCount)
assert.equal(dashboard.discoveredMembers.find((member) => member.telegramId === 11).accessRole, "admin")

console.log("Guard group enrollment, Telegram membership, and dashboard tests passed")
