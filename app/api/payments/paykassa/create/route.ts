import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import PayKassaAPI from '@/lib/paykassa'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, planId, spins, packageId, payCurrency } = body

    if (!payCurrency) {
      return NextResponse.json({ error: 'Missing payCurrency' }, { status: 400 })
    }

    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()

    // Get PayKassa settings
    const settingsDoc = await db.collection('settings').findOne({ key: 'platformSettings' })
    const settings = settingsDoc?.value || {}
    const cryptoPayments = settings.cryptoPayments || {}
    const spinPricing = settings.spinPricing || {}
    const paykassaConfig = cryptoPayments.paykassa || {}

    if (!cryptoPayments.enabled || cryptoPayments.provider !== 'paykassa') {
      return NextResponse.json({ error: 'PayKassa is not enabled' }, { status: 400 })
    }

    if (!paykassaConfig.apiKey || !paykassaConfig.merchantId) {
      return NextResponse.json({ error: 'PayKassa not configured' }, { status: 400 })
    }

    // Check if currency is enabled
    const enabledCurrencies = cryptoPayments.enabledCurrencies || []
    if (!enabledCurrencies.includes(payCurrency.toLowerCase())) {
      return NextResponse.json({ error: `Currency ${payCurrency} is not enabled` }, { status: 400 })
    }

    // Get user profile
    const userProfile = await db.collection('users').findOne({ _id: new ObjectId(user.id) })
    if (!userProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    let amount = 0
    let description = ''
    let orderId = ''
    let totalSpins = 0

    if (type === 'plan' && planId) {
      // Plan purchase
      const plan = await db.collection('plans').findOne({ _id: new ObjectId(planId) })
      if (!plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }
      amount = plan.price
      description = `${plan.name} - ${plan.duration || 30} days subscription`
      orderId = `plan_${planId}_user_${user.id}_${Date.now()}`
    } else if (packageId) {
      // Package spin purchase
      const packages = spinPricing.packages || []
      const pkg = packages.find((p: { id: string }) => p.id === packageId)
      if (!pkg || !pkg.active) {
        return NextResponse.json({ error: 'Package not found or inactive' }, { status: 404 })
      }
      amount = pkg.priceUsd
      totalSpins = pkg.spins
      description = `${pkg.spins} Spins Package`
      orderId = `spin_${pkg.spins}_user_${user.id}_${Date.now()}`
    } else if (spins) {
      // Custom spin purchase
      if (spinPricing.usePackagesOnly) {
        return NextResponse.json({ error: 'Only package purchases are allowed' }, { status: 400 })
      }
      const pricePerSpin = spinPricing.pricePerSpin || 0.1
      amount = spins * pricePerSpin
      totalSpins = spins
      description = `${spins} Spins`
      orderId = `spin_${spins}_user_${user.id}_${Date.now()}`
    } else {
      return NextResponse.json({ error: 'Missing planId, packageId, or spins' }, { status: 400 })
    }

    // Check minimum amount
    const minAmounts = cryptoPayments.currencyMinAmounts || {}
    const minAmount = minAmounts[payCurrency.toLowerCase()] || 1
    if (amount < minAmount) {
      return NextResponse.json({
        error: `Minimum amount for ${payCurrency.toUpperCase()} is $${minAmount}`
      }, { status: 400 })
    }

    // Initialize PayKassa API
    const paykassa = new PayKassaAPI({
      merchantId: paykassaConfig.merchantId,
      apiKey: paykassaConfig.apiKey,
      secretKey: paykassaConfig.secretKey || '',
      testMode: paykassaConfig.testMode || false
    })

    // Create invoice
    const result = await paykassa.createInvoice({
      amount,
      currency: 'USD',
      orderId,
      comment: description,
      payCurrency
    })

    if (!result.success) {
      console.error('PayKassa invoice creation failed:', result.error)
      return NextResponse.json({ error: result.error || 'Invoice creation failed' }, { status: 400 })
    }

    // Create purchase record
    if (orderId.startsWith('spin_')) {
      const spinPurchase = {
        userId: new ObjectId(user.id),
        telegramUserId: userProfile.telegramUserId,
        spins: totalSpins,
        packageId: packageId || null,
        priceUsd: amount,
        payment: {
          provider: 'paykassa',
          paymentId: result.data!.invoice_id,
          orderId,
          status: 'pending',
          payAddress: result.data!.address,
          payAmount: result.data!.amount_pay,
          payCurrency,
          invoiceUrl: result.data!.url,
          tag: result.data!.tag,
          expiresAt: result.data!.expiration_time,
          createdAt: new Date().toISOString()
        },
        credited: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const insertResult = await db.collection('spinPurchases').insertOne(spinPurchase)

      console.log('✅ PayKassa spin purchase created:', {
        purchaseId: insertResult.insertedId,
        invoiceId: result.data!.invoice_id,
        spins: totalSpins,
        amount
      })

      return NextResponse.json({
        success: true,
        purchaseId: insertResult.insertedId.toString(),
        payment: {
          provider: 'paykassa',
          invoiceId: result.data!.invoice_id,
          invoiceUrl: result.data!.url,
          payAddress: result.data!.address,
          payAmount: result.data!.amount_pay,
          payCurrency,
          tag: result.data!.tag,
          expiresAt: result.data!.expiration_time
        },
        spins: totalSpins,
        priceUsd: amount
      })
    } else {
      // Plan purchase
      const planRequest = {
        userId: new ObjectId(user.id),
        planId: new ObjectId(planId),
        status: 'pending',
        payment: {
          provider: 'paykassa',
          paymentId: result.data!.invoice_id,
          orderId,
          status: 'pending',
          payAddress: result.data!.address,
          payAmount: result.data!.amount_pay,
          payCurrency,
          invoiceUrl: result.data!.url,
          tag: result.data!.tag,
          expiresAt: result.data!.expiration_time,
          createdAt: new Date().toISOString()
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const insertResult = await db.collection('planRequests').insertOne(planRequest)

      console.log('✅ PayKassa plan purchase created:', {
        requestId: insertResult.insertedId,
        invoiceId: result.data!.invoice_id,
        planId,
        amount
      })

      return NextResponse.json({
        success: true,
        requestId: insertResult.insertedId.toString(),
        payment: {
          provider: 'paykassa',
          invoiceId: result.data!.invoice_id,
          invoiceUrl: result.data!.url,
          payAddress: result.data!.address,
          payAmount: result.data!.amount_pay,
          payCurrency,
          tag: result.data!.tag,
          expiresAt: result.data!.expiration_time
        },
        priceUsd: amount
      })
    }
  } catch (error) {
    console.error('❌ PayKassa create payment error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
