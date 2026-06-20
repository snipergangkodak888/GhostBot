import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { deleteProjectCascade } from '@/lib/platform-data'

export const dynamic = 'force-dynamic'

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const update: Record<string, any> = { updatedAt: new Date() }
  for (const key of ['name', 'owner', 'referrer', 'referrerWallet', 'service', 'notes']) {
    if (typeof body[key] === 'string') update[key] = body[key].trim()
  }
  if (body.referrerAccountId !== undefined) update.referrerAccountId = body.referrerAccountId ? String(body.referrerAccountId).trim() : null
  if (body.referralPercentage !== undefined || body.referrerPercentage !== undefined) {
    update.referralPercentage = Number(body.referralPercentage ?? body.referrerPercentage ?? 0)
  }
  if (body.status === 'active' || body.status === 'inactive' || body.status === 'in_progress') update.status = body.status
  if (body.startDate !== undefined || body.launchDate !== undefined) {
    const startDate = body.startDate || body.launchDate
    update.startDate = startDate ? new Date(startDate).toISOString() : null
    update.launchDate = update.startDate
  }
  if (body.endDate !== undefined) update.endDate = body.endDate ? new Date(body.endDate).toISOString() : null
  if (body.revenueToday !== undefined) update.revenueToday = Number(body.revenueToday || 0)
  if (body.profitThisWeek !== undefined) update.profitThisWeek = Number(body.profitThisWeek || 0)
  if (body.currentProfitLoss !== undefined) {
    update.currentProfitLoss = Number(body.currentProfitLoss || 0)
    update.profitThisWeek = update.currentProfitLoss
  }
  if (Array.isArray(body.tags)) update.tags = body.tags.map(String)

  const db = await getDb()
  await db.collection('opsProjects').updateOne(idFilter(params.id), { $set: update })
  const project = await db.collection('opsProjects').findOne(idFilter(params.id))
  return NextResponse.json({ project })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const result = await deleteProjectCascade(params.id)
  return NextResponse.json({ ok: true, ...result })
}
