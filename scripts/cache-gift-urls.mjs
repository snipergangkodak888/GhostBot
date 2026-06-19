// Script to pre-cache thumbnail and animation URLs for all gifts
// This will fetch file URLs from Telegram and store them directly in the database
// for instant loading without API calls

import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!MONGODB_URI || !BOT_TOKEN) {
  console.error('❌ Missing environment variables')
  console.error('   Please set MONGODB_URI and TELEGRAM_BOT_TOKEN')
  console.error('   Usage: MONGODB_URI="..." TELEGRAM_BOT_TOKEN="..." node scripts/cache-gift-urls.mjs')
  process.exit(1)
}

async function fetchFileUrl(fileId) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
    const data = await response.json()
    
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`
    }
    return null
  } catch (error) {
    console.error('❌ Error fetching file URL:', error)
    return null
  }
}

async function cacheGiftUrls() {
  console.log('🎁 Starting gift URL caching...')
  
  const client = new MongoClient(MONGODB_URI)
  
  try {
    await client.connect()
    console.log('✅ Connected to MongoDB')
    
    const db = client.db('telegram-gifts')
    const giftsCollection = db.collection('gifts')
    
    const gifts = await giftsCollection.find({}).toArray()
    console.log(`📦 Found ${gifts.length} gifts to process`)
    
    let updated = 0
    let skipped = 0
    let errors = 0
    
    for (const gift of gifts) {
      console.log(`\n🔄 Processing: ${gift.name || gift.giftId}`)
      
      // Skip if URLs already cached
      if (gift.thumbnailUrl && gift.animationUrl) {
        console.log('   ⏭️  Already has cached URLs, skipping')
        skipped++
        continue
      }
      
      const updates = {}
      
      // Handle NFT gifts (Fragment)
      if (gift.customImage && gift.customAnimation) {
        console.log('   🖼️  NFT Gift - using custom URLs')
        updates.thumbnailUrl = gift.customImage
        updates.animationUrl = gift.customAnimation
      }
      // Handle Telegram gifts with sticker
      else if (gift.sticker) {
        console.log('   🎨 Telegram Gift - fetching sticker URLs')
        
        // Fetch thumbnail URL
        if (gift.sticker.thumbnail?.file_id && !gift.thumbnailUrl) {
          console.log('   📥 Fetching thumbnail URL...')
          const thumbnailUrl = await fetchFileUrl(gift.sticker.thumbnail.file_id)
          if (thumbnailUrl) {
            updates.thumbnailUrl = thumbnailUrl
            console.log('   ✅ Thumbnail URL cached')
          } else {
            console.log('   ⚠️  Failed to fetch thumbnail URL')
            errors++
          }
        }
        
        // Fetch animation URL
        if (gift.sticker.file_id && !gift.animationUrl) {
          console.log('   📥 Fetching animation URL...')
          const animationUrl = await fetchFileUrl(gift.sticker.file_id)
          if (animationUrl) {
            updates.animationUrl = animationUrl
            console.log('   ✅ Animation URL cached')
          } else {
            console.log('   ⚠️  Failed to fetch animation URL')
            errors++
          }
        }
      } else {
        console.log('   ⚠️  No sticker or custom image found')
        errors++
        continue
      }
      
      // Update database
      if (Object.keys(updates).length > 0) {
        await giftsCollection.updateOne(
          { _id: gift._id },
          { $set: updates }
        )
        console.log(`   💾 Updated ${Object.keys(updates).length} URL(s)`)
        updated++
      }
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log('\n' + '='.repeat(50))
    console.log('🎉 Gift URL caching complete!')
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ⏭️  Skipped: ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log('='.repeat(50))
    
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await client.close()
    console.log('👋 Disconnected from MongoDB')
  }
}

cacheGiftUrls()
