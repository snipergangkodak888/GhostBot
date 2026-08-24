#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import Module from "node:module"
import ts from "typescript"

function loadTypeScriptModule(path, overrides = {}) {
  const source = fs.readFileSync(path, "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = new Module(path)
  const originalLoad = loaded.require.bind(loaded)
  loaded.require = (id) => Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : originalLoad(id)
  loaded._compile(code, path)
  return loaded.exports
}

const permissions = loadTypeScriptModule("lib/bot-permissions.ts", {
  "@/lib/chat-subscriptions": { getChatProfile: async () => null },
  "@/lib/team-access": {
    getTeamAccess: async () => ({ allowed: true, member: { accessRole: "member" } }),
    normalizeTeamAccessRole: (value) => value === "admin" ? "admin" : "member",
  },
})

const subscriptions = loadTypeScriptModule("lib/chat-subscriptions.ts", {
  "@/lib/db": { getDb: async () => { throw new Error("Database should not be used by pure permission tests") } },
})

const context = (role, profile, isGroup = true) => ({ telegramId: 1, chatId: isGroup ? -1 : 1, isGroup, role, profile, configured: !isGroup || Boolean(profile), capture: false })

assert.equal(permissions.canUseBotCapability(context("member", null, false), "launch"), true)
assert.equal(permissions.canUseBotCapability(context("member", null, false), "trade"), true)
assert.equal(permissions.canUseBotCapability(context("member", null, false), "finance"), false)
assert.equal(permissions.canUseBotCapability(context("admin", "launch"), "launch"), true)
assert.equal(permissions.canUseBotCapability(context("admin", "launch"), "finance"), false)
assert.equal(permissions.canUseBotCapability(context("admin", "launch"), "management"), false)
assert.equal(permissions.canUseBotCapability(context("member", "finance"), "finance"), false)
assert.equal(permissions.canUseBotCapability(context("admin", "finance"), "finance"), true)
assert.equal(permissions.canUseBotCapability(context("admin", "finance"), "launch"), false)
assert.equal(permissions.canUseBotCapability(context("admin", "management"), "launch"), true)
assert.equal(permissions.canUseBotCapability(context("admin", "management"), "trade"), true)
assert.equal(permissions.canUseBotCapability(context("admin", "management"), "finance"), true)
assert.equal(permissions.canUseBotCapability(context("admin", "management"), "management"), true)
assert.equal(permissions.canUseBotCapability(context("member", "management"), "launch"), false)
assert.equal(permissions.canUseBotCapability(context("member", "management"), "trade"), false)
assert.equal(permissions.canUseBotCapability(context("admin", null), "management"), true)
assert.equal(permissions.canUseBotCapability(context("admin", null), "finance"), false)

assert.equal(subscriptions.normalizeChatPurpose("daily"), null)
assert.equal(subscriptions.normalizeChatPurpose("trade"), null)
assert.deepEqual(Array.from(subscriptions.defaultNotificationsForProfile("launch")), ["launches"])
assert.deepEqual(Array.from(subscriptions.defaultNotificationsForProfile("trade")), [])
assert.deepEqual(Array.from(subscriptions.defaultNotificationsForProfile("fee")), ["fees"])
assert.deepEqual(Array.from(subscriptions.defaultNotificationsForProfile("finance")), [])
assert.deepEqual(Array.from(subscriptions.defaultNotificationsForProfile("management")), [])
assert.equal(subscriptions.notificationAllowedForProfile("launch", "launches"), true)
assert.equal(subscriptions.notificationAllowedForProfile("launch", "finance"), false)
assert.equal(subscriptions.notificationAllowedForProfile("trade", "launches"), false)
assert.equal(subscriptions.notificationAllowedForProfile("fee", "fees"), true)
assert.equal(subscriptions.notificationAllowedForProfile("management", "finance"), false)

const rows = new Map()
const matches = (row, query) => Object.entries(query).every(([key, value]) => row?.[key] === value)
const memoryDb = {
  collection(name) {
    if (!rows.has(name)) rows.set(name, [])
    const collection = rows.get(name)
    return {
      findOne: async (query) => collection.find((row) => matches(row, query)) || null,
      find: (query) => ({ toArray: async () => collection.filter((row) => matches(row, query)) }),
      updateOne: async (query, update, options = {}) => {
        let row = collection.find((item) => matches(item, query))
        if (!row && options.upsert) {
          row = { ...query, ...(update.$setOnInsert || {}) }
          collection.push(row)
        }
        if (row) Object.assign(row, update.$set || {})
        return { modifiedCount: row ? 1 : 0 }
      },
      insertOne: async (row) => {
        collection.push({ ...row, _id: `${name}-${collection.length + 1}` })
        return { insertedId: `${name}-${collection.length}` }
      },
    }
  },
}
const profileStore = loadTypeScriptModule("lib/chat-subscriptions.ts", {
  "@/lib/db": { getDb: async () => memoryDb },
})
await profileStore.setChatProfile({ chatId: -100, profile: "trade", title: "Trade Floor", chatType: "supergroup", telegramId: 7 })
assert.equal(rows.get("opsChatProfiles")[0].profile, "trade")
assert.equal(rows.get("opsChatSubscriptions").some((row) => row.status === "active"), false)
await profileStore.setChatProfile({ chatId: -100, profile: "launch", title: "Launch Chat", chatType: "supergroup", telegramId: 7 })
assert.deepEqual(rows.get("opsChatSubscriptions").filter((row) => row.status === "active").map((row) => row.purpose), ["launches"])
assert.equal((await profileStore.getSubscribedChats("launches")).length, 1)
await profileStore.setChatSubscription({ chatId: -100, purpose: "finance", active: true, title: "Launch Chat", chatType: "supergroup", telegramId: 7 })
assert.equal((await profileStore.getSubscribedChats("finance")).length, 0)
assert.deepEqual((await profileStore.listChatSubscriptions(-100)).map((row) => row.purpose), ["launches"])
await profileStore.setChatProfile({ chatId: -100, profile: "management", title: "Management", chatType: "supergroup", telegramId: 7 })
assert.equal(rows.get("opsChatSubscriptions").some((row) => row.status === "active"), false)
assert.equal(rows.get("opsPermissionAudit").length, 3)

console.log("Bot permission tests passed")
