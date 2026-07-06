import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { PayrollAccount } from '@/lib/payroll-ledger'
import { savePayrollDay } from '@/lib/payroll-day'

export const dynamic = 'force-dynamic'

function dateKey(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function normalizeAccount(account: any): PayrollAccount {
  return {
    ...account,
    id: String(account.id || account._id || ""),
    _id: String(account._id || account.id || ""),
    referralId: account.referralId || account.referral_id || null,
    profitSharePercentage: Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
  }
}

export async function GET(req: Request) {
  try {
    const db = await getDb()
    const url = new URL(req.url)
    if (url.searchParams.get("ledger") === "1") {
      const [accounts, dailyEntries, transactions] = await Promise.all([
        db.collection("payrollAccounts").find({}).sort({ type: 1, name: 1 }).toArray(),
        db.collection("dailyPayrollEntries").find({}).sort({ date: -1, updatedAt: -1 }).toArray(),
        db.collection("ledgerTransactions").find({}).sort({ date: -1, createdAt: -1 }).toArray(),
      ])
      return NextResponse.json({
        accounts: accounts.map(normalizeAccount),
        dailyEntries,
        transactions,
      })
    }
    const payroll = await db.collection('opsPayroll').find({}).sort({ date: -1, updatedAt: -1 }).toArray()
    return NextResponse.json(payroll)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  if (body.mode === "ledger-day") {
    try {
      const result = await savePayrollDay({
        date: body.date,
        notes: body.notes,
        teamPayroll: Array.isArray(body.teamPayroll) ? body.teamPayroll : [],
        clientIncome: Array.isArray(body.clientIncome) ? body.clientIncome : [],
        devAllocations: Array.isArray(body.devAllocations) ? body.devAllocations : [],
        rules: body.rules,
      })
      return NextResponse.json({ entry: result.entry, transactions: result.transactions })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "Payroll day was not saved" }, { status: 400 })
    }
  }

  const member = String(body.member || '').trim()
  if (!member) return NextResponse.json({ error: 'Team member is required' }, { status: 400 })
  const row = {
    member,
    role: String(body.role || '').trim(),
    projectId: body.projectId ? String(body.projectId).trim() : null,
    project: String(body.project || '').trim(),
    amount: Number(body.amount || 0),
    currency: String(body.currency || 'USD').trim().toUpperCase(),
    status: body.status === 'paid' ? 'paid' : 'pending',
    date: String(body.date || new Date().toISOString().slice(0, 10)).trim(),
    notes: String(body.notes || '').trim(),
    updatedAt: new Date(),
    createdAt: new Date(),
  }
  const db = await getDb()
  const result = await db.collection('opsPayroll').insertOne(row)
  return NextResponse.json({ row: { ...row, _id: result.insertedId } })
}
