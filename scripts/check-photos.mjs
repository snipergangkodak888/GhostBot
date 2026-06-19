import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
async function run() {
  const uri = process.env.MONGODB_URI
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db('vivatbet')
  const docs = await db.collection('userPhotoCache').find({}).limit(10).toArray()
  console.log(docs.map(d => ({ telegramId: d.telegramId, hasPhotoData: !!d.photoData, length: d.photoData?.length, cachedAt: d.cachedAt })))
  await client.close()
}
run().catch(console.dir)
