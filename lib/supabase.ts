import dns from "node:dns"
import fs from "fs"
import path from "path"
import postgres from "postgres"

dns.setDefaultResultOrder("ipv4first")

type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  headers?: HeadersInit
  schema?: string
  skipSchemaRetry?: boolean
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const databaseUrl =
  process.env.SUPABASE_POOLER_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ""

export const supabaseConfig = {
  url: supabaseUrl,
  hasServiceRoleKey: Boolean(serviceRoleKey),
  hasAnonKey: Boolean(anonKey),
  hasPoolConnection: Boolean(databaseUrl),
  databaseUrl,
}

export function requireSupabaseConfig() {
  if (!supabaseUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is not set")
  if (!serviceRoleKey && !anonKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not set")
}

let schemaPromise: Promise<void> | null = null

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

function isMissingDocumentsTable(status: number, message: string) {
  return status === 404 && (message.includes("PGRST205") || message.includes("public.documents"))
}

async function ensureSupabaseSchema() {
  if (!databaseUrl) {
    throw new Error(
      "Supabase documents table is missing. Set SUPABASE_POOLER_DATABASE_URL to the Session pooler URI shown by Supabase Connect."
    )
  }

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const schemaPath = path.join(process.cwd(), "supabase", "schema.sql")
      const schemaSql = fs.readFileSync(schemaPath, "utf8")

      let lastError: unknown
      for (const connectionUrl of getSchemaConnectionUrls(databaseUrl, supabaseUrl)) {
        const sql = postgres(connectionUrl, {
          max: 1,
          ssl: "require",
          prepare: false,
          idle_timeout: 5,
          connect_timeout: 15,
        })

        try {
          await sql.unsafe(schemaSql)
          return
        } catch (error: any) {
          lastError = error
          if (!isRetryableConnectionRouteError(error)) throw error
        } finally {
          await sql.end({ timeout: 5 }).catch(() => {})
        }
      }

      throw lastError
    })()
  }

  await schemaPromise
}

function isConnectionHostError(error: any) {
  return [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
  ].includes(error?.code)
}

function isWrongPoolerRoute(error: any) {
  const message = String(error?.message || "")
  return message.includes("tenant/user") && message.includes("not found")
}

function isRetryableConnectionRouteError(error: any) {
  return isConnectionHostError(error) || isWrongPoolerRoute(error)
}

function getSchemaConnectionUrls(rawDatabaseUrl: string, rawSupabaseUrl: string) {
  const urls = [rawDatabaseUrl]

  try {
    const parsed = new URL(rawDatabaseUrl)
    if (parsed.hostname.endsWith(".pooler.supabase.com")) return urls

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

export async function supabaseRest<T = unknown>(
  path: string,
  options: SupabaseRequestOptions = {}
): Promise<T> {
  requireSupabaseConfig()

  const key = serviceRoleKey || anonKey
  const endpoint = path.startsWith("/") ? path : `/rest/v1/${path}`
  const res = await fetch(`${supabaseUrl}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.schema ? { "Accept-Profile": options.schema, "Content-Profile": options.schema } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  })

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText)
    if (!options.skipSchemaRetry && isMissingDocumentsTable(res.status, message)) {
      await ensureSupabaseSchema()
      return supabaseRest<T>(path, { ...options, skipSchemaRetry: true })
    }
    throw new Error(`Supabase request failed: ${res.status} ${message}`)
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  if (!text) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Supabase returned non-JSON response: ${text.slice(0, 500)}`)
  }
}

export function getSupabasePoolConnectionString() {
  if (!databaseUrl) {
    throw new Error(
      "SUPABASE_POOLER_DATABASE_URL, SUPABASE_DATABASE_URL, or DATABASE_URL is not set"
    )
  }
  return databaseUrl
}
