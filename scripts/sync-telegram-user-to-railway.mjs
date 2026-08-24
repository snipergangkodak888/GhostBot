#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const service = String(process.env.RAILWAY_SERVICE || "GhostBot")
const environment = String(process.env.RAILWAY_ENVIRONMENT || "production")
const variables = {
  TELEGRAM_USER_API_ID: String(process.env.TELEGRAM_USER_API_ID || "").trim(),
  TELEGRAM_USER_API_HASH: String(process.env.TELEGRAM_USER_API_HASH || "").trim(),
  TELEGRAM_USER_SESSION: String(process.env.TELEGRAM_USER_SESSION || "").trim(),
  SUMO_TRADE_BOT_USERNAME: String(process.env.SUMO_TRADE_BOT_USERNAME || "sumo_trade_bot").trim().replace(/^@/, ""),
  SUMO_CHANNEL_LOGO_PATH: String(process.env.SUMO_CHANNEL_LOGO_PATH || "public/logos/sumo-black.jpg").trim(),
}

const missing = Object.entries(variables).filter(([, value]) => !value).map(([key]) => key)
if (missing.length) {
  console.error(`Missing local Telegram configuration: ${missing.join(", ")}`)
  process.exit(1)
}

for (const [key, value] of Object.entries(variables)) {
  const result = spawnSync("railway", [
    "variable", "set", key, "--stdin", "--skip-deploys",
    "--service", service,
    "--environment", environment,
  ], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    console.error(`Failed to set ${key}: ${String(result.stderr || result.stdout || "unknown Railway error").trim()}`)
    process.exit(result.status || 1)
  }
  console.log(`Set ${key}`)
}

console.log(`Telegram automation variables are configured for Railway ${service}/${environment}; deployment was intentionally skipped.`)
