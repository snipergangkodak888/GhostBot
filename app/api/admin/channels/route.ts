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

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    const channels = await db.collection('channels').find({}).sort({ createdAt: -1 }).toArray()
    return NextResponse.json({ channels })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, chatId, isActive } = body
    
    if (!name || !chatId) {
      return NextResponse.json({ error: 'Name and Chat ID are required' }, { status: 400 })
    }

    const db = await getDb()
    const newChannel = {
      name,
      chatId,
      isActive: isActive ?? true,
      createdAt: new Date()
    }
    
    const res = await db.collection('channels').insertOne(newChannel)
    return NextResponse.json({ channel: { ...newChannel, _id: res.insertedId } })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { _id, name, chatId, isActive } = body
    
    if (!_id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const db = await getDb()
    const update: any = {}
    if (name !== undefined) update.name = name
    if (chatId !== undefined) update.chatId = chatId
    if (isActive !== undefined) update.isActive = isActive

    await db.collection('channels').updateOne(
      { _id: new ObjectId(_id) },
      { $set: update }
    )
    
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const db = await getDb()
    await db.collection('channels').deleteOne({ _id: new ObjectId(id) })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 })
  }
}
