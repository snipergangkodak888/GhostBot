import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('💎 Fetching plans for user:', user.telegramId)

    const db = await getDb()
    
    // Fetch all active subscription plans (or plans without isActive field for backwards compatibility)
    const plans = await db
      .collection('plans')
      .find({
        $or: [
          { isActive: true },
          { isActive: { $exists: false } } // Include plans without isActive field
        ]
      })
      .sort({ order: 1, price: 1 }) // Sort by order first, then by price ascending
      .toArray()

    console.log('✅ Found', plans.length, 'plans')

    // Transform to match the Plan interface expected by the frontend
    const formattedPlans = plans.map((plan: any) => ({
      _id: plan._id.toString(),
      name: plan.name || 'Unknown Plan',
      price: plan.price || 0,
      duration: plan.duration || plan.durationDays || plan.periodDays || 30,
      periodDays: plan.periodDays || plan.duration || plan.durationDays || 30,
      predictionsPerDay: plan.predictionsPerDay || plan.dailyPredictionLimit || 5,
      dailyPredictionLimit: plan.dailyPredictionLimit || plan.predictionsPerDay || 5,
      unlimitedPredictions: plan.unlimitedPredictions || false,
      allowRealTimePredictions: plan.allowRealTimePredictions || false,
      allowPredictionRefresh: plan.allowPredictionRefresh || false,
      features: plan.features || [],
      isPopular: plan.isPopular || false
    }))

    return NextResponse.json({
      success: true,
      plans: formattedPlans,
      count: formattedPlans.length
    })

  } catch (error) {
    console.error('❌ Error fetching plans:', error)
    return NextResponse.json(
      { error: 'Failed to fetch plans' },
      { status: 500 }
    )
  }
}
