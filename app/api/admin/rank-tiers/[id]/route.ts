import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const db = await getDb()
    
    const updateData: any = {
      updatedAt: new Date()
    }
    
    if (body.name !== undefined) updateData.name = body.name
    if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl
    if (body.requiredTokens !== undefined) updateData.requiredTokens = Number(body.requiredTokens)
    if (body.order !== undefined) updateData.order = Number(body.order)
    if (body.color !== undefined) updateData.color = body.color
    if (body.benefits !== undefined) updateData.benefits = body.benefits
    if (body.active !== undefined) updateData.active = body.active
    
    const result = await db.collection('rankTiers').updateOne(
      { _id: new ObjectId(params.id) },
      { $set: updateData }
    )
    
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Rank tier not found' },
        { status: 404 }
      )
    }
    
    const updatedTier = await db.collection('rankTiers').findOne({ _id: new ObjectId(params.id) })
    
    return NextResponse.json(updatedTier)
  } catch (error) {
    console.error('Error updating rank tier:', error)
    return NextResponse.json(
      { error: 'Failed to update rank tier' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    
    const result = await db.collection('rankTiers').deleteOne({ _id: new ObjectId(params.id) })
    
    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Rank tier not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ message: 'Rank tier deleted successfully' })
  } catch (error) {
    console.error('Error deleting rank tier:', error)
    return NextResponse.json(
      { error: 'Failed to delete rank tier' },
      { status: 500 }
    )
  }
}
