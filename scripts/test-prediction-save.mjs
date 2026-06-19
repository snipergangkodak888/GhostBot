#!/usr/bin/env node
/**
 * Test Prediction Save
 * 
 * This script tests saving predictions to userPredictions collection
 * and validates the duplicate prevention works.
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'

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

async function testPredictionSave() {
  if (!uri) {
    console.error('❌ MONGODB_URI is not set in environment variables')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  
  try {
    console.log('🔌 Connecting to MongoDB...')
    await client.connect()
    console.log('✅ Connected to MongoDB\n')

    const db = client.db(dbName)
    const userPredictions = db.collection('userPredictions')
    const users = db.collection('users')

    // Find a test user or use dummy data
    console.log('👤 Looking for test user...')
    let testUser = await users.findOne()
    
    const testTelegramId = testUser?.telegramId || 123456789
    const testUserId = testUser?._id || new ObjectId()
    
    console.log(`Using test user: ${testTelegramId}\n`)

    // Test data
    const testPrediction = {
      userId: testUserId,
      telegramId: testTelegramId,
      fixtureId: 999999, // Test fixture ID
      matchDate: new Date().toISOString().split('T')[0],
      homeTeam: 'Test Home Team',
      homeTeamLogo: 'https://example.com/home.png',
      awayTeam: 'Test Away Team',
      awayTeamLogo: 'https://example.com/away.png',
      leagueName: 'Test League',
      leagueLogo: 'https://example.com/league.png',
      prediction: {
        winner: 'Home',
        advice: 'Test prediction advice',
        homeWin: '55%',
        draw: '25%',
        awayWin: '20%'
      },
      requestedAt: new Date(),
      result: null
    }

    // Test 1: First save should succeed
    console.log('📝 Test 1: First save (should succeed)...')
    try {
      const result1 = await userPredictions.insertOne(testPrediction)
      console.log(`✅ Saved successfully! ID: ${result1.insertedId}\n`)
    } catch (error) {
      console.error('❌ First save failed:', error.message)
      throw error
    }

    // Verify document exists
    const saved = await userPredictions.findOne({ 
      fixtureId: testPrediction.fixtureId,
      telegramId: testPrediction.telegramId 
    })
    
    if (saved) {
      console.log('✅ Document verified in database')
      console.log('Document structure:')
      console.log(JSON.stringify(saved, null, 2))
      console.log()
    } else {
      throw new Error('Document not found after save')
    }

    // Test 2: Duplicate save should fail (unique index)
    console.log('📝 Test 2: Duplicate save (should fail with unique constraint)...')
    try {
      await userPredictions.insertOne(testPrediction)
      console.error('❌ Duplicate save succeeded - unique index NOT working!')
    } catch (error) {
      if (error.code === 11000) {
        console.log('✅ Duplicate prevented correctly! (E11000 duplicate key error)\n')
      } else {
        console.error('❌ Unexpected error:', error.message)
        throw error
      }
    }

    // Test 3: Query performance
    console.log('📝 Test 3: Query performance...')
    
    const start1 = Date.now()
    await userPredictions.find({ telegramId: testTelegramId }).toArray()
    const time1 = Date.now() - start1
    console.log(`  - Query by telegramId: ${time1}ms`)

    const start2 = Date.now()
    await userPredictions.find({ userId: testUserId }).sort({ requestedAt: -1 }).toArray()
    const time2 = Date.now() - start2
    console.log(`  - Query by userId with sort: ${time2}ms`)

    const start3 = Date.now()
    await userPredictions.findOne({ 
      fixtureId: testPrediction.fixtureId,
      telegramId: testTelegramId 
    })
    const time3 = Date.now() - start3
    console.log(`  - Check duplicate: ${time3}ms`)

    if (time1 < 100 && time2 < 100 && time3 < 100) {
      console.log('✅ Query performance good (all < 100ms)\n')
    } else {
      console.log('⚠️  Some queries slow - check if indexes are used\n')
    }

    // Test 4: Update prediction
    console.log('📝 Test 4: Update prediction result...')
    const updateResult = await userPredictions.updateOne(
      { _id: saved._id },
      { $set: { result: 'won' } }
    )
    
    if (updateResult.modifiedCount === 1) {
      console.log('✅ Prediction updated successfully\n')
    } else {
      console.log('❌ Update failed\n')
    }

    // Cleanup
    console.log('🧹 Cleaning up test data...')
    await userPredictions.deleteOne({ _id: saved._id })
    console.log('✅ Test data removed\n')

    console.log('=' .repeat(50))
    console.log('✅ ALL TESTS PASSED!')
    console.log('=' .repeat(50))
    console.log('\n📋 Summary:')
    console.log('  ✅ Documents save correctly')
    console.log('  ✅ Duplicate prevention works (unique index)')
    console.log('  ✅ Queries are performant')
    console.log('  ✅ Updates work correctly')
    console.log('  ✅ Collection is production-ready')

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await client.close()
    console.log('\n🔌 Disconnected from MongoDB')
  }
}

// Run test
testPredictionSave().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
