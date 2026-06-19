import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { ObjectId } from '@/lib/object-id'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = await getDb()
    const coupons = await db
      .collection('adminCoupons')
      .find({})
      .sort({ createdAt: -1 })
      .toArray()
    return NextResponse.json({ coupons })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json()
    const { code, description, maxRecipients, expiresAt, triggerLevel, type } = body
    if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

    const db = await getDb()

    const existing = await db.collection('adminCoupons').findOne({ code: code.toUpperCase().trim() })
    if (existing) return NextResponse.json({ error: 'Coupon code already exists' }, { status: 409 })

    const doc = {
      code: code.toUpperCase().trim(),
      description: description || '',
      // type: 'casino' | 'sports' | 'both' — determines which category the promo belongs to
      type: (type === 'casino' || type === 'sports') ? type : 'both',
      maxRecipients: maxRecipients ? Number(maxRecipients) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      // triggerLevel: auto-assign this coupon when a user reaches this merge level (null = manual only)
      triggerLevel: triggerLevel ? Number(triggerLevel) : null,
      active: true,
      usedCount: 0,
      recipients: [] as any[],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = await db.collection('adminCoupons').insertOne(doc)
    return NextResponse.json({ coupon: { ...doc, _id: result.insertedId } }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const db = await getDb()
    await db.collection('adminCoupons').updateOne(
      { _id: new ObjectId(id) },
      { $set: { active: false, updatedAt: new Date() } }
    )
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
