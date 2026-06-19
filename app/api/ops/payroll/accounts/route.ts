import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import type { PayrollAccountType } from "@/lib/payroll-ledger"

export const dynamic = "force-dynamic"

const accountTypes: PayrollAccountType[] = ["EMPLOYEE", "CLIENT", "REFERRER", "SYSTEM_TREASURY"]

function cleanType(value: unknown): PayrollAccountType | null {
  const type = String(value || "").trim().toUpperCase()
  return accountTypes.includes(type as PayrollAccountType) ? type as PayrollAccountType : null
}

function normalizeAccount(account: any) {
  return {
    ...account,
    id: String(account.id || account._id || ""),
    _id: String(account._id || account.id || ""),
    type: cleanType(account.type) || "EMPLOYEE",
    referralId: account.referralId || account.referral_id || null,
    profitSharePercentage: Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
  }
}

export async function GET() {
  const db = await getDb()
  const accounts = await db.collection("payrollAccounts").find({}).sort({ type: 1, name: 1 }).toArray()
  return NextResponse.json({ accounts: accounts.map(normalizeAccount) })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || "").trim()
  const type = cleanType(body.type)

  if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 })
  if (!type) return NextResponse.json({ error: "Account type is required" }, { status: 400 })

  const now = new Date()
  const account = {
    name,
    type,
    referralId: body.referralId ? String(body.referralId).trim() : null,
    profitSharePercentage: Number(body.profitSharePercentage || 0),
    wallet: String(body.wallet || "").trim(),
    createdAt: now,
    updatedAt: now,
  }

  const db = await getDb()
  const existing = await db.collection("payrollAccounts").findOne({ name, type })
  if (existing) return NextResponse.json({ account: normalizeAccount(existing) })

  const result = await db.collection("payrollAccounts").insertOne(account)
  return NextResponse.json({ account: normalizeAccount({ ...account, _id: result.insertedId }) })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || body._id || "").trim()
  const name = String(body.name || "").trim()
  const type = cleanType(body.type)

  if (!id) return NextResponse.json({ error: "Account id is required" }, { status: 400 })
  if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 })
  if (!type) return NextResponse.json({ error: "Account type is required" }, { status: 400 })

  const update = {
    name,
    type,
    referralId: body.referralId ? String(body.referralId).trim() : null,
    profitSharePercentage: Number(body.profitSharePercentage || 0),
    wallet: String(body.wallet || "").trim(),
    updatedAt: new Date(),
  }

  const db = await getDb()
  await db.collection("payrollAccounts").updateOne({ _id: id }, { $set: update })
  const account = await db.collection("payrollAccounts").findOne({ _id: id })
  return NextResponse.json({ account: normalizeAccount(account || { ...update, _id: id }) })
}
