import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const users = db.collection('users')
  const id = params.id
  const payload = await _req.json()
  await users.updateOne({ _id: new ObjectId(id) }, { $set: { ...payload, updatedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = await getDb()
    const userId = params.id
    const userObjectId = new ObjectId(userId)
    
    // Get the user first to get their telegramId
    const user = await db.collection('users').findOne({ _id: userObjectId })
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    const telegramId = user.telegramId
    const telegramIdNum = Number(telegramId)
    const telegramIdCandidates = Array.from(new Set([
      telegramId,
      Number.isNaN(telegramIdNum) ? undefined : telegramIdNum,
      String(telegramId),
    ].filter((v) => v !== undefined)))

    const deleteManySafe = async (collection: string, filter: Record<string, any>) => {
      try {
        const result = await db.collection(collection).deleteMany(filter)
        return result.deletedCount || 0
      } catch {
        return 0
      }
    }
    
    // Track what we delete
    const deletionReport = {
      user: false,
      spins: 0,
      gifts: 0,
      taskCompletions: 0,
      adRewards: 0,
      referralsAsReferrer: 0,
      referralsAsReferred: 0,
      referredByCleared: 0,
      referralCommissions: 0,
      withdrawals: 0,
      payments: 0,
      mergeScores: 0,
      streaks: 0,
      wonGifts: 0,
      giftWithdrawals: 0,
      rewards: 0,
      subscriptions: 0,
      predictionUsageLogs: 0,
      incomeEvents: 0,
      starInvoices: 0,
      sessions: 0,
      spinHistory: 0,
      userTokensLegacy: 0,
    }
    
    // Delete user record
    const userResult = await db.collection('users').deleteOne({ _id: userObjectId })
    deletionReport.user = userResult.deletedCount > 0
    
    // Delete user spins (legacy) - energy is now in mergeScores, deleted below
    const spinsResult = await db.collection('userSpins').deleteMany({ telegramId: { $in: telegramIdCandidates } })
    deletionReport.spins = spinsResult.deletedCount
    
    // Also try old userTokens collection
    deletionReport.userTokensLegacy = await deleteManySafe('userTokens', { telegramId: { $in: telegramIdCandidates } })
    
    // Delete user gifts
    const giftsResult = await db.collection('userGifts').deleteMany({ telegramId: { $in: telegramIdCandidates } })
    deletionReport.gifts = giftsResult.deletedCount
    
    // Delete task completions
    const taskResult = await db.collection('taskCompletions').deleteMany({ telegramId: { $in: telegramIdCandidates } })
    deletionReport.taskCompletions = taskResult.deletedCount
    
    // Delete ad rewards
    const adResult = await db.collection('adRewards').deleteMany({ telegramId: { $in: telegramIdCandidates } })
    deletionReport.adRewards = adResult.deletedCount
    
    // Delete referrals where user is the referrer
    const refAsReferrer = await db.collection('referrals').deleteMany({ referrerId: { $in: telegramIdCandidates } })
    deletionReport.referralsAsReferrer = refAsReferrer.deletedCount
    
    // Delete referrals where user was referred (but keep the referrer data intact)
    const refAsReferred = await db.collection('referrals').deleteMany({ referredId: { $in: telegramIdCandidates } })
    deletionReport.referralsAsReferred = refAsReferred.deletedCount

    // Clear referral linkage on users that were referred by this deleted user
    const referredByClearResult = await db.collection('users').updateMany(
      { referredBy: { $in: telegramIdCandidates } },
      { $unset: { referredBy: '', referralCode: '' } }
    )
    deletionReport.referredByCleared = referredByClearResult.modifiedCount || 0
    
    // Delete referral commissions where this user was the referrer
    const refCommResult = await db.collection('referralCommissions').deleteMany({
      $or: [
        { referrerId: { $in: telegramIdCandidates } },
        { referredId: { $in: telegramIdCandidates } },
      ],
    })
    deletionReport.referralCommissions = refCommResult.deletedCount
    
    // Delete withdrawals
    const withdrawResult = await db.collection('withdrawals').deleteMany({ telegramId: { $in: telegramIdCandidates } })
    deletionReport.withdrawals = withdrawResult.deletedCount
    
    // Delete payments
    const paymentResult = await db.collection('payments').deleteMany({ 
      $or: [
        { telegramId: { $in: telegramIdCandidates } },
        { 'metadata.telegramId': { $in: telegramIdCandidates } },
        { userId: userObjectId },
      ]
    })
    deletionReport.payments = paymentResult.deletedCount

    // Merge game + streak + gifts/spins history + subscriptions + invoices + income logs
    deletionReport.mergeScores = await deleteManySafe('mergeScores', { telegramId: { $in: telegramIdCandidates } })
    deletionReport.streaks = await deleteManySafe('streaks', { telegramId: { $in: telegramIdCandidates } })
    deletionReport.wonGifts = await deleteManySafe('wonGifts', {
      $or: [
        { userId: userObjectId },
        { telegramId: { $in: telegramIdCandidates } },
      ],
    })
    deletionReport.giftWithdrawals = await deleteManySafe('giftWithdrawals', { telegramId: { $in: telegramIdCandidates } })
    deletionReport.spins = deletionReport.spins + await deleteManySafe('spins', { userId: userObjectId })
    deletionReport.rewards = await deleteManySafe('rewards', { userId: userObjectId })
    deletionReport.subscriptions = await deleteManySafe('subscriptions', { userId: userObjectId })
    deletionReport.predictionUsageLogs = await deleteManySafe('predictionUsageLogs', { userId: userObjectId })
    deletionReport.incomeEvents = await deleteManySafe('incomeEvents', { telegramId: { $in: telegramIdCandidates } })
    deletionReport.starInvoices = await deleteManySafe('starInvoices', { telegramId: { $in: telegramIdCandidates } })
    
    // Delete spin history if exists
    deletionReport.spinHistory = await deleteManySafe('spinHistory', { telegramId: { $in: telegramIdCandidates } })
    
    // Delete user sessions if exists
    deletionReport.sessions = await deleteManySafe('sessions', { telegramId: { $in: telegramIdCandidates } })
    
    return NextResponse.json({ 
      ok: true, 
      message: 'User and all related data deleted successfully',
      deletionReport 
    })
  } catch (error) {
    console.error('Failed to delete user:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

