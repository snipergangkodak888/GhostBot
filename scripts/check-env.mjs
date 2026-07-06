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

function projectRefFromSupabaseUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0] || ""
  } catch {
    return ""
  }
}

function mask(value) {
  const text = String(value || "").trim()
  if (!text) return "(missing)"
  if (text.length <= 8) return "***"
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

const appEnv = String(process.env.APP_ENV || "development").trim().toLowerCase()
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const projectRef = projectRefFromSupabaseUrl(supabaseUrl)
const prodRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || "").trim().toLowerCase()
const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || ""
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || ""

const required = [
  ["SUPABASE_URL", supabaseUrl],
  ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ["SUPABASE_POOLER_DATABASE_URL", process.env.SUPABASE_POOLER_DATABASE_URL],
  ["TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN],
  ["NEXT_PUBLIC_BOT_USERNAME", botUsername],
  ["ADMIN_JWT_SECRET", process.env.ADMIN_JWT_SECRET],
  ["CRON_SECRET", process.env.CRON_SECRET],
]

console.log("\nGhostBot environment check\n")
console.log(`Loaded: ${fs.existsSync(localEnvPath) ? ".env.local" : ".env (if present)"}`)
console.log(`APP_ENV: ${appEnv}`)
console.log(`Supabase project ref: ${projectRef || "(not set)"}`)
console.log(`Bot: @${botUsername || "(not set)"}`)
console.log(`App URL: ${baseUrl || "(not set)"}`)
console.log(`Telegram token: ${mask(process.env.TELEGRAM_BOT_TOKEN)}`)
console.log("")

let errors = 0
let warnings = 0

for (const [name, value] of required) {
  if (!String(value || "").trim()) {
    console.log(`ERROR  ${name} is missing`)
    errors++
  }
}

if (appEnv === "development" && prodRef && projectRef && projectRef.toLowerCase() === prodRef) {
  console.log("ERROR  Local .env.local is pointed at PRODUCTION Supabase.")
  console.log("       Create a dev Supabase project and update SUPABASE_* values.")
  errors++
}

if (appEnv === "production" && !prodRef) {
  console.log("WARN   APP_ENV=production but PRODUCTION_SUPABASE_PROJECT_REF is not set.")
  warnings++
}

if (appEnv === "development" && prodRef && projectRef && projectRef.toLowerCase() !== prodRef) {
  console.log("OK     Local env is using a non-production Supabase project ref.")
}

if (baseUrl.includes("localhost") && appEnv === "production") {
  console.log("WARN   APP_ENV=production but app URL still looks local.")
  warnings++
}

if (baseUrl.startsWith("http://") && !baseUrl.includes("localhost")) {
  console.log("WARN   Public app URL should use https in production.")
  warnings++
}

console.log("")
if (errors) {
  console.log(`Result: ${errors} error(s), ${warnings} warning(s). Fix errors before running locally.`)
  process.exitCode = 1
} else if (warnings) {
  console.log(`Result: OK with ${warnings} warning(s).`)
} else {
  console.log("Result: OK — env looks ready for this environment.")
}
console.log("")
