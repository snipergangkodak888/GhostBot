// NOWPayments API Integration
// Documentation: https://documenter.getpostman.com/view/7907941/S1a32n38

import fetch from 'node-fetch'

interface NOWPaymentsConfig {
  apiKey: string
  sandbox?: boolean
}

interface CreatePaymentParams {
  price_amount: number
  price_currency: string // USD, EUR, etc.
  pay_currency: string // btc, eth, usdttrc20, ton, etc.
  order_id: string
  order_description?: string
  ipn_callback_url?: string
  success_url?: string
  cancel_url?: string
}

interface PaymentStatusResponse {
  payment_id: string
  payment_status: 'waiting' | 'confirming' | 'confirmed' | 'sending' | 'partially_paid' | 'finished' | 'failed' | 'refunded' | 'expired'
  pay_address: string
  price_amount: number
  price_currency: string
  pay_amount: number
  pay_currency: string
  order_id: string
  order_description: string
  created_at: string
  updated_at: string
  actually_paid?: number
  outcome_amount?: number
  outcome_currency?: string
}

interface AvailableCurrency {
  code: string
  name: string
  logo_url?: string
}

export class NOWPaymentsAPI {
  private apiKey: string
  private baseUrl: string

  constructor(config: NOWPaymentsConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.sandbox 
      ? 'https://api-sandbox.nowpayments.io/v1' 
      : 'https://api.nowpayments.io/v1'
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    }

    try {
      const response = await fetch(url, { ...options, headers })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || `NOWPayments API error: ${response.status}`)
      }

      return data
    } catch (error) {
      console.error('NOWPayments API request failed:', error)
      throw error
    }
  }

  // Get API status
  async getStatus() {
    return this.request('/status')
  }

  // Get available currencies
  async getAvailableCurrencies(): Promise<{ currencies: string[] }> {
    return this.request('/currencies')
  }

  // Get available currencies with full info
  async getAvailableFullCurrencies(): Promise<{ currencies: AvailableCurrency[] }> {
    return this.request('/full-currencies')
  }

  // Get estimated price in crypto
  async getEstimatePrice(params: { 
    amount: number
    currency_from: string // USD, EUR, etc.
    currency_to: string // btc, eth, etc.
  }) {
    const query = new URLSearchParams({
      amount: params.amount.toString(),
      currency_from: params.currency_from,
      currency_to: params.currency_to,
    })
    return this.request(`/estimate?${query}`)
  }

  // Create payment
  async createPayment(params: CreatePaymentParams) {
    return this.request('/payment', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // Get payment status
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResponse> {
    return this.request(`/payment/${paymentId}`)
  }

  // Get minimum payment amount for a currency
  async getMinimumPaymentAmount(currency: string) {
    return this.request(`/min-amount?currency_from=usd&currency_to=${currency}`)
  }

  // Verify IPN callback
  verifyIPN(signature: string, payload: string, ipnSecret: string): boolean {
    const crypto = require('crypto')
    const hmac = crypto.createHmac('sha512', ipnSecret)
    hmac.update(payload)
    const calculatedSignature = hmac.digest('hex')
    return signature === calculatedSignature
  }
}

// Helper function to check if payment is completed
export function isPaymentCompleted(status: string): boolean {
  return status === 'finished' || status === 'confirmed'
}

// Helper function to check if payment is pending
export function isPaymentPending(status: string): boolean {
  return status === 'waiting' || status === 'confirming' || status === 'sending'
}

// Helper function to check if payment failed
export function isPaymentFailed(status: string): boolean {
  return status === 'failed' || status === 'expired' || status === 'refunded'
}

export default NOWPaymentsAPI
