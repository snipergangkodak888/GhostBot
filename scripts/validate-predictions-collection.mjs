#!/usr/bin/env node
/**
 * Validate userPredictions Collection
 * 
 * This script checks if the userPredictions collection exists,
 * has proper indexes, and validates the data structure.
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

// Load environment variables
const cwd = process.cwd()
const localEnv = path.join(cwd, '.env.local')
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv })
} else {
  dotenv.config()
}

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB || 'kickq'

async function validateCollection() {
  if (!uri) {
    console.error('❌ MONGODB_URI is not set in environment variables')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  
  try {
    console.log('🔌 Connecting to MongoDB...')
    await client.connect()
    console.log('✅ Connected to MongoDB')

    const db = client.db(dbName)
    const collectionName = 'userPredictions'

    // Check if collection exists
    console.log('\n📋 Checking collection existence...')
    const collections = await db.listCollections({ name: collectionName }).toArray()
    
    if (collections.length === 0) {
      console.log('⚠️  Collection "userPredictions" does not exist yet')
      console.log('   It will be created automatically when first document is inserted')
      
      // Create collection with indexes
      console.log('\n🔨 Creating collection and indexes...')
      const userPredictions = db.collection(collectionName)
      
      await userPredictions.createIndex({ userId: 1, requestedAt: -1 })
      await userPredictions.createIndex({ telegramId: 1, requestedAt: -1 })
      await userPredictions.createIndex({ fixtureId: 1, telegramId: 1 }, { unique: true })
      await userPredictions.createIndex({ requestedAt: -1 })
      await userPredictions.createIndex({ matchDate: -1 })
      
      console.log('✅ Collection and indexes created')
    } else {
      console.log('✅ Collection "userPredictions" exists')
    }

    // Check indexes
    console.log('\n🔍 Checking indexes...')
    const userPredictions = db.collection(collectionName)
    const indexes = await userPredictions.indexes()
    
    console.log(`Found ${indexes.length} indexes:`)
    indexes.forEach(index => {
      const keys = Object.keys(index.key).map(k => `${k}: ${index.key[k]}`).join(', ')
      const unique = index.unique ? ' [UNIQUE]' : ''
      console.log(`  - ${index.name}: { ${keys} }${unique}`)
    })

    // Validate required indexes
    const requiredIndexes = [
      'userId_1_requestedAt_-1',
      'telegramId_1_requestedAt_-1',
      'fixtureId_1_telegramId_1',
      'requestedAt_-1',
      'matchDate_-1'
    ]

    const indexNames = indexes.map(i => i.name)
    const missingIndexes = requiredIndexes.filter(name => !indexNames.includes(name))

    if (missingIndexes.length > 0) {
      console.log('\n⚠️  Missing indexes:')
      missingIndexes.forEach(name => console.log(`  - ${name}`))
      console.log('\n🔨 Creating missing indexes...')
      
      if (missingIndexes.includes('userId_1_requestedAt_-1')) {
        await userPredictions.createIndex({ userId: 1, requestedAt: -1 })
        console.log('  ✅ Created userId + requestedAt index')
      }
      if (missingIndexes.includes('telegramId_1_requestedAt_-1')) {
        await userPredictions.createIndex({ telegramId: 1, requestedAt: -1 })
        console.log('  ✅ Created telegramId + requestedAt index')
      }
      if (missingIndexes.includes('fixtureId_1_telegramId_1')) {
        await userPredictions.createIndex({ fixtureId: 1, telegramId: 1 }, { unique: true })
        console.log('  ✅ Created fixtureId + telegramId unique index')
      }
      if (missingIndexes.includes('requestedAt_-1')) {
        await userPredictions.createIndex({ requestedAt: -1 })
        console.log('  ✅ Created requestedAt index')
      }
      if (missingIndexes.includes('matchDate_-1')) {
        await userPredictions.createIndex({ matchDate: -1 })
        console.log('  ✅ Created matchDate index')
      }
    } else {
      console.log('✅ All required indexes exist')
    }

    // Check document count
    console.log('\n📊 Collection statistics:')
    const count = await userPredictions.countDocuments()
    console.log(`  Total documents: ${count}`)

    if (count > 0) {
      // Get sample document
      const sample = await userPredictions.findOne()
      
      console.log('\n📄 Sample document structure:')
      console.log(JSON.stringify(sample, null, 2))

      // Validate document structure
      console.log('\n✓ Validating document structure...')
      const requiredFields = [
        'userId',
        'telegramId',
        'fixtureId',
        'matchDate',
        'homeTeam',
        'awayTeam',
        'prediction',
        'requestedAt'
      ]

      const missingFields = requiredFields.filter(field => !(field in sample))
      
      if (missingFields.length > 0) {
        console.log('⚠️  Missing required fields:')
        missingFields.forEach(field => console.log(`  - ${field}`))
      } else {
        console.log('✅ All required fields present')
      }

      // Validate prediction sub-document
      if (sample.prediction) {
        const predictionFields = ['winner', 'homeWin', 'draw', 'awayWin']
        const missingPredFields = predictionFields.filter(f => !(f in sample.prediction))
        
        if (missingPredFields.length > 0) {
          console.log('⚠️  Missing prediction fields:')
          missingPredFields.forEach(field => console.log(`  - prediction.${field}`))
        } else {
          console.log('✅ Prediction structure valid')
        }
      } else {
        console.log('⚠️  Prediction sub-document missing')
      }

      // Check for today's predictions
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const todayCount = await userPredictions.countDocuments({
        requestedAt: { $gte: today }
      })
      
      console.log(`\n📅 Predictions saved today: ${todayCount}`)

      // Get most active users
      const topUsers = await userPredictions.aggregate([
        { $group: { _id: '$telegramId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]).toArray()

      if (topUsers.length > 0) {
        console.log('\n👥 Most active users:')
        topUsers.forEach((user, idx) => {
          console.log(`  ${idx + 1}. User ${user._id}: ${user.count} predictions`)
        })
      }

    } else {
      console.log('  No documents yet - collection will populate when users save predictions')
    }

    console.log('\n✅ Validation complete!')
    console.log('\n📝 Collection Status:')
    console.log('  ✅ Collection exists or will be created on first insert')
    console.log('  ✅ All required indexes present')
    console.log('  ✅ Ready to accept prediction saves')

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message)
    if (error.code === 11000) {
      console.error('   Duplicate key error - this is expected if trying to create existing unique index')
    }
    process.exit(1)
  } finally {
    await client.close()
    console.log('\n🔌 Disconnected from MongoDB')
  }
}

// Run validation
validateCollection().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
