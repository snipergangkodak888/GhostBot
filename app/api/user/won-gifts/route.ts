import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Fetch user's won gifts collection
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const wonGifts = await withDb(async (db) => {
      const wonGiftsCollection = db.collection('wonGifts')
      
      const gifts = await wonGiftsCollection
        .find({ userId: new ObjectId(user.id) })
        .sort({ wonAt: -1 })
        .toArray()

      return gifts
    })

    return NextResponse.json({ wonGifts })
  } catch (error) {
    console.error('Error fetching won gifts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch won gifts' },
      { status: 500 }
    )
  }
}

// POST - Save a won gift to user's collection
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { gift } = body

    if (!gift || !gift.giftId) {
      return NextResponse.json(
        { error: 'Invalid gift data' },
        { status: 400 }
      )
    }

    const result = await withDb(async (db) => {
      const wonGiftsCollection = db.collection('wonGifts')
      const referralsCollection = db.collection('referrals')
      const userSpinsCollection = db.collection('userSpins')
      const settingsCollection = db.collection('settings')
      
      const wonGift = {
        userId: new ObjectId(user.id),
        gift,
        wonAt: new Date(),
        createdAt: new Date()
      }

      const insertResult = await wonGiftsCollection.insertOne(wonGift)

      // Process referral commission if enabled
      try {
        // Get referral settings
        const referralSettingsDoc = await settingsCollection.findOne({ key: 'referralSettings' })
        const referralSettings = referralSettingsDoc?.value || {}
        
        if (referralSettings.commissionEnabled === true && referralSettings.spinPercentage > 0) {
          // Check if this user was referred by someone
          const referral = await referralsCollection.findOne({ referredId: user.telegramId })
          
          if (referral && referral.referrerId) {
            // Calculate commission (percentage of 1 spin)
            const commissionSpins = Math.max(1, Math.round(referralSettings.spinPercentage / 100))
            
            // Award spins to referrer
            await userSpinsCollection.updateOne(
              { telegramId: referral.referrerId },
              { 
                $inc: { 
                  totalSpins: commissionSpins,
                  total: commissionSpins,
                  referrals: commissionSpins 
                },
                $set: { updatedAt: new Date() }
              },
              { upsert: true }
            )
            
            // Update the referral record with commission earned
            await referralsCollection.updateOne(
              { _id: referral._id },
              { 
                $inc: { bonusEarned: commissionSpins },
                $set: { updatedAt: new Date() }
              }
            )
            
            console.log('✅ Commission awarded:', { referrerId: referral.referrerId, spins: commissionSpins })
          }
        }
      } catch (commissionError) {
        console.error('⚠️ Error processing commission:', commissionError)
        // Don't fail the gift save if commission fails
      }

      return {
        _id: insertResult.insertedId,
        ...wonGift
      }
    })

    return NextResponse.json({ 
      success: true,
      wonGift: result 
    })
  } catch (error) {
    console.error('Error saving won gift:', error)
    return NextResponse.json(
      { error: 'Failed to save won gift' },
      { status: 500 }
    )
  }
}
