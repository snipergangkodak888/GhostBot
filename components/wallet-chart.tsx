"use client"

import { useRef } from "react"
import { Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"

interface ChartData {
  label: string
  balance: number
}

interface WalletChartProps {
  data: ChartData[]
  mode?: 'tokens' | 'usdt'
}

export function WalletChart({ data, mode = 'tokens' }: WalletChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  if (!data || data.length === 0) {
    return null
  }

  return (
    <div className="relative h-full w-[calc(100%+2rem)] -ml-4" ref={chartRef}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 16, left: 16, bottom: 8 }}
        >
          <defs>
            <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="rgb(16, 185, 129)" stopOpacity={0.6} />
              <stop offset="50%" stopColor="rgb(16, 185, 129)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="rgb(16, 185, 129)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={[(dataMin: number) => Math.max(0, dataMin - (dataMin * 0.15)), 'auto']} />
          <Tooltip
            cursor={false}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const raw = Number(payload[0].value)
                const value = mode === 'usdt'
                  ? `$${raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : raw.toLocaleString()
                return (
                  <div className="wallet-chart-tooltip">
                    <p className="font-semibold text-white/60 mb-0.5 text-[10px]">{label}</p>
                    <p className="text-white font-bold text-sm">{value}</p>
                  </div>
                )
              }
              return null
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="rgb(16, 185, 129)"
            fill="url(#balanceGradient)"
            fillOpacity={1}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#10b981", stroke: "#000", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
