'use client'
import { useState } from 'react'
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, ComposedChart } from 'recharts'

const METRICS = [
  { key: 'a', label: 'Users' },
  { key: 'b', label: 'Active Users' },
  { key: 'c', label: 'Energy' },
  { key: 'd', label: 'Coupons' },
] as const

type MetricKey = typeof METRICS[number]['key']

export function ChartLine({ data, title = 'Performance' }: { data: Array<{ name: string; a: number; b: number; c?: number; d?: number }>; title?: string }) {
  const [active, setActive] = useState<MetricKey>('a')
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-black/60 via-black/40 to-black/60 backdrop-blur-xl p-5 h-80 relative overflow-hidden">
      {/* Ambient glow effects */}
      <div className="absolute top-0 left-1/4 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-1">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setActive(m.key)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={active === m.key
                ? { background: '#146efc', color: '#ffffff' }
                : { background: 'rgba(255,255,255,0.07)', color: '#9ca3af' }
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      
      <div className="h-[240px] relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>

            <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="0" vertical={false} />

            <XAxis
              dataKey="name"
              stroke="#4b5563"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              dy={8}
            />
            <YAxis
              stroke="#4b5563"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              dx={-5}
            />

            <Tooltip
              contentStyle={{
                background: 'rgba(0,0,0,0.9)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                padding: '12px 16px'
              }}
              itemStyle={{ color: '#fff', fontSize: 12 }}
              labelStyle={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}
              cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
              content={({ active: isActive, payload, label }: any) => {
                if (!isActive || !payload?.length) return null
                const entry = payload.find((p: any) => p.dataKey === active)
                if (!entry) return null
                const activeMetric = METRICS.find(m => m.key === active)
                return (
                  <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px' }}>
                    <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 6 }}>{label}</p>
                    <p style={{ color: '#146efc', fontSize: 13, fontWeight: 600 }}>
                      {activeMetric?.label}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                    </p>
                  </div>
                )
              }}
            />

            {/* Render all 4 metrics but hide inactive ones — keeps Recharts DOM stable for animation */}
            {METRICS.map(m => (
              <Area
                key={`area-${m.key}`}
                type="monotone"
                dataKey={m.key}
                stroke="transparent"
                fill={active === m.key ? 'rgba(20,110,252,0.18)' : 'transparent'}
                animationDuration={1200}
                animationBegin={0}
                legendType="none"
                hide={active !== m.key}
                name={`_${m.key}`}
              />
            ))}
            {METRICS.map(m => (
              <Line
                key={`line-${m.key}`}
                type="monotone"
                dataKey={m.key}
                stroke={active === m.key ? '#146efc' : 'transparent'}
                strokeWidth={active === m.key ? 2.5 : 0}
                dot={false}
                activeDot={active === m.key ? { r: 6, fill: '#146efc', stroke: '#8a9a20', strokeWidth: 2 } : false}
                animationDuration={1200}
                animationBegin={0}
                hide={active !== m.key}
                name={m.key}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}