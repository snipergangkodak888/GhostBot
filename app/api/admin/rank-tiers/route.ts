import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
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

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    
    const tiers = await db
      .collection('rankTiers')
      .find({})
      .sort({ order: 1 })
      .toArray()
    
    return NextResponse.json(tiers)
  } catch (error) {
    console.error('Error fetching rank tiers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rank tiers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    
    // Validate required fields
    if (!body.name || body.requiredTokens === undefined || body.order === undefined) {
      return NextResponse.json(
        { error: 'Name, requiredTokens, and order are required' },
        { status: 400 }
      )
    }
    
    const db = await getDb()
    
    const newTier = {
      tierId: `tier_${Date.now()}`,
      name: body.name,
      logoUrl: body.logoUrl || '',
      requiredTokens: Number(body.requiredTokens),
      order: Number(body.order),
      color: body.color || '#000000',
      benefits: body.benefits || [],
      active: body.active !== undefined ? body.active : true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const result = await db.collection('rankTiers').insertOne(newTier)
    
    return NextResponse.json(
      { ...newTier, _id: result.insertedId },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating rank tier:', error)
    return NextResponse.json(
      { error: 'Failed to create rank tier' },
      { status: 500 }
    )
  }
}
