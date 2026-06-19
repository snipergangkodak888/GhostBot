import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { resolveUserTelegramId } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Get user profile with subscription and prediction balance
export async function GET(request: NextRequest) {
  try {
    const telegramId = await resolveUserTelegramId(request)

    if (!telegramId) {
      console.log('❌ Authentication failed - Invalid session')
      return NextResponse.json(
        { error: 'Not authenticated', details: 'Please login through Telegram' },
        { status: 401 }
      )
    }

    const userData = await withDb(async (db) => {
      const usersCollection = db.collection('users')
      
      // Look up by telegramId (live identity) rather than stale cookie ObjectId
      const user = await usersCollection.findOne({ telegramId })

      if (!user) {
        console.log('❌ User not found for telegramId:', telegramId)
        return null
      }

      // Extract document _id string so downstream code can still use ObjectId(userId)
      const userId = user._id.toString()

      console.log('✅ User authenticated:', user.firstName, user.lastName)
      const plansCollection = db.collection('plans')
      const subscriptionsCollection = db.collection('subscriptions')

      let subscription = null
      let plan = null

      // FIRST: Check if user has subscription embedded in users collection (NOWPayments webhook saves here)
      if (user.subscription) {
        const userSub = user.subscription
        // Check if it's active and not expired
        if (userSub.status === 'active' && new Date(userSub.expiresAt) > new Date()) {
          subscription = userSub
          plan = await plansCollection.findOne({ _id: new ObjectId(userSub.planId) })
          console.log('✅ Found active subscription in user document')
        } else if (userSub.status === 'active' && new Date(userSub.expiresAt) <= new Date()) {
          // Expired subscription - clear it
          await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { 'subscription.status': 'expired', updatedAt: new Date() } }
          )
          console.log(`⏰ Expired subscription in user document for user ${userId}`)
        }
      }

      // Track expired subscription for logging
      let expiredSubscription: any = null

      // SECOND: If no subscription in user document, check subscriptions collection (legacy)
      if (!subscription) {
        const activeSubscription = await subscriptionsCollection.findOne({
          userId: new ObjectId(userId),
          status: 'active',
          expiresAt: { $gt: new Date() }
        })

        // Check if user has an expired VIP subscription that needs cleanup
        expiredSubscription = await subscriptionsCollection.findOne({
          userId: new ObjectId(userId),
          status: 'active',
          expiresAt: { $lte: new Date() }
        })

        if (expiredSubscription) {
          // Mark expired subscription as expired (for record keeping)
          await subscriptionsCollection.updateOne(
            { _id: expiredSubscription._id },
            { 
              $set: { 
                status: 'expired',
                updatedAt: new Date()
              }
            }
          )
          console.log(`⏰ Expired VIP subscription in subscriptions collection for user ${userId}`)
        }

        if (activeSubscription) {
          subscription = activeSubscription
          plan = await plansCollection.findOne({ 
            _id: new ObjectId(activeSubscription.planId) 
          })
        }
      }
      
      if (!subscription) {
        // No active paid subscription - ensure default free plan exists and assign it
        let freePlan = await plansCollection.findOne({ 
          name: { $regex: /free/i } // Find plan with "free" in name (case insensitive)
        })
        
        // If no free plan exists, create one automatically
        if (!freePlan) {
          console.log('🆓 No free plan found, creating default free plan...')
          const defaultFreePlan = {
            name: 'Free Plan',
            price: 0,
            periodDays: 365, // 1 year (not used for free plan)
            duration: 365,
            dailyPredictionLimit: 5,
            predictionsPerDay: 5,
            unlimitedPredictions: false,
            allowRealTimePredictions: false,
            allowPredictionRefresh: false,
            features: ['5 predictions per day', 'Basic match predictions', 'League filters'],
            isPopular: false,
            isActive: true,
            order: 999, // Show last in the list
            createdAt: new Date(),
            updatedAt: new Date()
          }
          
          const result = await plansCollection.insertOne(defaultFreePlan)
          freePlan = { ...defaultFreePlan, _id: result.insertedId }
          console.log('✅ Default free plan created:', result.insertedId)
        }
        
        if (freePlan) {
          // Check if user already has a free plan subscription
          const existingFreeSub = await subscriptionsCollection.findOne({
            userId: new ObjectId(userId),
            planId: freePlan._id
          })

          if (!existingFreeSub) {
            // Create free plan subscription with no expiration (100 years from now)
            const noExpiration = new Date()
            noExpiration.setFullYear(noExpiration.getFullYear() + 100)
            
            const freeSub = {
              userId: new ObjectId(userId),
              planId: freePlan._id,
              planName: freePlan.name,
              status: 'active',
              expiresAt: noExpiration,
              createdAt: new Date(),
              updatedAt: new Date()
            }
            
            await subscriptionsCollection.insertOne(freeSub)
            subscription = freeSub
            plan = freePlan
            
            if (expiredSubscription) {
              console.log(`🔄 VIP expired → Auto-assigned free plan to user ${userId}`)
            } else {
              console.log(`✅ Auto-assigned free plan to user ${userId}`)
            }
          } else {
            // Update existing free subscription to be active with no expiration
            const noExpiration = new Date()
            noExpiration.setFullYear(noExpiration.getFullYear() + 100)
            
            await subscriptionsCollection.updateOne(
              { _id: existingFreeSub._id },
              { 
                $set: { 
                  status: 'active', 
                  expiresAt: noExpiration,
                  updatedAt: new Date() 
                } 
              }
            )
            subscription = { ...existingFreeSub, status: 'active', expiresAt: noExpiration }
            plan = freePlan
            
            if (expiredSubscription) {
              console.log(`🔄 VIP expired → Reactivated free plan for user ${userId}`)
            } else {
              console.log(`✅ Reactivated free plan for user ${userId}`)
            }
          }
        }
      }

      // Calculate prediction balance
      // Get settings for free predictions
      const settingsCollection = db.collection('settings')
      
      // Settings are stored as separate documents with key-value pairs
      const freePredictionsSetting = await settingsCollection.findOne({ key: 'freePredictions' })
      const freePredictionsEnabled = freePredictionsSetting?.value?.enabled ?? true
      const freePredictionsLimit = freePredictionsSetting?.value?.dailyLimit || 5
      
      console.log('📋 Free predictions settings:', { 
        enabled: freePredictionsEnabled, 
        limit: freePredictionsLimit,
        raw: freePredictionsSetting 
      })
      
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Count predictions used today - use requestedAt field (not createdAt)
      const predictionsCollection = db.collection('userPredictions')
      const predictionsUsedToday = await predictionsCollection.countDocuments({
        userId: new ObjectId(userId),
        requestedAt: { $gte: today }
      })

      console.log(`📊 Predictions used today for user ${userId}: ${predictionsUsedToday}`)

  // Determine daily limit
      let dailyLimit = 0
      let isUnlimited = false
      if (plan && !plan.name.toLowerCase().includes('free')) {
        // VIP users always get their plan's limit (not affected by free predictions toggle)
        if (plan.unlimitedPredictions) {
          dailyLimit = -1 // Use -1 to indicate unlimited
          isUnlimited = true
        } else {
          dailyLimit = plan.dailyPredictionLimit || plan.predictionsPerDay || 10
        }
      } else if (freePredictionsEnabled) {
        // Free users only get predictions if the toggle is enabled
        dailyLimit = freePredictionsLimit
      } else {
        // Free predictions disabled - give free users 0 predictions
        dailyLimit = 0
      }

      // Apply spin wheel bonus free predictions (24h window)
      let bonusCount = 0
      if (user.bonusFreePredictionsExpiresAt) {
        const exp = new Date(user.bonusFreePredictionsExpiresAt)
        if (exp > new Date()) {
          bonusCount = user.bonusFreePredictionsCount || 0
        } else {
          // Clean expired bonus state
          await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $unset: { bonusFreePredictionsCount: '', bonusFreePredictionsExpiresAt: '', bonusFreePredictionsDate: '' } }
          )
        }
      } else {
        // Backwards compatibility: if legacy same-day fields exist, keep behavior for that day
        const bonusDate = user.bonusFreePredictionsDate ? new Date(user.bonusFreePredictionsDate) : null
        const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate()
        const bonusSameDay = bonusDate && bonusDate.getFullYear() === todayY && bonusDate.getMonth() === todayM && bonusDate.getDate() === todayD
        bonusCount = bonusSameDay ? (user.bonusFreePredictionsCount || 0) : 0
      }
      if (!isUnlimited && bonusCount > 0) {
        dailyLimit += bonusCount
      }

      const predictionsLeft = isUnlimited ? -1 : Math.max(0, dailyLimit - predictionsUsedToday)

      console.log(`✅ Prediction calculation - Daily Limit: ${dailyLimit}, Used: ${predictionsUsedToday}, Remaining: ${predictionsLeft}`)

      // Clean expired pendingDiscount and normalize any legacy 48h expiries to 24h
      let pendingDiscount = user.pendingDiscount || null
      if (pendingDiscount && pendingDiscount.expiresAt) {
        const now = new Date()
        const exp = new Date(pendingDiscount.expiresAt)
        if (exp <= now) {
          // expired: clear it on user and in response
          await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $unset: { pendingDiscount: '' } })
          pendingDiscount = null
        } else {
          // If somehow expiry is beyond 24h (legacy 48h), clamp it to 24h from the award time if known
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
          const msRemaining = exp.getTime() - now.getTime()
          if (msRemaining > TWENTY_FOUR_HOURS) {
            const rewardsCol = db.collection('rewards')
            const recentReward = await rewardsCol.find({
              userId: new ObjectId(userId),
              type: { $in: ['discount_percent', 'discount_amount'] }
            })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray()

            if (recentReward && recentReward[0]?.createdAt) {
              const correctedExp = new Date(new Date(recentReward[0].createdAt).getTime() + TWENTY_FOUR_HOURS)
              if (correctedExp < exp) {
                pendingDiscount = { ...pendingDiscount, expiresAt: correctedExp }
                await usersCollection.updateOne(
                  { _id: new ObjectId(userId) },
                  { $set: { 'pendingDiscount.expiresAt': correctedExp } }
                )
              }
            }
          }
        }
      }

      return {
        user: {
          id: user._id,
          telegramId: user.telegramId,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          medals: user.medals || 0,
          anonymousMode: user.anonymousMode === true,
          isPremium: user.isPremium,
          photoUrl: user.photoUrl || null, // Add Telegram profile photo URL
          walletAddress: user.walletAddress || null,
          walletLinked: user.walletLinked === true,
          createdAt: user.createdAt,
          hasCompletedIntro: user.hasCompletedIntro || false, // Track intro completion
        },
        welcomeMessageSent: user.welcomeMessageSent || false,
        subscription: subscription ? {
          planId: subscription.planId,
          planName: plan?.name || 'Unknown',
          status: subscription.status,
          expiresAt: subscription.expiresAt,
          // Include plan features
          features: {
            dailyPredictionLimit: plan?.dailyPredictionLimit || plan?.predictionsPerDay || 10,
            unlimitedPredictions: plan?.unlimitedPredictions || false,
            allowRealTimePredictions: plan?.allowRealTimePredictions || false,
            allowPredictionRefresh: plan?.allowPredictionRefresh || false,
            duration: plan?.duration || plan?.periodDays || 30,
          }
        } : null,
        predictions: {
          used: predictionsUsedToday,
          remaining: predictionsLeft,
          dailyLimit,
          resetsAt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
        spinWheel: {
          usesLeft: user.spinUsesLeft !== undefined ? user.spinUsesLeft : 1, // Default to 1 if not set
          lastSpinDate: user.lastSpinDate || null,
        },
        medals: user.medals || 0,
        spinBalance: user.spinBalance || 0,
        pendingDiscount
      }
    })

    if (!userData) {
      console.log('❌ User data not found or session invalid')
      return NextResponse.json(
        { error: 'Session invalid', details: 'Please re-authenticate through Telegram' },
        { status: 401 }
      )
    }

    return NextResponse.json(userData)
  } catch (error: any) {
    console.error('Get user profile error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user profile' },
      { status: 500 }
    )
  }
}
