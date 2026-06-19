import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { verifyAdminToken } from '@/lib/auth'
import { AddGiftRequest, TelegramGift, TelegramBotGift, AvailableGiftsResponse } from '@/types/gifts'

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

// Admin endpoint to add a new gift
export async function POST(req: NextRequest) {
  try {
    // Check admin auth
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: AddGiftRequest = await req.json()
    const { telegramGiftUrl, winChance, priceInTon, name, isFragmentNft, fragmentUrl, fragmentSlug, categoryId } = body

    // Handle Fragment NFT gifts
    if (isFragmentNft && fragmentSlug) {
      console.log('🎁 [API] Adding Fragment NFT gift:', fragmentSlug)

      const imageUrl = `https://nft.fragment.com/gift/${fragmentSlug}.webp`
      const animationUrl = `https://nft.fragment.com/gift/${fragmentSlug}.tgs`

      // Create gift object for Fragment NFT
      const gift: Omit<TelegramGift, '_id'> = {
        giftId: fragmentSlug,
        giftSlug: fragmentSlug,
        telegramGiftUrl: fragmentUrl || `https://t.me/nft/${fragmentSlug}`,
        name: name || fragmentSlug,
        customImage: imageUrl,
        customAnimation: animationUrl,
        starCount: 0,
        winChance,
        priceInTon,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
        isFragmentNft: true,
        fragmentUrl: fragmentUrl,
        fragmentSlug: fragmentSlug,
        categoryId: categoryId || undefined,
      }

      // Save to database
      const result = await withDb(async (db) => {
        const giftsCollection = db.collection<TelegramGift>('gifts')
        return await giftsCollection.insertOne(gift as TelegramGift)
      })

      return NextResponse.json({
        success: true,
        giftId: result.insertedId,
        gift: { ...gift, _id: result.insertedId.toString() },
      })
    }

    // Validate input for regular gifts
    if (!telegramGiftUrl || winChance < 0 || winChance > 100 || priceInTon < 0) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    // Check for NFT URL (e.g., https://t.me/nft/SnoopDogg-18212)
    const nftMatch = telegramGiftUrl.match(/t\.me\/nft\/([^\/\?]+)/);

    if (nftMatch) {
      const nftId = nftMatch[1];
      console.log('🎁 [API] Detected NFT URL, ID:', nftId);

      const imageUrl = `https://nft.fragment.com/gift/${nftId}.large.jpg`;
      const animationUrl = `https://nft.fragment.com/gift/${nftId}.tgs`;

      // Create gift object for NFT
      const gift: Omit<TelegramGift, '_id'> = {
        giftId: nftId,
        giftSlug: nftId, // Store slug for Telegram link
        telegramGiftUrl: telegramGiftUrl, // Store original URL
        name: name || nftId, // Use provided name or ID as fallback
        customImage: imageUrl, // Direct URL for instant loading
        customAnimation: animationUrl, // Direct URL for instant loading
        starCount: 0, // Default for NFTs
        winChance,
        priceInTon,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
        categoryId: categoryId || undefined,
      };

      // Save to database
      const result = await withDb(async (db) => {
        const giftsCollection = db.collection<TelegramGift>('gifts');
        return await giftsCollection.insertOne(gift as TelegramGift);
      });

      return NextResponse.json({
        success: true,
        giftId: result.insertedId,
        gift: { ...gift, _id: result.insertedId.toString() },
      });
    }

    // Extract gift ID from Telegram URL or use directly
    // Official Telegram gifts use numeric IDs (e.g., 5879737836550226478)
    let giftId: string
    try {
      // Try to extract numeric ID from various formats
      const numericMatch = telegramGiftUrl.match(/(\d{10,})/)
      if (numericMatch) {
        giftId = numericMatch[1]
      } else {
        // Use input directly (should be numeric gift ID)
        giftId = telegramGiftUrl.trim()
      }
      console.log('🎁 [API] Extracted gift ID:', giftId, 'from:', telegramGiftUrl)
    } catch (error) {
      console.error('🎁 [API] Failed to extract gift ID:', error)
      return NextResponse.json({ error: 'Invalid gift ID. Use numeric gift ID from Telegram Bot API (e.g., 5879737836550226478)' }, { status: 400 })
    }

    console.log('🎁 [API] Fetching gift from Telegram Bot API, gift ID:', giftId)

    // Fetch available gifts from official Telegram Bot API
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.error('🎁 [API] Missing TELEGRAM_BOT_TOKEN')
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 })
    }

    const botApiUrl = `https://api.telegram.org/bot${botToken}/getAvailableGifts`
    console.log('🎁 [API] Calling Telegram Bot API...')

    const botApiResponse = await fetch(botApiUrl, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!botApiResponse.ok) {
      console.error('🎁 [API] Bot API error:', botApiResponse.status, botApiResponse.statusText)
      return NextResponse.json(
        { error: 'Failed to fetch gifts from Telegram Bot API' },
        { status: 400 }
      )
    }

    const botApiData: AvailableGiftsResponse = await botApiResponse.json()
    console.log('🎁 [API] Bot API response:', JSON.stringify(botApiData, null, 2))

    if (!botApiData.ok || !botApiData.result?.gifts) {
      console.error('🎁 [API] Invalid Bot API response structure')
      return NextResponse.json(
        { error: 'Invalid response from Telegram Bot API' },
        { status: 400 }
      )
    }

    // Find the specific gift by ID
    const selectedGift = botApiData.result.gifts.find((g: TelegramBotGift) => g.id === giftId)
    if (!selectedGift) {
      console.error('🎁 [API] Gift not found:', giftId)
      return NextResponse.json(
        { error: 'Gift not found in available gifts' },
        { status: 404 }
      )
    }

    console.log('🎁 [API] Selected gift:', JSON.stringify(selectedGift, null, 2))

    // Prepare gift name from sticker metadata or use provided name
    let giftName = name || `Telegram Gift (${selectedGift.star_count} ⭐)`
    if (!name) {
      if (selectedGift.sticker.set_name) {
        // Use sticker set name and format it nicely
        giftName = selectedGift.sticker.set_name.replace(/_/g, ' ')
        if (selectedGift.sticker.emoji) {
          giftName = `${selectedGift.sticker.emoji} ${giftName}`
        }
      } else if (selectedGift.sticker.emoji) {
        giftName = `${selectedGift.sticker.emoji} Gift (${selectedGift.star_count} ⭐)`
      }
    }

    // Fetch and cache direct URLs for fast loading
    let thumbnailUrl: string | undefined
    let cachedAnimationUrl: string | undefined

    try {
      // Fetch thumbnail URL
      if (selectedGift.sticker.thumbnail?.file_id) {
        console.log('🎁 [API] Fetching thumbnail URL...')
        const thumbResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${selectedGift.sticker.thumbnail.file_id}`)
        const thumbData = await thumbResponse.json()
        if (thumbData.ok && thumbData.result?.file_path) {
          thumbnailUrl = `https://api.telegram.org/file/bot${botToken}/${thumbData.result.file_path}`
          console.log('🎁 [API] ✅ Thumbnail URL cached')
        }
      }

      // Fetch animation URL
      if (selectedGift.sticker.file_id) {
        console.log('🎁 [API] Fetching animation URL...')
        const animResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${selectedGift.sticker.file_id}`)
        const animData = await animResponse.json()
        if (animData.ok && animData.result?.file_path) {
          cachedAnimationUrl = `https://api.telegram.org/file/bot${botToken}/${animData.result.file_path}`
          console.log('🎁 [API] ✅ Animation URL cached')
        }
      }
    } catch (error) {
      console.error('🎁 [API] Error caching URLs:', error)
      // Continue without cached URLs - will fetch on demand
    }

    // Prepare gift data using official Telegram structure
    const gift: Omit<TelegramGift, '_id'> = {
      giftId: selectedGift.id,
      giftSlug: selectedGift.id, // Use giftId as slug for official gifts
      telegramGiftUrl: telegramGiftUrl, // Store original URL
      sticker: selectedGift.sticker,
      thumbnailUrl, // Cache direct URL for fast loading
      animationUrl: cachedAnimationUrl, // Cache direct URL for fast loading
      starCount: selectedGift.star_count,
      name: giftName,
      winChance,
      priceInTon,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      categoryId: categoryId || undefined,
    }

    console.log('🎁 Gift object to save:', {
      giftId: gift.giftId,
      name: gift.name,
      starCount: gift.starCount,
      hasSticker: !!gift.sticker,
      stickerFileId: gift.sticker?.file_id,
      isAnimated: gift.sticker?.is_animated,
      isVideo: gift.sticker?.is_video,
    })

    // Save to database
    const result = await withDb(async (db) => {
      const giftsCollection = db.collection<TelegramGift>('gifts')
      console.log('🎁 [DB] Inserting gift into collection "gifts":', {
        giftId: gift.giftId,
        name: gift.name,
        starCount: gift.starCount,
        isActive: gift.isActive,
      })
      const insertResult = await giftsCollection.insertOne(gift as TelegramGift)
      console.log('🎁 [DB] Gift inserted successfully:', insertResult.insertedId)

      // Verify it was saved
      const savedGift = await giftsCollection.findOne({ _id: insertResult.insertedId })
      console.log('🎁 [DB] Verification - Gift found in DB:', !!savedGift)

      return insertResult
    })

    return NextResponse.json({
      success: true,
      giftId: result.insertedId,
      gift: { ...gift, _id: result.insertedId.toString() },
    })
  } catch (error) {
    console.error('Error adding gift:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Admin endpoint to get all gifts
export async function GET(req: NextRequest) {
  try {
    // Check admin auth
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gifts = await withDb(async (db) => {
      const giftsCollection = db.collection<TelegramGift>('gifts')
      return await giftsCollection.find({}).sort({ createdAt: -1 }).toArray()
    })

    return NextResponse.json({ gifts })
  } catch (error) {
    console.error('Error fetching gifts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Admin endpoint to delete a gift
export async function DELETE(req: NextRequest) {
  try {
    // Check admin auth
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const giftId = searchParams.get('id')

    if (!giftId) {
      return NextResponse.json({ error: 'Gift ID required' }, { status: 400 })
    }

    const result = await withDb(async (db) => {
      const giftsCollection = db.collection<TelegramGift>('gifts')
      return await giftsCollection.deleteOne({ _id: new ObjectId(giftId) as any })
    })

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Gift not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting gift:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Admin endpoint to update a gift
export async function PATCH(req: NextRequest) {
  try {
    // Check admin auth
    const admin = await requireAdmin()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { giftId, winChance, priceInTon, isActive, categoryId } = body

    if (!giftId) {
      return NextResponse.json({ error: 'Gift ID required' }, { status: 400 })
    }

    const updateData: Partial<TelegramGift> = {
      updatedAt: new Date(),
    }

    if (winChance !== undefined) updateData.winChance = winChance
    if (priceInTon !== undefined) updateData.priceInTon = priceInTon
    if (isActive !== undefined) updateData.isActive = isActive
    // Handle categoryId - can be set to null to unassign
    if (categoryId !== undefined) updateData.categoryId = categoryId || undefined

    const result = await withDb(async (db) => {
      const giftsCollection = db.collection<TelegramGift>('gifts')
      return await giftsCollection.updateOne(
        { _id: new ObjectId(giftId) as any },
        { $set: updateData }
      )
    })

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Gift not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating gift:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
