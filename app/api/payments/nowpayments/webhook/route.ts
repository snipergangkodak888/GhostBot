import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import NOWPaymentsAPI, { isPaymentCompleted, isPaymentFailed } from '@/lib/nowpayments'

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const signature = req.headers.get('x-nowpayments-sig') || ''
    
    console.log('📥 NOWPayments webhook received')

    const db = await getDb()

    // Get NOWPayments settings
    const nowPaymentsSettings = await db.collection('settings').findOne({ key: 'nowPayments' })
    const config = nowPaymentsSettings?.value || {}

    if (!config.enabled || !config.apiKey) {
      console.error('❌ NOWPayments not configured')
      return NextResponse.json({ error: 'Not configured' }, { status: 400 })
    }

    // Verify IPN signature
    if (config.ipnSecret) {
      const nowPayments = new NOWPaymentsAPI({
        apiKey: config.apiKey,
        sandbox: config.sandbox || false
      })

      const isValid = nowPayments.verifyIPN(signature, body, config.ipnSecret)
      if (!isValid) {
        console.error('❌ Invalid IPN signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const data = JSON.parse(body)
    const { payment_id, payment_status, order_id } = data

    console.log('💳 Payment update:', { payment_id, payment_status, order_id })

    // Find the plan request
    const planRequest = await db.collection('planRequests').findOne({
      'payment.paymentId': payment_id,
      'payment.provider': 'nowpayments'
    })

    if (!planRequest) {
      console.error('❌ Plan request not found for payment:', payment_id)
      return NextResponse.json({ error: 'Plan request not found' }, { status: 404 })
    }

    // Update payment status
    await db.collection('planRequests').updateOne(
      { _id: planRequest._id },
      {
        $set: {
          'payment.status': payment_status,
          'payment.updatedAt': new Date().toISOString(),
          'payment.actuallyPaid': data.actually_paid,
          'payment.outcomeAmount': data.outcome_amount,
          'payment.outcomeCurrency': data.outcome_currency,
          updatedAt: new Date()
        }
      }
    )

    // If payment is completed, auto-approve and activate immediately
    if (isPaymentCompleted(payment_status)) {
      console.log('✅ Payment completed, activating plan immediately:', planRequest._id)

      // Get plan details
      const plan = await db.collection('plans').findOne({ _id: planRequest.planId })
      if (!plan) {
        console.error('❌ Plan not found:', planRequest.planId)
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }

      const now = new Date()

      // Calculate expiration date
      const durationDays = plan.duration || plan.periodDays || plan.durationDays || 30
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + durationDays)

      // Activate subscription immediately (replace any existing subscription)
      const subscription = {
        planId: planRequest.planId,
        name: plan.name,
        status: 'active',
        startedAt: now,
        expiresAt: expiresAt,
        autoRenew: false
      }

      await db.collection('users').updateOne(
        { _id: planRequest.userId },
        {
          $set: {
            subscription: subscription,
            updatedAt: now
          }
        }
      )

      // Update plan request to approved and activated
      await db.collection('planRequests').updateOne(
        { _id: planRequest._id },
        {
          $set: {
            status: 'approved',
            approvedAt: now,
            approvedBy: 'system_auto',
            activatedAt: now,
            notes: `Auto-approved and activated immediately after successful NOWPayments payment (${payment_id})`,
            updatedAt: now
          }
        }
      )

      console.log('🎉 Plan activated immediately for user:', planRequest.userId)
    }

    // If payment failed, reject the plan request
    if (isPaymentFailed(payment_status)) {
      console.log('❌ Payment failed, rejecting plan request:', planRequest._id)

      await db.collection('planRequests').updateOne(
        { _id: planRequest._id },
        {
          $set: {
            status: 'rejected',
            rejectedAt: new Date(),
            rejectedBy: 'system_auto',
            notes: `Auto-rejected: payment ${payment_status} (${payment_id})`,
            updatedAt: new Date()
          }
        }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('❌ Error processing NOWPayments webhook:', error)
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
