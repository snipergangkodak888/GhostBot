'use client'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

const COLORS = ['#22c55e', '#eab308', '#ef4444', '#60a5fa']

export function ChartDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-4 h-64">
      <div className="text-sm font-semibold mb-2">Active Plans Distribution</div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={56} outerRadius={86} paddingAngle={3} stroke="#0a0a0a" strokeWidth={2}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
