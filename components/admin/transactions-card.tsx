"use client"

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export type TransactionItem = { 
  id: string
  user: string
  type: string
  currency?: string
  spins?: number
  amount: string | number
  time: string
  photoUrl?: string | null
}

// Currency logo mapping
const CURRENCY_LOGOS: Record<string, string> = {
  'TON': '/images/Stickers/ton_symbol.png',
  'TONCOIN': '/images/Stickers/ton_symbol.png',
  'USDT': '/images/Stickers/USDT.png',
  'USDTTRC20': '/images/Stickers/USDT.png',
  'USDTBEP20': '/images/Stickers/USDT.png',
  'USDTTON': '/images/Stickers/USDT.png',
  'STARS': '/images/Stickers/Star.png',
  'BTC': 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
  'ETH': 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
  'BNB': 'https://cryptologos.cc/logos/bnb-bnb-logo.png',
  'TRX': 'https://cryptologos.cc/logos/tron-trx-logo.png',
  'LTC': 'https://cryptologos.cc/logos/litecoin-ltc-logo.png',
  'DOGE': 'https://cryptologos.cc/logos/dogecoin-doge-logo.png',
}

export function TransactionsCard({ items }: { items: TransactionItem[] }) {
  const data = items || []
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-4">
      <Link href="/admin/purchases" className="flex items-center justify-between mb-3 group cursor-pointer">
        <div className="flex items-center gap-2">
          <img src="/images/Stickers/money-bag.webp" alt="" className="h-10 w-10" />
          <h3 className="font-semibold text-white">Recent Purchases</h3>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-500 group-hover:text-white transition-colors" />
      </Link>
      <div className="divide-y divide-white/5">
        {data.map((t)=> {
          const currencyLogo = t.currency ? CURRENCY_LOGOS[t.currency] || '/images/Stickers/coin.webp' : '/images/Stickers/coin.webp'
          const isStars = t.type === 'stars'
          
          return (
            <div key={t.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                {/* User Photo or Currency Icon */}
                {t.photoUrl ? (
                  <img src={t.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-white">{t.user.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-white">{t.user}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1">
                    <span>{t.spins || 0} spins</span>
                    <span>·</span>
                    <span>{t.time}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <img 
                  src={currencyLogo} 
                  alt={t.currency || 'Currency'} 
                  className="w-5 h-5 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/images/Stickers/coin.webp' }}
                />
                <div className="text-right">
                  <div className={`text-sm font-semibold ${isStars ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {isStars ? t.amount : `$${t.amount}`}
                  </div>
                  <div className="text-[10px] text-gray-500">{t.currency || 'CRYPTO'}</div>
                </div>
              </div>
            </div>
          )
        })}
        {data.length === 0 && (
          <div className="text-sm text-gray-400 py-6 text-center">No recent purchases</div>
        )}
      </div>
    </div>
  )
}
