#!/usr/bin/env node

import process from "node:process"
import readline from "node:readline"
import fs from "node:fs"
import dotenv from "dotenv"
import { Api, TelegramClient } from "teleproto"
import { StringSession } from "teleproto/sessions/index.js"

dotenv.config({ path: ".env.local" })

const ask = (question) => new Promise((resolve) => {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  terminal.question(question, (answer) => {
    terminal.close()
    resolve(answer.trim())
  })
})

function askHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") return ask(question)
  return new Promise((resolve) => {
    process.stdout.write(question)
    let value = ""
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const onData = (buffer) => {
      const input = buffer.toString("utf8")
      if (input === "\r" || input === "\n") {
        process.stdin.off("data", onData)
        process.stdin.setRawMode(false)
        process.stdout.write("\n")
        resolve(value)
        return
      }
      if (input === "\u0003") {
        process.stdin.setRawMode(false)
        process.stdout.write("\n")
        process.exit(130)
      }
      if (input === "\u007f" || input === "\b") {
        value = value.slice(0, -1)
        return
      }
      value += input
    }
    process.stdin.on("data", onData)
  })
}

function saveLocalEnv(values) {
  const filePath = ".env.local"
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
  const lines = source.split(/\r?\n/)
  for (const [key, value] of Object.entries(values)) {
    const replacement = `${key}=${String(value).replace(/[\r\n]/g, "")}`
    const index = lines.findIndex((line) => line.startsWith(`${key}=`))
    if (index >= 0) lines[index] = replacement
    else lines.push(replacement)
  }
  fs.writeFileSync(filePath, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, { mode: 0o600 })
}

let apiId = Number(process.env.TELEGRAM_USER_API_ID || 0)
if (!Number.isSafeInteger(apiId) || apiId <= 0) apiId = Number(await ask("Telegram API ID: "))
if (!Number.isSafeInteger(apiId) || apiId <= 0) {
  console.error("The Telegram API ID must be a positive number.")
  process.exit(1)
}
let apiHash = String(process.env.TELEGRAM_USER_API_HASH || "").trim()
if (!apiHash) apiHash = String(await askHidden("Telegram API hash (hidden): ")).trim()
if (!apiHash) {
  console.error("Telegram API hash is required.")
  process.exit(1)
}
saveLocalEnv({ TELEGRAM_USER_API_ID: apiId, TELEGRAM_USER_API_HASH: apiHash })

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
  floodSleepThreshold: 60,
})
client.setLogLevel("warn")

try {
  console.log("This signs in the dedicated Telegram automation account once. Codes and 2FA passwords are not saved.")
  await client.start({
    phoneNumber: () => ask("Phone number with country code: "),
    phoneCode: () => ask("Telegram login code: "),
    password: () => askHidden("Telegram 2FA password (hidden): "),
    onError: (error) => console.error("Telegram sign-in error:", error instanceof Error ? error.message : String(error)),
  })
  await client.invoke(new Api.account.SetAuthorizationTTL({ authorizationTtlDays: 366 }))
  const me = await client.getMe()
  const session = client.session.save()
  saveLocalEnv({ TELEGRAM_USER_SESSION: session })
  console.log(`\nAuthorized automation account: @${me.username || "no_username"} (ID ${me.id.toString()})`)
  console.log("Telegram inactivity TTL requested: 366 days. Normal use by the worker keeps the session active.")
  console.log("The session was saved securely to .env.local and was not printed.")
} finally {
  await client.disconnect().catch(() => undefined)
}
