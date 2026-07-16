#!/usr/bin/env node
import fs from "fs"
import path from "path"

const cwd = process.cwd()
const localEnvPath = path.join(cwd, ".env.local")

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(localEnvPath)

const baseUrl = String(process.env.CRON_PING_URL || "http://localhost:3000").replace(/\/+$/, "")
const secret = String(process.env.CRON_SECRET || "").trim()
const intervalMs = Math.max(5000, Number(process.env.CRON_PING_INTERVAL_MS || 15000) || 15000)
const cronUrl = `${baseUrl}/api/cron/ops`

function stamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
}

async function pingOnce() {
  const started = Date.now()
  try {
    const res = await fetch(cronUrl, {
      method: "GET",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    })
    const body = await res.json().catch(() => ({}))
    const elapsed = Date.now() - started
    if (!res.ok) {
      console.log(`[${stamp()}] cron ping failed ${res.status} (${elapsed}ms)`, body.error || body)
      return
    }
    const due = body.reminders?.due ?? 0
    const sent = body.reminders?.sent ?? 0
    const suffix = due > 0 ? ` reminders due=${due} sent=${sent}` : ""
    console.log(`[${stamp()}] cron ok (${elapsed}ms)${suffix}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${stamp()}] cron unreachable: ${message}`)
  }
}

console.log(`Local ops cron pinger`)
console.log(`URL: ${cronUrl}${secret ? " (authenticated)" : ""}`)
console.log(`Interval: ${intervalMs}ms`)
console.log(`Press Ctrl+C to stop\n`)

await pingOnce()
const timer = setInterval(pingOnce, intervalMs)

process.on("SIGINT", () => {
  clearInterval(timer)
  console.log("\nStopped local cron pinger.")
  process.exit(0)
})
