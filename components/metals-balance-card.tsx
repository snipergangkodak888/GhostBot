"use client"

import { memo } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/contexts/language-context"
import AnimatedIcon from "@/components/animated-icon"

interface MetalsBalanceCardProps {
  metals: number | null
  metalPriceUsd: number
}

function MetalsBalanceCard({ metals, metalPriceUsd }: MetalsBalanceCardProps) {
  const router = useRouter()
  const { t } = useLanguage()

  const formatNumber = (num: number) => {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B"
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M"
    if (num >= 1e3) return (num / 1e3).toFixed(2) + "K"
    return num.toLocaleString()
  }

  const balanceInUsd = metals !== null && metalPriceUsd > 0 ? metals * metalPriceUsd : 0

  return (
    <button
      onClick={() => router.push("/dashboard/wallet")}
      className="w-full rounded-2xl bg-gradient-to-br from-[#FFD700]/10 to-[#B8860B]/10 border border-[#FFD700]/20 p-4 text-left transition-all active:scale-[0.98] hover:border-[#FFD700]/30"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#FFD700]/60 font-medium">{t('metalBalance', 'Metal Balance')}</p>
          <h2 className="text-2xl font-bold text-white mt-0.5">
            {metals === null ? "..." : formatNumber(metals)}
            <span className="text-sm font-normal text-[#FFD700]/50 ml-1.5">METAL</span>
          </h2>
          <p className="text-xs text-white/40 mt-1">
            ≈ ${balanceInUsd.toFixed(2)} USDT
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-full bg-[#FFD700]/10 flex items-center justify-center border border-[#FFD700]/20">
            <AnimatedIcon src="/images/Icons/wallet.webp" autoPlay className="w-5 h-5" />
          </div>
          <span className="text-[9px] text-[#FFD700]/50">{t('withdraw', 'Withdraw')}</span>
        </div>
      </div>
    </button>
  )
}

export default memo(MetalsBalanceCard)
