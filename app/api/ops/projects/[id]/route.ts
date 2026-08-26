import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { deleteProjectCascade } from '@/lib/platform-data'
import { cleanProjectFeeFields } from '@/lib/revenue-projects'
import { activationLifecycleFields, normalizeProjectStatus, projectActivationReadiness, projectLaunchAt, scheduledLifecycleFields } from '@/lib/project-lifecycle'
import { parseTeamDateTime } from '@/lib/team-timezone'
import { normalizeLaunchMethod } from '@/lib/launch-method'
import { resolveCustomQuoteToken } from '@/lib/custom-quote-token'

export const dynamic = 'force-dynamic'

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const db = await getDb()
  const existing = await db.collection('opsProjects').findOne(idFilter(params.id))
  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const update: Record<string, any> = { updatedAt: new Date() }
  for (const key of ['name', 'owner', 'referrer', 'referrerWallet', 'service', 'notes']) {
    if (typeof body[key] === 'string') update[key] = body[key].trim()
  }
  if (body.referrerAccountId !== undefined) update.referrerAccountId = body.referrerAccountId ? String(body.referrerAccountId).trim() : null
  if (body.referralPercentage !== undefined || body.referrerPercentage !== undefined) {
    update.referralPercentage = Number(body.referralPercentage ?? body.referrerPercentage ?? 0)
  }
  const requestedStatus = body.status === undefined ? undefined : normalizeProjectStatus(body.status, body.launchAt || body.launchDate || projectLaunchAt(existing))
  if (body.startDate !== undefined) {
    update.startDate = body.startDate ? new Date(body.startDate).toISOString() : null
  }
  if (body.launchAt !== undefined || body.launchDate !== undefined) {
    const launchSource = body.launchAt || body.launchDate
    const launchAt = launchSource ? parseTeamDateTime(launchSource, body.launchTimeZone || existing.launchTimeZone || 'America/New_York')?.toISOString() : null
    if (launchSource && !launchAt) return NextResponse.json({ error: 'Launch time or timezone is invalid.' }, { status: 400 })
    if (launchAt && existing.status !== 'active') Object.assign(update, scheduledLifecycleFields({ launchAt, launchTimeZone: body.launchTimeZone || existing.launchTimeZone, previous: existing }))
    else if (launchAt) {
      update.launchAt = new Date(launchAt).toISOString()
      update.launchDate = update.launchAt
    }
    else {
      update.launchAt = null
      update.launchDate = null
    }
  }
  if (body.endDate !== undefined) update.endDate = body.endDate ? new Date(body.endDate).toISOString() : null
  if (body.revenueToday !== undefined) update.revenueToday = Number(body.revenueToday || 0)
  if (body.profitThisWeek !== undefined) update.profitThisWeek = Number(body.profitThisWeek || 0)
  if (body.currentProfitLoss !== undefined) {
    update.currentProfitLoss = Number(body.currentProfitLoss || 0)
    update.profitThisWeek = update.currentProfitLoss
  }
  if (Array.isArray(body.tags)) update.tags = body.tags.map(String)
  for (const key of ['launchTimeZone', 'launchVenue', 'launchFundingAsset']) {
    if (typeof body[key] === 'string') update[key] = body[key].trim()
  }
  if (body.launchMethod !== undefined) update.launchMethod = normalizeLaunchMethod(body.launchMethod) || ''
  if (body.referrerStatus !== undefined || body.referrer !== undefined || body.referrerAccountId !== undefined) {
    update.referrerStatus = String(body.referrerStatus || (body.referrerAccountId || body.referrer ? 'assigned' : 'pending'))
  }
  if (["chain", "revenueChain", "quoteToken", "quoteAssets", "quoteTokenAddress", "quoteTokenDecimals", "dailyTradingFeeEnabled", "dailyTradingFeeUsd", "liquidationFeeEnabled", "liquidationFeePercentage", "launchFeeUsd"].some((key) => body[key] !== undefined)) {
    const feeInput = { ...existing, ...body, chain: body.chain ?? body.revenueChain ?? existing.chain }
    try {
      const customQuote = feeInput.quoteTokenAddress
        ? await resolveCustomQuoteToken(feeInput.chain, feeInput.quoteToken, feeInput.quoteTokenAddress)
        : {}
      Object.assign(update, cleanProjectFeeFields({ ...feeInput, ...customQuote }))
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Custom quote token verification failed.' }, { status: 400 })
    }
  }

  if (body.feeConfigurationConfirmed !== undefined) update.feeConfigurationConfirmed = body.feeConfigurationConfirmed === true

  if (requestedStatus === 'active' && existing.status !== 'active') {
    const candidate = { ...existing, ...update, status: 'scheduled' }
    const readiness = projectActivationReadiness(candidate)
    if (!readiness.ready) return NextResponse.json({ error: `Complete ${readiness.missing.join(', ')} before activation.`, readiness }, { status: 400 })
    Object.assign(update, activationLifecycleFields(candidate, { actual: 'now', source: 'manual_dashboard' }))
  } else if (requestedStatus === 'scheduled') {
    const launchAt = projectLaunchAt({ ...existing, ...update })
    if (!launchAt) return NextResponse.json({ error: 'A launch time is required for a scheduled project.' }, { status: 400 })
    if (existing.status === 'active') return NextResponse.json({ error: 'An active project cannot be moved back to Scheduled. Deactivate it first or edit its launch details without changing status.' }, { status: 400 })
    update.status = 'scheduled'
  } else if (requestedStatus === 'inactive') {
    update.status = 'inactive'
    update.inactivatedAt = new Date().toISOString()
    update.inactivationSource = 'manual_dashboard'
    update.nextActivationPromptAt = null
    update.activationOverdue = false
  }

  await db.collection('opsProjects').updateOne(idFilter(params.id), { $set: update })
  if (typeof update.name === 'string' && update.name) {
    await db.collection('revenueFeeEvents').updateMany(
      { projectId: String(existing._id) },
      { $set: { projectName: update.name, updatedAt: new Date().toISOString() } },
    )
  }
  const project = await db.collection('opsProjects').findOne(idFilter(params.id))
  return NextResponse.json({ project })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const result = await deleteProjectCascade(params.id)
  return NextResponse.json({ ok: true, ...result })
}
