import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const db = await getDb()
    const plans = await db
      .collection('plans')
      .find({
        $or: [
          { isActive: true },
          { isActive: { $exists: false } }, // backwards compatible
        ],
      })
      .sort({ order: 1, price: 1 })
      .toArray()

    const formatted = plans.map((plan: any) => ({
      _id: String(plan._id),
      name: plan.name || 'Unknown Plan',
      price: typeof plan.price === 'number' ? plan.price : 0,
      duration: plan.duration || plan.durationDays || plan.periodDays || 30,
      periodDays: plan.periodDays || plan.duration || plan.durationDays || 30,
      predictionsPerDay: plan.predictionsPerDay || plan.dailyPredictionLimit || 5,
      dailyPredictionLimit: plan.dailyPredictionLimit || plan.predictionsPerDay || 5,
      unlimitedPredictions: !!plan.unlimitedPredictions,
      allowRealTimePredictions: !!plan.allowRealTimePredictions,
      allowPredictionRefresh: !!plan.allowPredictionRefresh,
      features: Array.isArray(plan.features) ? plan.features : [],
      isPopular: !!plan.isPopular,
    }))

    const res = NextResponse.json({ success: true, plans: formatted, count: formatted.length })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (e: any) {
    console.error('[public/plans] error', e)
    return NextResponse.json({ success: false, error: e?.message || 'Failed to fetch plans' }, { status: 500 })
  }
}
