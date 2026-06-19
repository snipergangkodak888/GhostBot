"use client"

import { Card } from '@/components/ui/card'
import { Coins, Wallet, TrendingUp, Sparkles } from 'lucide-react'

interface TokenBalanceCardProps {
  tokens: number | null
  tokensPerSecond?: number
  variant?: 'idle' | 'mine' | 'hold' | 'default'
  icon?: React.ReactNode
}

export default function TokenBalanceCard({ 
  tokens, 
  tokensPerSecond, 
  variant = 'default',
  icon 
}: TokenBalanceCardProps) {
  const formatNumber = (num: number) => {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'
    return num.toLocaleString()
  }

  // Clean monochrome gradients like StellarGram
  const gradientClasses = {
    default: 'from-white/10 to-white/5 border-white/20',
    idle: 'from-white/10 to-white/5 border-white/20',
    mine: 'from-white/15 to-white/5 border-white/30',
    hold: 'from-white/10 to-white/5 border-white/20',
  }

  return (
    <Card className={`p-4 bg-gradient-to-br ${gradientClasses[variant]} text-white border backdrop-blur-xl`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">Total Tokens</p>
          <h2 className="text-3xl font-bold text-white">{tokens === null ? '...' : formatNumber(tokens)}</h2>
          {tokensPerSecond !== undefined && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {formatNumber(tokensPerSecond)}/sec
            </p>
          )}
        </div>
        <div className="flex flex-col items-center gap-2">
          {icon || <Sparkles className="w-12 h-12 text-white/20" />}
          <button
            onClick={() => window.location.href = '/dashboard/wallet'}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors border border-white/20"
            aria-label="Go to Wallet"
          >
            <Wallet className="w-5 h-5" />
          </button>
        </div>
      </div>
    </Card>
  )
}
