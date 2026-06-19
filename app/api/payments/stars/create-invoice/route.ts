import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ObjectId } from '@/lib/object-id'
import { requireUser } from '@/lib/auth'

const TELEGRAM_API = 'https://api.telegram.org'

interface StarPackage {
  id: string
  spins: number
  priceStars: number
  active: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { packageId, spins: customSpins } = body

    // Get user from session
    const user = await requireUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()

    // Get Stars payment settings
    const starsSettingsDoc = await db.collection('settings').findOne({ key: 'starsPayment' })
    const starsPayment = starsSettingsDoc?.value || {}
    const starPricePerSpin = starsPayment.pricePerSpin || 1

    if (!starsPayment.enabled) {
      return NextResponse.json(
        { error: 'Stars payment is not enabled' },
        { status: 400 }
      )
    }

    // Get user profile to find telegramId
    const userDoc = await db.collection('users').findOne({ _id: new ObjectId(user.id) })
    
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const telegramId = userDoc.telegramId

    // Calculate spins and price
    let totalSpins = 0
    let priceStars = 0
    let packageName = 'Custom Spins'

    if (packageId) {
      // Find the package
      const packages: StarPackage[] = starsPayment.packages || []
      const pkg = packages.find(p => p.id === packageId)
      if (!pkg || !pkg.active) {
        return NextResponse.json({ error: 'Package not found or inactive' }, { status: 404 })
      }
      totalSpins = pkg.spins
      priceStars = pkg.priceStars
      packageName = `${pkg.spins} Spins`
    } else if (customSpins && customSpins > 0) {
      // Calculate price from custom spins
      if (starsPayment.packagesOnly) {
        return NextResponse.json(
          { error: 'Only package purchases are allowed' },
          { status: 400 }
        )
      }
      totalSpins = customSpins
      priceStars = Math.ceil(customSpins * starPricePerSpin)
      packageName = `${customSpins} Spins`
    } else {
      return NextResponse.json(
        { error: 'Either packageId or spins must be provided' },
        { status: 400 }
      )
    }

    // Create unique payload for this invoice
    // Telegram limits payload to 1-128 bytes, so we just use orderId
    const orderId = new ObjectId().toString()
    const payload = orderId // Just the orderId, we store full details in DB

    // Store the invoice in database with pending status
    const invoiceDoc = {
      orderId,
      telegramId,
      userId: user.id,
      packageId: packageId || null,
      spins: totalSpins,
      priceStars,
      payload,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    await db.collection('starInvoices').insertOne(invoiceDoc)

    // Create Telegram invoice using createInvoiceLink
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 })
    }

    const invoicePayload = {
      title: `${totalSpins} Spins`,
      description: `Purchase ${totalSpins} spin attempts to win exciting gifts!`,
      payload: payload,
      currency: 'XTR', // Telegram Stars
      prices: [
        {
          label: packageName,
          amount: priceStars // Stars amount (1 star = 1)
        }
      ]
    }

    const createInvoiceUrl = `${TELEGRAM_API}/bot${botToken}/createInvoiceLink`
    
    const telegramResponse = await fetch(createInvoiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload)
    })

    const telegramData = await telegramResponse.json()
    
    if (!telegramData.ok) {
      console.error('❌ Telegram createInvoiceLink error:', telegramData)
      
      // Update invoice status to failed
      await db.collection('starInvoices').updateOne(
        { orderId },
        { 
          $set: { 
            status: 'failed',
            error: telegramData.description || 'Failed to create invoice',
            updatedAt: new Date()
          }
        }
      )
      
      return NextResponse.json(
        { error: telegramData.description || 'Failed to create invoice' },
        { status: 400 }
      )
    }

    const invoiceUrl = telegramData.result

    // Update invoice with the URL
    await db.collection('starInvoices').updateOne(
      { orderId },
      { 
        $set: { 
          invoiceUrl,
          updatedAt: new Date()
        }
      }
    )

    console.log('✅ Star invoice created:', { orderId, telegramId, spins: totalSpins, priceStars, invoiceUrl })

    return NextResponse.json({
      success: true,
      orderId,
      invoiceUrl,
      spins: totalSpins,
      priceStars
    })

  } catch (error) {
    console.error('❌ Create star invoice error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
