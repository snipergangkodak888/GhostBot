#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import Module from "node:module"
import ts from "typescript"

const rows = new Map()
let nextId = 1
const matches = (row, query) => Object.entries(query).every(([key, value]) => String(row?.[key]) === String(value))
const memoryDb = {
  collection(name) {
    if (!rows.has(name)) rows.set(name, [])
    const collection = rows.get(name)
    return {
      findOne: async (query) => collection.find((row) => matches(row, query)) || null,
      insertOne: async (document) => {
        const saved = { ...document, _id: document._id || `${name}-${nextId++}` }
        collection.push(saved)
        return { insertedId: saved._id }
      },
      updateOne: async (query, update, options = {}) => {
        let document = collection.find((row) => matches(row, query))
        if (!document && options.upsert) {
          document = { ...query, ...(update.$setOnInsert || {}), _id: `${name}-${nextId++}` }
          collection.push(document)
        }
        if (document) Object.assign(document, update.$set || {})
        return { matchedCount: document ? 1 : 0 }
      },
    }
  },
}

const path = "lib/team-access.ts"
const source = fs.readFileSync(path, "utf8")
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const loaded = new Module(path)
const originalLoad = loaded.require.bind(loaded)
loaded.require = (id) => {
  if (id === "@/lib/db") return { getDb: async () => memoryDb }
  if (id === "@/lib/team-timezone") return { normalizeTimeZone: (value) => String(value || "") }
  return originalLoad(id)
}
loaded._compile(code, path)
const guard = loaded.exports

const invite = await guard.createGuardInviteCode(7, "admin")
assert.match(invite.code, /^GHOST-[A-F0-9]{8}$/)
assert.equal(invite.accessRole, "admin")

const link = new URL(`https://t.me/ghost_test_bot?start=${invite.code}`)
const startParameter = link.searchParams.get("start")
assert.equal(guard.guardCodeFromText(`/start ${startParameter}`), invite.code)
assert.equal(guard.guardCodeFromText(`/start@ghost_test_bot ${startParameter}`), invite.code)
assert.equal(guard.guardCodeFromText(invite.code.toLowerCase()), invite.code)

const redeemed = await guard.redeemGuardInviteCode({
  code: guard.guardCodeFromText(`/start ${startParameter}`),
  telegramId: 123456,
  profile: { firstName: "Guard", username: "guard_test" },
  source: "bot",
})
assert.equal(redeemed.ok, true)
assert.equal(rows.get("guardMembers")[0].accessRole, "admin")
assert.equal(rows.get("guardMembers")[0].status, "active")
assert.equal(rows.get("users")[0].guardAccess, "active")
assert.equal(rows.get("guardInviteCodes")[0].usedFrom, "bot")

const memberId = rows.get("guardMembers")[0]._id
const roleUpdate = await guard.updateGuardMemberRole(memberId, "member")
assert.equal(roleUpdate.ok, true)
assert.equal(rows.get("guardMembers")[0].accessRole, "member")
assert.equal(rows.get("guardMembers")[0].enrollmentManaged, false)

const replay = await guard.redeemGuardInviteCode({ code: invite.code, telegramId: 999999, source: "bot" })
assert.equal(replay.ok, false)
assert.match(replay.error, /already used/i)

const expired = await guard.createGuardInviteCode(7, "member")
rows.get("guardInviteCodes").find((row) => row._id === expired._id).expiresAt = "2020-01-01T00:00:00.000Z"
const expiredResult = await guard.redeemGuardInviteCode({ code: expired.code, telegramId: 777777, source: "bot" })
assert.equal(expiredResult.ok, false)
assert.match(expiredResult.error, /expired/i)

const deactivated = await guard.deactivateGuardMember(memberId)
assert.equal(deactivated.ok, true)
assert.equal(rows.get("guardMembers")[0].status, "deactivated")
assert.equal(rows.get("guardMembers")[0].enrollmentManaged, false)
assert.equal(rows.get("users")[0].guardAccess, "deactivated")

console.log("Guard invite and Telegram deep-link redemption tests passed")
