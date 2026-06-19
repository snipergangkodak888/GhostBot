const { MongoClient } = require('mongodb')
async function run() {
  const client = new MongoClient('mongodb://localhost:27017')
  try {
    await client.connect()
    const db = client.db('testdb')
    const col = db.collection('testcol')
    await col.deleteMany({})
    try {
      await col.updateOne({ id: 1 }, {
        $set: { x: 1 },
        $setOnInsert: { energy: 100 },
        $inc: { energy: 10 }
      }, { upsert: true })
      console.log('Success')
    } catch(e) {
      console.log('Error:', e.message)
    }
  } finally {
    await client.close()
  }
}
run()
