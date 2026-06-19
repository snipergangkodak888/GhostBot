import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  try {
    const db = await getDb()
    const col = db.collection('userPhotoCache')
    const result = await col.deleteMany({})
    return NextResponse.json({ success: true, deleted: result.deletedCount })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
