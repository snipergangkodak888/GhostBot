import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { normalizeQuickNodeRevenuePayload, verifyQuickNodeSignature } from "@/lib/quicknode-revenue"
import { saveRevenueReceipt } from "@/lib/revenue-service"
import { notifyFeeInboxReceipt } from "@/lib/revenue-telegram"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_REJECTED_SAMPLE_BYTES = 200_000

function rejectedPayloadSample(payload: unknown, body: string, rejected: number) {
  if (!rejected) return null
  if (Buffer.byteLength(body, "utf8") <= MAX_REJECTED_SAMPLE_BYTES) return payload
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(body, "utf8"),
    rawPrefix: body.slice(0, MAX_REJECTED_SAMPLE_BYTES),
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const secret = process.env.QUICKNODE_WEBHOOK_SECRET || ""
  const allowUnsigned = process.env.NODE_ENV !== "production" && process.env.QUICKNODE_ALLOW_UNSIGNED_WEBHOOKS === "true"
  const verification = verifyQuickNodeSignature({
    body,
    secret,
    nonce: req.headers.get("x-qn-nonce"),
    timestamp: req.headers.get("x-qn-timestamp"),
    signature: req.headers.get("x-qn-signature"),
  })
  if (!verification.ok && !allowUnsigned) {
    return NextResponse.json({ ok: false, error: verification.error }, { status: secret ? 401 : 503 })
  }

  let payload: any
  try {
    payload = JSON.parse(body || "{}")
  } catch {
    return NextResponse.json({ ok: false, error: "Webhook body is not valid JSON" }, { status: 400 })
  }
  const nonce = req.headers.get("x-qn-nonce") || createHash("sha256").update(body).digest("hex")
  const db = await getDb()
  const prior = await db.collection("quicknodeWebhookDeliveries").findOne({ nonce })
  if (prior) return NextResponse.json({ ok: true, duplicate: true, inserted: 0 })

  const normalized = normalizeQuickNodeRevenuePayload(payload, req.nextUrl.searchParams.get("chain"))
  if (!normalized.chain) return NextResponse.json({ ok: false, error: "Webhook chain is missing or unsupported" }, { status: 400 })

  let inserted = 0
  let duplicates = 0
  const savedIds: string[] = []
  for (const receipt of normalized.receipts) {
    const saved = await saveRevenueReceipt(receipt)
    if (saved.duplicate) duplicates += 1
    else {
      inserted += 1
      savedIds.push(String(saved.receipt._id || ""))
      await notifyFeeInboxReceipt(saved.receipt).catch((error) => console.error("[revenue] fee inbox notification failed", error))
    }
  }

  await db.collection("quicknodeWebhookDeliveries").insertOne({
    nonce,
    chain: normalized.chain,
    payloadHash: createHash("sha256").update(body).digest("hex"),
    inserted,
    duplicates,
    rejected: normalized.rejected,
    rejectedPayloadSample: rejectedPayloadSample(payload, body, normalized.rejected),
    savedIds,
    verified: verification.ok,
    metadata: payload?.metadata || null,
    createdAt: new Date(),
  })

  return NextResponse.json({ ok: true, chain: normalized.chain, inserted, duplicates, rejected: normalized.rejected })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "quicknode-revenue-webhook" })
}
