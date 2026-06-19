import { NextResponse } from 'next/server'
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    const payload = await req.json()
    
    // Remove _id from payload to prevent it from being updated
    const { _id, ...updateData } = payload
    
    const result = await db.collection('plans').updateOne(
      { _id: new ObjectId(params.id) },
      { 
        $set: { 
          ...updateData, 
          updatedAt: new Date() 
        } 
      }
    )
    
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error updating plan:', error)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    
    const result = await db.collection('plans').deleteOne({ _id: new ObjectId(params.id) })
    
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting plan:', error)
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 })
  }
}
