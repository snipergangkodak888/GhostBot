// Example helper function to add to your spin endpoint
// app/api/user/spin/route.ts

import { NextRequest, NextResponse } from 'next/server'

/**
 * Send a Telegram gift to a user automatically
 * Call this when user wins a gift in the spin
 */
async function sendTelegramGiftToUser(
  telegramUserId: number,
  giftId: string,
  giftName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/telegram/send-gift`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: telegramUserId,
          giftId: giftId,
          text: `🎉 **Congratulations!** You won **${giftName || 'a Telegram Gift'}**!\n\nThis gift has been sent to your Telegram account. Check your profile to see it! ⭐`,
        }),
      }
    )

    const data = await response.json()

    if (!data.ok) {
      console.error('❌ Failed to send Telegram gift:', data.error)
      return { success: false, error: data.error }
    }

    console.log('✅ Telegram gift sent successfully:', giftId)
    return { success: true }
  } catch (error) {
    console.error('❌ Error sending Telegram gift:', error)
    return { success: false, error: 'Failed to send gift' }
  }
}

/**
 * Example: Add this to your existing spin POST handler
 * 
 * This shows how to integrate Telegram gift sending into your spin logic
 */
export async function POST_EXAMPLE(request: NextRequest) {
  // ... your existing spin logic ...
  
  // After you determine the reward:
  const reward = enabledRewards[index] // Your selected reward
  
  // Check if this is a Telegram gift reward
  if (reward.key === 'telegram_gift' && reward.giftId) {
    // Get user's Telegram ID (you should store this during auth)
    const user = await getUserFromSession(request)
    const telegramUserId = user.telegramId // e.g., 123456789
    
    if (!telegramUserId) {
      return NextResponse.json(
        { error: 'Telegram user ID not found' },
        { status: 400 }
      )
    }
    
    // Send the gift automatically!
    const sendResult = await sendTelegramGiftToUser(
      telegramUserId,
      reward.giftId,
      reward.label || 'Premium Gift'
    )
    
    if (sendResult.success) {
      // Record the gift in your database
      await rewardsCol.insertOne({
        userId: user._id,
        type: 'telegram_gift',
        giftId: reward.giftId,
        giftName: reward.label,
        sentAt: new Date(),
        telegramUserId,
      })
      
      // Return success response
      return NextResponse.json({
        ok: true,
        reward: {
          type: 'telegram_gift',
          giftId: reward.giftId,
          name: reward.label,
          message: '🎉 Gift sent to your Telegram account!',
        },
        sliceId: reward.id,
        segmentIndex: index,
      })
    } else {
      // Gift send failed - handle gracefully
      return NextResponse.json({
        ok: true,
        reward: {
          type: 'telegram_gift',
          giftId: reward.giftId,
          name: reward.label,
          message: '⚠️ Gift won but send failed. Contact support.',
          error: sendResult.error,
        },
        sliceId: reward.id,
        segmentIndex: index,
      })
    }
  }
  
  // ... handle other reward types (free_prediction, discounts, etc.) ...
}

/**
 * How to configure Telegram gifts in your spin wheel settings
 * 
 * Add this structure to your settings.spinWheel.rewards array
 */
const exampleSpinWheelConfig = {
  enabled: true,
  timerHours: 24,
  spinsPerPeriod: 3,
  rewards: [
    // Telegram Gift Reward
    {
      id: 'reward_telegram_gift_1',
      key: 'telegram_gift', // Important: use this key
      label: 'Premium Gift 🎁',
      giftId: 'gift_12345', // From Telegram's getAvailableGifts
      weight: 10, // 10% chance
      enabled: true,
    },
    // Another Telegram Gift
    {
      id: 'reward_telegram_gift_2',
      key: 'telegram_gift',
      label: 'Deluxe Gift 💎',
      giftId: 'gift_67890',
      weight: 5, // 5% chance
      enabled: true,
    },
    // Regular rewards
    {
      id: 'reward_free_prediction',
      key: 'free_prediction',
      label: 'Free Prediction',
      amount: 1,
      weight: 20,
      enabled: true,
    },
    {
      id: 'reward_try_again',
      key: 'try_again',
      label: 'Try Again',
      weight: 65,
      enabled: true,
    },
  ],
}

/**
 * Helper to get user from session
 */
async function getUserFromSession(request: NextRequest) {
  // Your existing user session logic
  const userId = request.cookies.get('telegram_user_id')?.value
  // ... fetch user from DB ...
  return user
}

export { sendTelegramGiftToUser, exampleSpinWheelConfig }
