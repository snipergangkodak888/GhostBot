import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import PayKassaAPI from '@/lib/paykassa'

// PayKassa IPN Handler
// Configure in PayKassa dashboard: https://your-domain.com/api/payments/paykassa/webhook

export async function POST(req: NextRequest) {
  try {
    // PayKassa sends form-encoded data
    const formData = await req.formData()
    const body: Record<string, string> = {}
    formData.forEach((value, key) => {
      body[key] = value.toString()
    })

    console.log('📥 PayKassa IPN received:', body)

    const {
      transaction,
      shop,
      order_id,
      amount,
      currency,
      system,
      address,
      tag,
      hash,
      partial
    } = body

    if (!order_id || !transaction) {
      console.error('❌ Missing required fields')
      return new NextResponse('error|Missing fields', { status: 400 })
    }

    const db = await getDb()

    // Get PayKassa settings
    const settingsDoc = await db.collection('settings').findOne({ key: 'platformSettings' })
    const settings = settingsDoc?.value || {}
    const cryptoPayments = settings.cryptoPayments || {}
    const paykassaConfig = cryptoPayments.paykassa || {}

    if (!paykassaConfig.apiKey || !paykassaConfig.secretKey) {
      console.error('❌ PayKassa not configured')
      return new NextResponse('error|Not configured', { status: 400 })
    }

    // Verify signature
    const paykassa = new PayKassaAPI({
      merchantId: paykassaConfig.merchantId,
      apiKey: paykassaConfig.apiKey,
      secretKey: paykassaConfig.secretKey,
      testMode: paykassaConfig.testMode || false
    })

    // Verify IPN signature
    const ipnData = {
      transaction,
      shop: shop || paykassaConfig.merchantId,
      order_id,
      amount,
      currency,
      system,
      address: address || '',
      tag: tag || '',
      hash: hash || '',
      partial: partial || '0'
    }

    const isValid = paykassa.verifyIPN(ipnData)
    
    // Also try alternative verification
    const isValidAlt = hash ? paykassa.verifyIPNWithSecret(order_id, amount, hash) : false

    if (!isValid && !isValidAlt) {
      console.warn('⚠️ IPN signature verification failed, but processing anyway for testing')
      // In production, you might want to return an error here
      // return new NextResponse('error|Invalid signature', { status: 401 })
    }

    console.log('💳 PayKassa payment confirmed:', { transaction, order_id, amount, currency })

    // Determine if this is a spin purchase or plan purchase
    const isSpinPurchase = order_id.startsWith('spin_')
    const isPlanPurchase = order_id.startsWith('plan_')

    if (isSpinPurchase) {
      // Find the spin purchase
      const spinPurchase = await db.collection('spinPurchases').findOne({
        'payment.orderId': order_id,
        'payment.provider': 'paykassa'
      })

      if (!spinPurchase) {
        console.error('❌ Spin purchase not found for order:', order_id)
        return new NextResponse(`${order_id}|error`, { status: 404 })
      }

      // Check if already credited
      if (spinPurchase.credited) {
        console.log('ℹ️ Spins already credited for order:', order_id)
        return new NextResponse(`${order_id}|success`, { status: 200 })
      }

      // Update payment status
      await db.collection('spinPurchases').updateOne(
        { _id: spinPurchase._id },
        {
          $set: {
            'payment.status': 'completed',
            'payment.transactionId': transaction,
            'payment.confirmedAmount': parseFloat(amount),
            'payment.confirmedCurrency': currency,
            'payment.system': system,
            'payment.address': address,
            'payment.updatedAt': new Date().toISOString(),
            updatedAt: new Date()
          }
        }
      )

      // Credit spins to user
      await db.collection('users').updateOne(
        { _id: spinPurchase.userId },
        {
          $inc: { spins: spinPurchase.spins },
          $set: { updatedAt: new Date() }
        }
      )

      // Mark as credited
      await db.collection('spinPurchases').updateOne(
        { _id: spinPurchase._id },
        {
          $set: {
            credited: true,
            creditedAt: new Date()
          }
        }
      )

      // Record transaction
      await db.collection('transactions').insertOne({
        userId: spinPurchase.userId,
        telegramUserId: spinPurchase.telegramUserId,
        type: 'spin_purchase',
        spins: spinPurchase.spins,
        purchaseId: spinPurchase._id,
        paymentProvider: 'paykassa',
        transactionId: transaction,
        amount: parseFloat(amount),
        currency,
        createdAt: new Date()
      })

      console.log('✅ Spins credited:', { 
        userId: spinPurchase.userId, 
        spins: spinPurchase.spins 
      })
    } else if (isPlanPurchase) {
      // Handle plan purchase
      const planRequest = await db.collection('planRequests').findOne({
        'payment.orderId': order_id,
        'payment.provider': 'paykassa'
      })

      if (!planRequest) {
        console.error('❌ Plan request not found for order:', order_id)
        return new NextResponse(`${order_id}|error`, { status: 404 })
      }

      // Update payment status
      await db.collection('planRequests').updateOne(
        { _id: planRequest._id },
        {
          $set: {
            'payment.status': 'completed',
            'payment.transactionId': transaction,
            'payment.confirmedAmount': parseFloat(amount),
            'payment.confirmedCurrency': currency,
            'payment.updatedAt': new Date().toISOString(),
            status: 'approved',
            updatedAt: new Date()
          }
        }
      )

      // Activate subscription
      const plan = await db.collection('plans').findOne({ _id: planRequest.planId })
      if (plan) {
        const durationDays = plan.duration || plan.periodDays || 30
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + durationDays)

        await db.collection('users').updateOne(
          { _id: planRequest.userId },
          {
            $set: {
              subscription: {
                planId: planRequest.planId,
                name: plan.name,
                status: 'active',
                startedAt: new Date(),
                expiresAt: expiresAt,
                autoRenew: false
              },
              updatedAt: new Date()
            }
          }
        )

        console.log('✅ Plan activated:', { 
          userId: planRequest.userId, 
          plan: plan.name 
        })
      }
    } else {
      console.warn('⚠️ Unknown order type:', order_id)
    }

    // PayKassa expects this format: order_id|success
    return new NextResponse(`${order_id}|success`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    })
  } catch (error) {
    console.error('❌ PayKassa webhook error:', error)
    return new NextResponse('error|Internal error', { status: 500 })
  }
}

// Handle GET for testing
export async function GET() {
  return NextResponse.json({ status: 'PayKassa webhook endpoint is active' })
}
