import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import NOWPaymentsAPI, { isPaymentCompleted, isPaymentFailed } from '@/lib/nowpayments'
import { requireUser } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { paymentId: string } }
) {
  try {
    const { paymentId } = params

    if (!paymentId) {
      return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 })
    }

    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()

    // Get NOWPayments settings
    const nowPaymentsSettings = await db.collection('settings').findOne({ key: 'nowPayments' })
    const config = nowPaymentsSettings?.value || {}

    if (!config.enabled || !config.apiKey) {
      return NextResponse.json(
        { error: 'NOWPayments is not configured' },
        { status: 400 }
      )
    }

    // Initialize NOWPayments API
    const nowPayments = new NOWPaymentsAPI({
      apiKey: config.apiKey,
      sandbox: config.sandbox || false
    })

    // Get payment status from NOWPayments
    let paymentStatus
    try {
      paymentStatus = await nowPayments.getPaymentStatus(paymentId)
    } catch (apiError: any) {
      console.error('❌ NOWPayments API error:', apiError.message)
      return NextResponse.json(
        { error: 'Failed to fetch payment status from NOWPayments', details: apiError.message },
        { status: 502 }
      )
    }

    // Find the plan request
    const planRequest = await db.collection('planRequests').findOne({
      'payment.paymentId': paymentId,
      'payment.provider': 'nowpayments'
    })

    if (planRequest) {
      // Update local payment status
      await db.collection('planRequests').updateOne(
        { _id: planRequest._id },
        {
          $set: {
            'payment.status': paymentStatus.payment_status,
            'payment.updatedAt': new Date().toISOString(),
            'payment.actuallyPaid': paymentStatus.actually_paid,
            updatedAt: new Date()
          }
        }
      )

      // Auto-approve if completed
      if (isPaymentCompleted(paymentStatus.payment_status) && planRequest.status === 'pending') {
        const plan = await db.collection('plans').findOne({ _id: planRequest.planId })
        if (plan) {
          const durationDays = plan.duration || plan.periodDays || plan.durationDays || 30
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + durationDays)

          const subscription = {
            planId: planRequest.planId,
            name: plan.name,
            status: 'active',
            startedAt: new Date(),
            expiresAt: expiresAt,
            autoRenew: false
          }

          await db.collection('users').updateOne(
            { _id: planRequest.userId },
            { $set: { subscription: subscription, updatedAt: new Date() } }
          )

          await db.collection('planRequests').updateOne(
            { _id: planRequest._id },
            {
              $set: {
                status: 'approved',
                approvedAt: new Date(),
                approvedBy: 'system_auto',
                notes: `Auto-approved after successful payment check (${paymentId})`,
                updatedAt: new Date()
              }
            }
          )

          console.log('✅ Plan request auto-approved after status check:', planRequest._id)
        }
      }

      // Auto-reject if failed
      if (isPaymentFailed(paymentStatus.payment_status) && planRequest.status === 'pending') {
        await db.collection('planRequests').updateOne(
          { _id: planRequest._id },
          {
            $set: {
              status: 'rejected',
              rejectedAt: new Date(),
              rejectedBy: 'system_auto',
              notes: `Auto-rejected: payment ${paymentStatus.payment_status}`,
              updatedAt: new Date()
            }
          }
        )
      }
    }

    return NextResponse.json({
      success: true,
      payment: {
        paymentId: paymentStatus.payment_id,
        status: paymentStatus.payment_status,
        payAddress: paymentStatus.pay_address,
        payAmount: paymentStatus.pay_amount,
        payCurrency: paymentStatus.pay_currency,
        priceAmount: paymentStatus.price_amount,
        priceCurrency: paymentStatus.price_currency,
        actuallyPaid: paymentStatus.actually_paid,
        outcomeAmount: paymentStatus.outcome_amount,
        outcomeCurrency: paymentStatus.outcome_currency,
        createdAt: paymentStatus.created_at,
        updatedAt: paymentStatus.updated_at
      }
    })

  } catch (error: any) {
    console.error('❌ Error checking payment status:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to check payment status' },
      { status: 500 }
    )
  }
}
