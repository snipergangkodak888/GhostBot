import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function run() {
  const uri = process.env.MONGODB_URI
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db('vivatbet')
  
  const count = await db.collection('userPhotoCache').countDocuments()
  const nullData = await db.collection('userPhotoCache').countDocuments({ photoData: null })
  const withData = await db.collection('userPhotoCache').countDocuments({ photoData: { $ne: null } })
  const withError = await db.collection('userPhotoCache').countDocuments({ isError: true })
  
  console.log(`Total: ${count}, With Data: ${withData}, Null Data: ${nullData}, Errors: ${withError}`)
  
  const sample = await db.collection('userPhotoCache').findOne({ isError: true })
  if (sample) console.log('Sample Error Doc:', sample)

  await client.close()
}
run().catch(console.error)
