// PayKassa API Integration
// Documentation: https://paykassa.pro/en/docs/

import crypto from 'crypto'

interface PayKassaConfig {
  merchantId: string
  apiKey: string
  secretKey: string
  testMode?: boolean
}

// PayKassa currency system IDs
export const PAYKASSA_CURRENCIES: Record<string, { systemId: number; currencyId: string }> = {
  'btc': { systemId: 11, currencyId: 'BTC' },
  'btc_bep20': { systemId: 16, currencyId: 'BTC' },
  'eth': { systemId: 12, currencyId: 'ETH' },
  'usdt_trc20': { systemId: 14, currencyId: 'USDT' },
  'usdt_bep20': { systemId: 16, currencyId: 'USDT' },
  'usdt_ton': { systemId: 27, currencyId: 'USDT' },
  'usdc_bep20': { systemId: 16, currencyId: 'USDC' },
  'ton': { systemId: 27, currencyId: 'TON' },
  'trx': { systemId: 14, currencyId: 'TRX' },
  'bnb': { systemId: 16, currencyId: 'BNB' },
  'dash': { systemId: 6, currencyId: 'DASH' },
  'xlm': { systemId: 9, currencyId: 'XLM' },
  'ltc': { systemId: 5, currencyId: 'LTC' },
  'doge': { systemId: 15, currencyId: 'DOGE' },
}

interface CreateInvoiceParams {
  amount: number
  currency: string // USD
  orderId: string
  comment?: string
  payCurrency: string // btc, eth, usdt_trc20, etc.
}

interface InvoiceResponse {
  success: boolean
  error?: string
  data?: {
    invoice_id: string
    url: string
    amount: number
    amount_pay: number
    currency: string
    system: string
    address?: string
    tag?: string
    expiration_time?: string
  }
}

interface IPNData {
  transaction: string
  shop: string
  order_id: string
  amount: string
  currency: string
  system: string
  address: string
  tag?: string
  hash: string
  partial: string
}

export class PayKassaAPI {
  private merchantId: string
  private apiKey: string
  private secretKey: string
  private testMode: boolean
  private baseUrl = 'https://paykassa.app/sci/0.4/index.php'
  private apiUrl = 'https://paykassa.app/api/0.5/index.php'

  constructor(config: PayKassaConfig) {
    this.merchantId = config.merchantId
    this.apiKey = config.apiKey
    this.secretKey = config.secretKey
    this.testMode = config.testMode || false
  }

  // Generate signature for API requests
  private generateSignature(params: Record<string, string | number>): string {
    const sortedKeys = Object.keys(params).sort()
    const signString = sortedKeys.map(key => params[key]).join(':') + this.apiKey
    return crypto.createHash('md5').update(signString).digest('hex')
  }

  // Create invoice for payment
  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResponse> {
    const currencyInfo = PAYKASSA_CURRENCIES[params.payCurrency.toLowerCase()]
    
    if (!currencyInfo) {
      return {
        success: false,
        error: `Unsupported currency: ${params.payCurrency}`
      }
    }

    const requestParams = {
      func: 'sci_create_order',
      api_id: this.apiKey,
      amount: params.amount.toFixed(2),
      currency: params.currency.toUpperCase(),
      order_id: params.orderId,
      comment: params.comment || `Payment for order ${params.orderId}`,
      system: currencyInfo.systemId.toString(),
      phone: 'false',
      paid_commission: 'shop', // Shop pays commission
      test: this.testMode ? '1' : '0',
    }

    try {
      const formData = new URLSearchParams()
      Object.entries(requestParams).forEach(([key, value]) => {
        formData.append(key, value)
      })

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      })

      const data = await response.json()

      if (data.error) {
        return {
          success: false,
          error: data.message || 'PayKassa API error'
        }
      }

      return {
        success: true,
        data: {
          invoice_id: data.data?.invoice_id || data.data?.hash || params.orderId,
          url: data.data?.url || '',
          amount: params.amount,
          amount_pay: parseFloat(data.data?.amount_pay || '0'),
          currency: params.currency,
          system: params.payCurrency,
          address: data.data?.wallet || data.data?.address,
          tag: data.data?.tag || data.data?.memo,
          expiration_time: data.data?.expiration_time,
        }
      }
    } catch (error) {
      console.error('PayKassa API error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Check payment status
  async checkPaymentStatus(transactionId: string): Promise<{ success: boolean; status?: string; error?: string }> {
    const requestParams = {
      func: 'sci_confirm_order',
      api_id: this.apiKey,
      transaction: transactionId,
    }

    try {
      const formData = new URLSearchParams()
      Object.entries(requestParams).forEach(([key, value]) => {
        formData.append(key, value)
      })

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      })

      const data = await response.json()

      if (data.error) {
        return {
          success: false,
          error: data.message || 'Status check failed'
        }
      }

      return {
        success: true,
        status: data.data?.status || 'unknown'
      }
    } catch (error) {
      console.error('PayKassa status check error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Verify IPN callback signature
  verifyIPN(data: IPNData): boolean {
    const { hash, ...params } = data
    
    // Build signature string: api_id:transaction:shop:amount:currency:system:address:tag:partial
    const signParts = [
      this.apiKey,
      params.transaction,
      params.shop,
      params.amount,
      params.currency,
      params.system,
      params.address,
      params.tag || '',
      params.partial
    ]
    
    const signString = signParts.join(':')
    const calculatedHash = crypto.createHash('md5').update(signString).digest('hex')
    
    return hash === calculatedHash
  }

  // Alternative IPN verification using secret key
  verifyIPNWithSecret(orderId: string, amount: string, receivedHash: string): boolean {
    const signString = `${this.secretKey}:${orderId}:${amount}`
    const calculatedHash = crypto.createHash('md5').update(signString).digest('hex')
    return receivedHash === calculatedHash
  }
}

// Helper to get PayKassa system ID from our currency ID
export function getPayKassaSystemId(currency: string): number | null {
  const info = PAYKASSA_CURRENCIES[currency.toLowerCase()]
  return info?.systemId || null
}

export default PayKassaAPI
