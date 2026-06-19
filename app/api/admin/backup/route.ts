import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { verifyAdminToken } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function GET(req: Request) {
  try {
    const admin = await verifyAdminToken(cookies().get('admin_token')?.value || '')
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()

    const collections = await db.collections()
    const backupData: Record<string, any[]> = {}

    for (const collection of collections) {
      const name = collection.collectionName
      const docs = await collection.find({}).toArray()
      backupData[name] = docs
    }

    return new NextResponse(JSON.stringify(backupData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="database_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json"`
      }
    })
  } catch (error: any) {
    console.error('Backup Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to export backup' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const admin = await verifyAdminToken(cookies().get('admin_token')?.value || '')
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid backup payload format.' }, { status: 400 })
    }

    const db = await getDb()
    const currentCollections = await db.collections()
    const collectionNames = currentCollections.map((c: any) => c.collectionName)

    // Optional: We can drop all current data first?
    // It's safer to drop collections that are present in the backup, then insert.
    for (const [colName, docs] of Object.entries(body)) {
      if (!Array.isArray(docs)) continue; // skip invalid formats

      if (!collectionNames.includes(colName)) {
        await db.createCollection(colName);
      } else {
        await db.collection(colName).deleteMany({});
      }

      if (docs.length > 0) {
        const processedDocs = docs.map((doc: any) => {
          if (doc._id && typeof doc._id === 'string' && doc._id.length === 24) {
            try {
              doc._id = new ObjectId(doc._id);
            } catch(e) {}
          }
          // Note: fields like dates won't be proper Date objects anymore, just ISO strings. 
          // For generic backup/restores, this is a known limitation of JSON parsing unless we parse them recursively.
          // Since we might need dates:
          for (const key of Object.keys(doc)) {
              if (typeof doc[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(doc[key])) {
                  doc[key] = new Date(doc[key]);
              }
          }
          return doc;
        });

        await db.collection(colName).insertMany(processedDocs);
      }
    }

    return NextResponse.json({ success: true, message: 'Database imported successfully.' })
  } catch (error: any) {
    console.error('Import Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to import backup' }, { status: 500 })
  }
}
