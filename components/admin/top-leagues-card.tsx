"use client"

export type LeagueItem = { name: string; value: number }

export function TopLeaguesCard({ items }: { items: LeagueItem[] }) {
  const leagues = items || []
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-4">
      <h3 className="font-semibold mb-3">Top Leagues</h3>
      <div className="space-y-3">
        {leagues.map((l)=> (
          <div key={l.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{l.name}</span>
              <span className="text-white">{l.value}%</span>
            </div>
            <div className="h-2 mt-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-green-400" style={{ width: `${l.value}%` }} />
            </div>
          </div>
        ))}
        {leagues.length === 0 && (
          <div className="text-sm text-gray-400 py-6 text-center">No data</div>
        )}
      </div>
    </div>
  )
}
