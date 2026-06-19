import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import NOWPaymentsAPI from '@/lib/nowpayments'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { planId, payCurrency } = body

    if (!planId || !payCurrency) {
      return NextResponse.json(
        { error: 'Missing required fields: planId, payCurrency' },
        { status: 400 }
      )
    }

    // Get user from session
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
        { error: 'NOWPayments is not enabled or configured' },
        { status: 400 }
      )
    }

    // Get plan details
    const plan = await db.collection('plans').findOne({ _id: new ObjectId(planId) })
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    // Get user profile using ObjectId
    const userDoc = await db.collection('users').findOne({ _id: new ObjectId(user.id) })
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Initialize NOWPayments API
    const nowPayments = new NOWPaymentsAPI({
      apiKey: config.apiKey,
      sandbox: config.sandbox || false
    })

    // Create unique order ID
    const orderId = `plan_${planId}_user_${userDoc._id}_${Date.now()}`

    // Get app URL for callbacks
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.com'

    // Create payment
    const payment = await nowPayments.createPayment({
      price_amount: plan.price,
      price_currency: 'USD',
      pay_currency: payCurrency.toLowerCase(),
      order_id: orderId,
      order_description: `${plan.name} - ${plan.duration} days subscription`,
      ipn_callback_url: `${appUrl}/api/payments/nowpayments/webhook`,
      success_url: `${appUrl}/dashboard?payment=success`,
      cancel_url: `${appUrl}/dashboard?payment=cancelled`
    })

    // Create plan request with payment info
    const planRequest = {
      userId: userDoc._id,
      planId: new ObjectId(planId),
      status: 'pending',
      payment: {
        provider: 'nowpayments',
        paymentId: payment.payment_id,
        orderId: orderId,
        status: payment.payment_status,
        payAddress: payment.pay_address,
        payAmount: payment.pay_amount,
        payCurrency: payment.pay_currency,
        priceAmount: payment.price_amount,
        priceCurrency: payment.price_currency,
        createdAt: new Date().toISOString(),
        expiresAt: payment.expiration_estimate_date || null,
        invoiceUrl: payment.invoice_url || null
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const result = await db.collection('planRequests').insertOne(planRequest)

    console.log('✅ NOWPayments payment created:', {
      paymentId: payment.payment_id,
      orderId: orderId,
      amount: payment.pay_amount,
      currency: payment.pay_currency
    })

    return NextResponse.json({
      success: true,
      payment: {
        paymentId: payment.payment_id,
        payAddress: payment.pay_address,
        payAmount: payment.pay_amount,
        payCurrency: payment.pay_currency,
        priceAmount: payment.price_amount || plan.price,
        priceCurrency: payment.price_currency || 'USD',
        status: payment.payment_status || 'waiting',
        expiresAt: payment.expiration_estimate_date || null,
        invoiceUrl: payment.invoice_url,
        requestId: result.insertedId.toString()
      }
    })

  } catch (error: any) {
    console.error('❌ Error creating NOWPayments payment:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create payment' },
      { status: 500 }
    )
  }
}
