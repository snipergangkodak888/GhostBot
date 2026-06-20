import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET crypto payment configuration for frontend
export async function GET(req: NextRequest) {
  try {
    const db = await getDb()

    // Get crypto payments settings (saved with key 'cryptoPayments')
    const cryptoSettingsDoc = await db.collection('settings').findOne({ key: 'cryptoPayments' })
    const cryptoPayments = cryptoSettingsDoc?.value || {}
    
    // Get spin pricing settings (saved with key 'spinPricing')
    const spinPricingDoc = await db.collection('settings').findOne({ key: 'spinPricing' })
    const spinPricing = spinPricingDoc?.value || {}

    if (!cryptoPayments.enabled) {
      return NextResponse.json({
        enabled: false,
        message: 'Crypto payments are not enabled'
      })
    }

    // Currency definitions with logos (using cryptologos.cc)
    const CURRENCY_INFO: Record<string, { name: string; symbol: string; network: string; logo: string }> = {
      'ton': { name: 'Toncoin', symbol: 'TON', network: 'TON', logo: 'https://cryptologos.cc/logos/toncoin-ton-logo.png' },
      'usdt_ton': { name: 'USDT', symbol: 'USDT', network: 'TON', logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
      'usdt_trc20': { name: 'USDT', symbol: 'USDT', network: 'TRC20', logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
      'usdt_bep20': { name: 'USDT', symbol: 'USDT', network: 'BEP20', logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
      'usdc_bep20': { name: 'USDC', symbol: 'USDC', network: 'BEP20', logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png' },
      'btc': { name: 'Bitcoin', symbol: 'BTC', network: 'Bitcoin', logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png' },
      'btc_bep20': { name: 'Bitcoin', symbol: 'BTC', network: 'BEP20', logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png' },
      'eth': { name: 'Ethereum', symbol: 'ETH', network: 'Ethereum', logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png' },
      'trx': { name: 'Tron', symbol: 'TRX', network: 'TRC20', logo: 'https://cryptologos.cc/logos/tron-trx-logo.png' },
      'bnb': { name: 'BNB', symbol: 'BNB', network: 'BEP20', logo: 'https://cryptologos.cc/logos/bnb-bnb-logo.png' },
      'dash': { name: 'Dash', symbol: 'DASH', network: 'Dash', logo: 'https://cryptologos.cc/logos/dash-dash-logo.png' },
      'xlm': { name: 'Stellar', symbol: 'XLM', network: 'Stellar', logo: 'https://cryptologos.cc/logos/stellar-xlm-logo.png' },
      'ltc': { name: 'Litecoin', symbol: 'LTC', network: 'Litecoin', logo: 'https://cryptologos.cc/logos/litecoin-ltc-logo.png' },
      'doge': { name: 'Dogecoin', symbol: 'DOGE', network: 'Dogecoin', logo: 'https://cryptologos.cc/logos/dogecoin-doge-logo.png' },
    }

    // Get enabled currencies with their info
    // enabledCurrencies is stored as {ton: true, btc: true, ...} object
    const enabledCurrenciesObj = cryptoPayments.enabledCurrencies || {}
    const currencyMinAmounts = cryptoPayments.currencyMinAmounts || {}
    
    // Convert object to array of enabled currency IDs
    const enabledCurrencyIds = Object.entries(enabledCurrenciesObj)
      .filter(([_, enabled]) => enabled)
      .map(([id]) => id)
    
    const currencies = enabledCurrencyIds
      .filter((id: string) => CURRENCY_INFO[id])
      .map((id: string) => ({
        id,
        ...CURRENCY_INFO[id],
        minAmount: currencyMinAmounts[id] || 1
      }))

    // Get active packages
    const packages = (spinPricing.packages || [])
      .filter((pkg: { active: boolean }) => pkg.active)
      .map((pkg: { id: string; spins: number; priceUsd: number }) => ({
        id: pkg.id,
        spins: pkg.spins,
        priceUsd: pkg.priceUsd
      }))

    return NextResponse.json({
      enabled: true,
      provider: cryptoPayments.provider || 'nowpayments',
      currencies,
      pricing: {
        pricePerSpin: spinPricing.pricePerSpin || 0.1,
        usePackagesOnly: spinPricing.usePackagesOnly || false,
        packages
      }
    })
  } catch (error) {
    console.error('❌ Get crypto config error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
