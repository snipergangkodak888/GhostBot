import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'

export const dynamic = 'force-dynamic'

function idFilter(id: string) {
  return { _id: new ObjectId(id) }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const update: Record<string, any> = { updatedAt: new Date() }
  for (const key of ['title', 'message', 'telegramChatId']) {
    if (typeof body[key] === 'string') update[key] = body[key].trim()
  }
  if (body.projectId !== undefined) update.projectId = body.projectId ? String(body.projectId) : null
  if (body.dueAt !== undefined) update.dueAt = body.dueAt ? new Date(body.dueAt).toISOString() : new Date().toISOString()
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
