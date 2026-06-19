'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export function ChartMini({ data, title = 'Daily Unlock Predictions' }: { data: Array<{ name: string; value: number }>; title?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-4 h-64">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <defs>
              <linearGradient id="g1mini" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke="#6b7280" tickLine={false} axisLine={false} />
            <YAxis stroke="#6b7280" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#0b0f12', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }} />
            <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
