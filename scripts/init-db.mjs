#!/usr/bin/env node
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import postgres from "postgres"

const cwd = process.cwd()
const localEnv = path.join(cwd, ".env.local")
dotenv.config(fs.existsSync(localEnv) ? { path: localEnv } : undefined)

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL

const SUPABASE_POOLER_REGIONS = [
  "aws-0-us-east-1",
  "aws-0-us-east-2",
  "aws-0-us-west-1",
  "aws-0-us-west-2",
  "aws-0-ca-central-1",
  "aws-0-eu-north-1",
  "aws-0-eu-west-1",
  "aws-0-eu-west-2",
  "aws-0-eu-west-3",
  "aws-0-eu-central-1",
  "aws-0-eu-south-1",
  "aws-0-ap-south-1",
  "aws-0-ap-east-1",
  "aws-0-ap-southeast-1",
  "aws-0-ap-southeast-2",
  "aws-0-ap-southeast-3",
  "aws-0-ap-northeast-1",
  "aws-0-ap-northeast-2",
  "aws-0-me-central-1",
  "aws-0-me-south-1",
  "aws-0-sa-east-1",
]

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")
}

async function supabaseRest(pathname, options = {}) {
  if (!supabaseUrl || !serviceRoleKey) {
    console.log("[init-db] Skipping Supabase seed because SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    return null
  }

  const res = await fetch(`${supabaseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText)
    if (res.status === 404 && message.includes("public.documents")) {
      throw new Error(
        "[init-db] Supabase documents table is missing. Add SUPABASE_DATABASE_URL so deploy can create it automatically."
      )
    }
    throw new Error(`[init-db] Supabase request failed: ${res.status} ${message}`)
  }

  if (res.status === 204) return null
  return res.json().catch(() => null)
}

async function ensureSchema() {
  if (!databaseUrl) {
    console.log("[init-db] SUPABASE_DATABASE_URL is not set; skipping automatic schema creation")
    return
  }

  const schemaPath = path.join(cwd, "supabase", "schema.sql")
  const schemaSql = fs.readFileSync(schemaPath, "utf8")

  let lastError
  for (const connectionUrl of getSchemaConnectionUrls(databaseUrl, supabaseUrl || "")) {
    const sql = postgres(connectionUrl, {
      max: 1,
      ssl: "require",
      prepare: false,
      idle_timeout: 5,
      connect_timeout: 15,
    })

    try {
      await sql.unsafe(schemaSql)
      console.log("[init-db] Ensured Supabase schema")
      return
    } catch (error) {
      lastError = error
      if (!isRetryableConnectionRouteError(error)) throw error
      console.warn(`[init-db] Supabase connection route did not match this project, trying next route...`)
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }

  throw lastError
}

function isConnectionHostError(error) {
  return error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN"
}

function isWrongPoolerRoute(error) {
  const message = String(error?.message || "")
  return message.includes("tenant/user") && message.includes("not found")
}

function isRetryableConnectionRouteError(error) {
  return isConnectionHostError(error) || isWrongPoolerRoute(error)
}

function getSchemaConnectionUrls(rawDatabaseUrl, rawSupabaseUrl) {
  const urls = [rawDatabaseUrl]

  try {
    const parsed = new URL(rawDatabaseUrl)
    const hostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)
    const projectRef = hostMatch?.[1] || new URL(rawSupabaseUrl).hostname.split(".")[0]
    if (!projectRef) return urls

    const pathname = parsed.pathname || "/postgres"
    const search = parsed.search || "?sslmode=require"
    const password = parsed.password ? `:${parsed.password}` : ""
    const preferredRegion = process.env.SUPABASE_POOLER_REGION
    const regions = preferredRegion
      ? [preferredRegion, ...SUPABASE_POOLER_REGIONS.filter((region) => region !== preferredRegion)]
      : SUPABASE_POOLER_REGIONS

    for (const region of regions) {
      urls.push(`${parsed.protocol}//postgres.${projectRef}${password}@${region}.pooler.supabase.com:5432${pathname}${search}`)
    }
  } catch {}

  return Array.from(new Set(urls))
}

async function upsertDocument(collection, id, data) {
  return supabaseRest("/rest/v1/documents?on_conflict=collection,id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      collection,
      id,
      data: { ...data, _id: id },
      updated_at: new Date().toISOString(),
    },
  })
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return

  const existing = await supabaseRest(`/rest/v1/documents?collection=eq.admins&data->>email=eq.${encodeURIComponent(email)}&select=id&limit=1`)
  if (Array.isArray(existing) && existing.length > 0) return

  const hash = await bcrypt.hash(password, 10)
  await upsertDocument("admins", randomId(), {
    email,
    password: hash,
    role: "admin",
    createdAt: new Date().toISOString(),
  })
  console.log(`[init-db] Created default Supabase admin: ${email}`)
}

async function seedSettings() {
  const defaults = [
    { key: "platformName", value: "Ghost Team System" },
    { key: "logoUrl", value: "/logos/blue-logo.png" },
    { key: "landingPageEnabled", value: true },
    { key: "telegramBotUsername", value: process.env.NEXT_PUBLIC_BOT_USERNAME || "" },
    { key: "contactTelegram", value: "" },
    { key: "contactEmail", value: "" },
  ]

  for (const setting of defaults) {
    await upsertDocument("settings", setting.key, {
      ...setting,
      createdAt: new Date().toISOString(),
    })
  }
  console.log("[init-db] Seeded Supabase default settings")
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    console.log("[init-db] Skipping Supabase seed because SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    return
  }

  try {
    await ensureSchema()
    await seedAdmin()
    await seedSettings()
  } catch (error) {
    console.error(error?.message || error)
    console.error("[init-db] Database initialization failed.")
    process.exitCode = 1
  }
}

main()
