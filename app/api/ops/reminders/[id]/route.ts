import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { normalizeReminderDueAt, TEAM_TIME_ZONE } from '@/lib/team-timezone'

export const dynamic = 'force-dynamic'

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const update: Record<string, any> = { updatedAt: new Date() }
  for (const key of ['title', 'message', 'telegramChatId', 'targetChatTitle']) {
    if (typeof body[key] === 'string') update[key] = body[key].trim()
  }
  if (body.projectId !== undefined) update.projectId = body.projectId ? String(body.projectId) : null
  if (body.dueAt !== undefined) {
    const normalized = normalizeReminderDueAt({ dueAt: body.dueAt, timeZone: body.timeZone || TEAM_TIME_ZONE })
    if (!normalized) return NextResponse.json({ error: 'A valid reminder due time is required' }, { status: 400 })
    update.dueAt = normalized.dueAt
    update.timeZone = normalized.timeZone
  }
  if (body.deliveryScope === 'chat' || body.deliveryScope === 'team') update.deliveryScope = body.deliveryScope
  if (['none', 'hourly', 'daily', 'weekly'].includes(body.recurrence)) update.recurrence = body.recurrence
  if (body.audience === 'team' || body.audience === 'individual') update.audience = body.audience
  if (body.status === 'scheduled' || body.status === 'done') update.status = body.status

  const db = await getDb()
  await db.collection('opsReminders').updateOne(idFilter(params.id), { $set: update })
  const reminder = await db.collection('opsReminders').findOne(idFilter(params.id))
  return NextResponse.json({ reminder })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const db = await getDb()
  await db.collection('opsReminders').deleteOne(idFilter(params.id))
  return NextResponse.json({ ok: true })
}
