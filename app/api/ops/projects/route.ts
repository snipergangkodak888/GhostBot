import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { createDefaultSheetsForProject, ensureDefaultSheetsForProjects } from '@/lib/ops-sheets'

export const dynamic = 'force-dynamic'

function cleanProject(body: any) {
  const status = ["active", "inactive", "in_progress"].includes(String(body.status || "")) ? String(body.status) : "active"
  const startDate = body.startDate || body.launchDate
  const currentProfitLoss = Number(body.currentProfitLoss ?? body.profitThisWeek ?? 0)
  return {
    name: String(body.name || '').trim(),
    referrer: String(body.referrer || '').trim(),
    referrerWallet: String(body.referrerWallet || '').trim(),
    referrerAccountId: body.referrerAccountId ? String(body.referrerAccountId).trim() : null,
    referralPercentage: Number(body.referralPercentage ?? body.referrerPercentage ?? 0),
    status,
    service: String(body.service || '').trim(),
    startDate: startDate ? new Date(startDate).toISOString() : null,
    endDate: body.endDate ? new Date(body.endDate).toISOString() : null,
    currentProfitLoss,
    owner: String(body.owner || body.referrer || '').trim(),
    launchDate: startDate ? new Date(startDate).toISOString() : null,
    revenueToday: Number(body.revenueToday || 0),
    profitThisWeek: currentProfitLoss,
    notes: String(body.notes || '').trim(),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  }
}

export async function GET() {
  try {
    const db = await getDb()
    const projects = await db.collection('opsProjects').find({}).sort({ updatedAt: -1 }).toArray()
    await ensureDefaultSheetsForProjects(projects)
    return NextResponse.json(projects)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const project = cleanProject(body)
  if (!project.name) return NextResponse.json({ error: 'Project name is required' }, { status: 400 })

  const now = new Date()
  const db = await getDb()
  const result = await db.collection('opsProjects').insertOne({
    ...project,
    createdAt: now,
    updatedAt: now,
  })
  await createDefaultSheetsForProject(String(result.insertedId), project.name)

  return NextResponse.json({ project: { ...project, _id: result.insertedId, createdAt: now, updatedAt: now } })
}
