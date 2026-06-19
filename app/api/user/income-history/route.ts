import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/user/income-history - Get last 30 days of income grouped by day
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    const incomeTransactions = db.collection('incomeTransactions')

    const now = new Date()
    // Start of today (midnight) so "today" is always the last point
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    // 29 days before today = 30 data points total (day 0 .. day 29 = today)
    const startDate = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000)

    // Auto-cleanup: delete non-withdrawal income transactions older than 30 days
    await incomeTransactions.deleteMany({
      telegramId: user.telegramId,
      type: { $ne: 'withdrawal' },
      createdAt: { $lt: startDate },
    })

    // Fetch all income transactions for the last 30 days
    const transactions = await incomeTransactions
      .find({
        telegramId: user.telegramId,
        createdAt: { $gte: startDate },
      })
      .sort({ createdAt: 1 })
      .toArray()

    // Group by day and compute cumulative running total
    const dailyMap = new Map<string, number>()

    // Initialize all 30 days (from startDate through today inclusive)
    for (let i = 0; i < 30; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10) // YYYY-MM-DD
      dailyMap.set(key, 0)
    }

    // Sum income per day
    for (const tx of transactions) {
      const key = new Date(tx.createdAt).toISOString().slice(0, 10)
      dailyMap.set(key, (dailyMap.get(key) || 0) + (tx.amount || 0))
    }

    // Build cumulative chart data
    let cumulative = 0
    const chartData = Array.from(dailyMap.entries()).map(([date, amount]) => {
      cumulative += amount
      const d = new Date(date)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return {
        date,
        label,
        balance: cumulative,
      }
    })

    return NextResponse.json({
      success: true,
      chartData,
      totalIncome: cumulative,
      transactionCount: transactions.length,
    })
  } catch (error: any) {
    console.error('[API] Get income history error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
