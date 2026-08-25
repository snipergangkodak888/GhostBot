import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { createDefaultSheetsForProject, ensureDefaultSheetsForProjects } from '@/lib/ops-sheets'
import { cleanProjectFeeFields } from '@/lib/revenue-projects'
import { normalizeProjectStatus, scheduledLifecycleFields } from '@/lib/project-lifecycle'
import { parseTeamDateTime } from '@/lib/team-timezone'
import { normalizeLaunchMethod } from '@/lib/launch-method'

export const dynamic = 'force-dynamic'

function cleanProject(body: any) {
  const launchSource = body.launchAt || body.launchDate
  const launchAt = launchSource ? parseTeamDateTime(launchSource, body.launchTimeZone || 'America/New_York')?.toISOString() || null : null
  const status = normalizeProjectStatus(body.status, launchAt)
  const startDate = body.startDate
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
    launchAt: launchAt ? new Date(launchAt).toISOString() : null,
    launchDate: launchAt ? new Date(launchAt).toISOString() : null,
    launchTimeZone: String(body.launchTimeZone || 'America/New_York'),
    launchVenue: String(body.launchVenue || '').trim(),
    launchFundingAsset: String(body.launchFundingAsset || '').trim().toUpperCase(),
    launchMethod: normalizeLaunchMethod(body.launchMethod) || '',
    referrerStatus: String(body.referrerStatus || (body.referrerAccountId || body.referrer ? 'assigned' : 'pending')),
    feeConfigurationConfirmed: body.feeConfigurationConfirmed === true,
    revenueToday: Number(body.revenueToday || 0),
    profitThisWeek: currentProfitLoss,
    notes: String(body.notes || '').trim(),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    ...cleanProjectFeeFields(body),
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
  if ((body.launchAt || body.launchDate) && !project.launchAt) return NextResponse.json({ error: 'Launch time or timezone is invalid.' }, { status: 400 })
  if (project.status === 'scheduled' && !project.launchAt) return NextResponse.json({ error: 'A launch time is required for a scheduled project.' }, { status: 400 })

  const now = new Date()
  const db = await getDb()
  const lifecycle = project.status === 'scheduled' && project.launchAt
    ? scheduledLifecycleFields({ launchAt: project.launchAt, launchTimeZone: project.launchTimeZone })
    : project.status === 'active'
      ? { activatedAt: now.toISOString(), activationSource: 'manual_dashboard' }
      : {}
  const result = await db.collection('opsProjects').insertOne({
    ...project,
    ...lifecycle,
    createdAt: now,
    updatedAt: now,
  })
  await createDefaultSheetsForProject(String(result.insertedId), project.name)

  return NextResponse.json({ project: { ...project, ...lifecycle, _id: result.insertedId, createdAt: now, updatedAt: now } })
}
