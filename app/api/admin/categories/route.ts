import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ObjectId } from '@/lib/object-id'
import { withDb } from '@/lib/db'
import { verifyAdminToken } from '@/lib/auth'
import { GiftCategory, CreateCategoryRequest, UpdateCategoryRequest } from '@/types/category'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    const payload = await verifyAdminToken(token)
    return payload
  } catch {
    return null
  }
}

// Helper to create URL-friendly slug
function createSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// GET - Fetch all categories
export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const categories = await withDb(async (db) => {
      return await db.collection<GiftCategory>('categories')
        .find({})
        .sort({ order: 1, createdAt: -1 })
        .toArray()
    })

    return NextResponse.json({ success: true, categories })
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

// POST - Create new category
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { name, description, iconUrl, order, spinsPerSpin, goodLuckWeight } = body

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 })
    }
    if (!spinsPerSpin || spinsPerSpin < 1) {
      return NextResponse.json({ error: 'Spins per spin must be at least 1' }, { status: 400 })
    }

    const slug = createSlug(name)

    // Check for duplicate slug
    const existing = await withDb(async (db) => {
      return await db.collection<GiftCategory>('categories').findOne({ slug })
    })

    if (existing) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 400 })
    }

    // Get max order if not provided
    let finalOrder = order
    if (finalOrder === undefined) {
      const maxOrder = await withDb(async (db) => {
        const maxCat = await db.collection<GiftCategory>('categories')
          .findOne({}, { sort: { order: -1 } })
        return maxCat?.order ?? -1
      })
      finalOrder = maxOrder + 1
    }

    const category: Omit<GiftCategory, '_id'> = {
      name: name.trim(),
      slug,
      description: description?.trim() || '',
      iconUrl: iconUrl?.trim() || '',
      order: finalOrder,
      spinsPerSpin,
      goodLuckWeight: typeof goodLuckWeight === 'number' ? goodLuckWeight : 20,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await withDb(async (db) => {
      return await db.collection<GiftCategory>('categories').insertOne(category as GiftCategory)
    })

    return NextResponse.json({
      success: true,
      category: { ...category, _id: result.insertedId.toString() },
    })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}

// PATCH - Update category
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: UpdateCategoryRequest = await req.json()
    const { categoryId, ...updates } = body

    if (!categoryId) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 })
    }

    // Build update object
    const updateFields: Partial<GiftCategory> = {
      updatedAt: new Date(),
    }

    if (updates.name !== undefined) {
      updateFields.name = updates.name.trim()
      updateFields.slug = createSlug(updates.name)
    }
    if (updates.description !== undefined) {
      updateFields.description = updates.description.trim()
    }
    if (updates.iconUrl !== undefined) {
      updateFields.iconUrl = updates.iconUrl.trim()
    }
    if (updates.order !== undefined) {
      updateFields.order = updates.order
    }
    if (updates.spinsPerSpin !== undefined) {
      updateFields.spinsPerSpin = updates.spinsPerSpin
    }
    if (updates.goodLuckWeight !== undefined) {
      updateFields.goodLuckWeight = updates.goodLuckWeight
    }
    if (updates.isActive !== undefined) {
      updateFields.isActive = updates.isActive
    }

    const result = await withDb(async (db) => {
      return await db.collection<GiftCategory>('categories').updateOne(
        { _id: new ObjectId(categoryId) },
        { $set: updateFields }
      )
    })

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating category:', error)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

// DELETE - Delete category
export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('id')

    if (!categoryId) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 })
    }

    // Check if any gifts are using this category
    const giftsCount = await withDb(async (db) => {
      return await db.collection('gifts').countDocuments({ categoryId })
    })

    if (giftsCount > 0) {
      return NextResponse.json({ 
        error: `Cannot delete category: ${giftsCount} gift(s) are assigned to it. Remove gifts from this category first.` 
      }, { status: 400 })
    }

    const result = await withDb(async (db) => {
      return await db.collection<GiftCategory>('categories').deleteOne({
        _id: new ObjectId(categoryId)
      })
    })

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting category:', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
