import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function cleanReminder(body: any) {
  return {
    title: String(body.title || '').trim(),
    message: String(body.message || '').trim(),
    projectId: body.projectId ? String(body.projectId) : null,
    dueAt: body.dueAt ? new Date(body.dueAt).toISOString() : new Date().toISOString(),
    recurrence: ['none', 'hourly', 'daily', 'weekly'].includes(body.recurrence) ? body.recurrence : 'none',
    audience: body.audience === 'team' ? 'team' : 'individual',
    telegramChatId: body.telegramChatId ? String(body.telegramChatId).trim() : '',
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
