import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { normalizeReminderDueAt, TEAM_TIME_ZONE } from '@/lib/team-timezone'

export const dynamic = 'force-dynamic'

function cleanReminder(body: any) {
  const normalized = normalizeReminderDueAt({ dueAt: body.dueAt, timeZone: body.timeZone || TEAM_TIME_ZONE })
  const telegramChatId = body.telegramChatId ? String(body.telegramChatId).trim() : ''
  return {
    title: String(body.title || '').trim(),
    message: String(body.message || '').trim(),
    projectId: body.projectId ? String(body.projectId) : null,
    dueAt: normalized?.dueAt || '',
    timeZone: normalized?.timeZone || TEAM_TIME_ZONE,
    recurrence: ['none', 'hourly', 'daily', 'weekly'].includes(body.recurrence) ? body.recurrence : 'none',
    audience: body.audience === 'team' ? 'team' : 'individual',
    deliveryScope: telegramChatId ? 'chat' : 'team',
    telegramChatId,
    targetChatTitle: String(body.targetChatTitle || '').trim(),
    status: body.status === 'done' ? 'done' : 'scheduled',
  }
}

export async function GET() {
  try {
    const db = await getDb()
    const reminders = await db.collection('opsReminders').find({}).sort({ dueAt: 1 }).toArray()
    return NextResponse.json(reminders)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const reminder = cleanReminder(body)
  if (!reminder.title && !reminder.message) {
    return NextResponse.json({ error: 'Reminder title or message is required' }, { status: 400 })
  }
  if (!reminder.dueAt) return NextResponse.json({ error: 'A valid reminder due time is required' }, { status: 400 })
  if (!reminder.telegramChatId) return NextResponse.json({ error: 'Select a delivery chat' }, { status: 400 })
  const now = new Date()
  const db = await getDb()
  const result = await db.collection('opsReminders').insertOne({
    ...reminder,
    createdFrom: 'app',
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ reminder: { ...reminder, _id: result.insertedId, createdAt: now, updatedAt: now } })
}
