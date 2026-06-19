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

// GET all payment methods
export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const paymentMethods = await withDb(async (db) => {
      return await db.collection('paymentMethods')
        .find({})
        .sort({ createdAt: -1 })
        .toArray()
    })

    return NextResponse.json({ paymentMethods })
  } catch (error: any) {
    console.error('Get payment methods error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payment methods' },
      { status: 500 }
    )
  }
}

// POST create new payment method
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { name, type, details, isActive } = body

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      )
    }

    const paymentMethod = {
      name,
      type, // 'bank', 'crypto', 'mobile_money', 'other'
      details: details || {},
      isActive: isActive !== undefined ? isActive : true,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const result = await withDb(async (db) => {
      return await db.collection('paymentMethods').insertOne(paymentMethod)
    })

    return NextResponse.json({ 
      success: true,
      paymentMethod: { ...paymentMethod, _id: result.insertedId }
    })
  } catch (error: any) {
    console.error('Create payment method error:', error)
    return NextResponse.json(
      { error: 'Failed to create payment method' },
      { status: 500 }
    )
  }
}
