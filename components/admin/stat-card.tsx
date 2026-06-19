'use client'
import { ReactNode, useState } from 'react'
import { Info } from 'lucide-react'

export function StatCard({ title, value, delta, icon, tooltip, valueClassName }: { title: string; value: ReactNode; delta?: string; icon?: ReactNode; tooltip?: string; valueClassName?: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">{title}</div>
          <div className={`mt-1 text-xl sm:text-2xl font-bold ${valueClassName || ''}`}>{value}</div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {tooltip && (
            <div className="relative">
              <button
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onClick={() => setShowTooltip(!showTooltip)}
                className="p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <Info className="w-4 h-4 text-gray-400" />
              </button>
              {showTooltip && (
                <div className="absolute right-0 top-full mt-1 z-50 px-3 py-2 text-xs bg-gray-900 border border-white/20 rounded-lg shadow-xl whitespace-nowrap">
                  {tooltip}
                </div>
              )}
            </div>
          )}
          {icon}
        </div>
      </div>
    </div>
  )
}
