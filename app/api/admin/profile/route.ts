import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { verifyAdminToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { ObjectId } from '@/lib/object-id'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// GET – return current admin email (no password)
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const doc = await db.collection('admins').findOne(
    { _id: new ObjectId(admin.sub) },
    { projection: { email: 1 } }
  )
  if (!doc) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
  return NextResponse.json({ email: doc.email })
}

// PATCH – update email and/or password
export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { currentPassword, newEmail, newPassword } = await req.json()

    if (!currentPassword) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
    }
    if (!newEmail && !newPassword) {
      return NextResponse.json({ error: 'Provide a new email or password' }, { status: 400 })
    }

    const db = await getDb()
    const doc = await db.collection('admins').findOne({ _id: new ObjectId(admin.sub) })
    if (!doc) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, doc.password)
    if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })

    // Check new email uniqueness
    if (newEmail && newEmail !== doc.email) {
      const exists = await db.collection('admins').findOne({ email: newEmail, _id: { $ne: new ObjectId(admin.sub) } })
      if (exists) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }

    const updates: Record<string, string> = {}
    if (newEmail) updates.email = newEmail.trim().toLowerCase()
    if (newPassword) {
      if (newPassword.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
      updates.password = await bcrypt.hash(newPassword, 10)
    }

    await db.collection('admins').updateOne({ _id: new ObjectId(admin.sub) }, { $set: { ...updates, updatedAt: new Date() } })

    return NextResponse.json({ ok: true, emailChanged: !!newEmail, passwordChanged: !!newPassword })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Update failed' }, { status: 500 })
  }
}
