import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function run() {
  const uri = process.env.MONGODB_URI
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db('vivatbet')
  
  // Wipe just to be 100% sure we don't have bad nulls
  const res = await db.collection('userPhotoCache').deleteMany({})
  console.log('Cleared DB Cache:', res.deletedCount)

  await client.close()
}
run().catch(console.error)
