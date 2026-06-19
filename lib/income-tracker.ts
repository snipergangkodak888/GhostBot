import { Db } from '@/lib/object-id'

/**
 * Record an income transaction for a user.
 * These are stored in the `incomeTransactions` collection and used
 * to render the wallet chart (last 30 days).
 *
 * @param db       - Supabase document database instance
 * @param telegramId - User's Telegram ID
 * @param amount   - Token amount earned
 * @param type     - Transaction type: 'mining', 'idle', 'referral', 'ad_reward', 'withdrawal', etc.
 * @param meta     - Optional extra metadata
 */
export async function recordIncomeTransaction(
  db: Db,
  telegramId: number,
  amount: number,
  type: string,
  meta?: Record<string, any>
) {
  try {
    if (amount <= 0) return

    await db.collection('incomeTransactions').insertOne({
      telegramId,
      amount,
      type,
      ...(meta || {}),
      createdAt: new Date(),
    })
  } catch (error) {
    // Non-critical — don't break the main flow
    console.error('[recordIncomeTransaction] Error:', error)
  }
}
