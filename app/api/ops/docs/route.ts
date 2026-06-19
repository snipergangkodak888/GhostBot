import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim()
    const db = await getDb()
    const docs = await db.collection('opsDocs').find({}).sort({ updatedAt: -1 }).toArray()
    const filtered = q
      ? docs.filter((doc: any) => `${doc.title} ${doc.category} ${doc.body}`.toLowerCase().includes(q.toLowerCase()))
      : docs
    return NextResponse.json(filtered)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const doc = {
    title,
    category: String(body.category || 'Ghost Bible').trim(),
    body: String(body.body || '').trim(),
    source: String(body.source || 'manual').trim(),
    updatedAt: new Date(),
    createdAt: new Date(),
  }
  if (!title || !doc.body) return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
  const db = await getDb()
  const result = await db.collection('opsDocs').insertOne(doc)
  return NextResponse.json({ doc: { ...doc, _id: result.insertedId } })
}
