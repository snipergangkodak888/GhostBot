import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// PATCH update payment method
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { name, type, details, isActive } = body
    const { id } = params

    if (!ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid payment method ID' },
        { status: 400 }
      )
    }

    const updateFields: any = {
      updatedAt: new Date()
    }

    if (name) updateFields.name = name
    if (type) updateFields.type = type
    if (details !== undefined) updateFields.details = details
    if (isActive !== undefined) updateFields.isActive = isActive

    const result = await withDb(async (db) => {
      return await db.collection('paymentMethods').findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateFields },
        { returnDocument: 'after' }
      )
    })

    if (!result) {
      return NextResponse.json(
        { error: 'Payment method not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ 
      success: true,
      paymentMethod: result
    })
  } catch (error: any) {
    console.error('Update payment method error:', error)
    return NextResponse.json(
      { error: 'Failed to update payment method' },
      { status: 500 }
    )
  }
}

// DELETE payment method
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = params

    if (!ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid payment method ID' },
        { status: 400 }
      )
    }

    const result = await withDb(async (db) => {
      return await db.collection('paymentMethods').deleteOne({
        _id: new ObjectId(id)
      })
    })

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Payment method not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete payment method error:', error)
    return NextResponse.json(
      { error: 'Failed to delete payment method' },
      { status: 500 }
    )
  }
}
