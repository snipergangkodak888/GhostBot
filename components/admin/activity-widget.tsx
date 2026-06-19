'use client'
import { useState, useEffect } from 'react'
import { Activity, FolderKanban, Wifi, WifiOff } from 'lucide-react'

export function ActivityWidget() {
  const [showProjects, setShowProjects] = useState(true)
  const [stats, setStats] = useState<{ activeProjects: number; remindersScheduled: number } | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const connect = () => {
      fetch('/api/ops/summary', { cache: 'no-store', credentials: 'include' })
        .then((res) => res.json())
        .then((data) => {
          setStats({
            activeProjects: Number(data?.metrics?.activeProjects || 0),
            remindersScheduled: Number(data?.metrics?.remindersScheduled || 0),
          })
          setConnected(true)
        })
        .catch(() => setConnected(false))
    }

    connect()
    const timer = setInterval(connect, 30_000)
    return () => clearInterval(timer)
  }, [])

  const value = stats === null
    ? '...'
    : showProjects
      ? stats.activeProjects
      : stats.remindersScheduled

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-4 flex flex-col gap-4 min-h-[200px]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Ops Pulse</span>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#146efc] animate-pulse" />
              <span className="text-[10px] text-[#146efc]/70 font-medium">LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-white/20" />
              <span className="text-[10px] text-white/20 font-medium">offline</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <p className="text-4xl font-bold text-white tabular-nums leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-white/40 mt-1.5">
          {showProjects ? 'active projects' : 'scheduled reminders'}
        </p>
      </div>

      <div className="h-px bg-white/10" />

      <div className="relative grid grid-cols-2 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <span
          className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-[8px] transition-transform duration-200 ease-in-out"
          style={{
            background: '#146efc',
            transform: showProjects ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
            left: '2px',
          }}
        />
        <button
          onClick={() => setShowProjects(true)}
          className={`relative z-10 flex items-center justify-center gap-1 px-2 py-1.5 rounded-[8px] text-[11px] font-medium transition-colors duration-200 ${
            showProjects ? 'text-[#ffffff] font-semibold' : 'text-white/50 hover:text-white'
          }`}
        >
          <FolderKanban className="h-3 w-3" />
          Projects
        </button>
        <button
          onClick={() => setShowProjects(false)}
          className={`relative z-10 flex items-center justify-center gap-1 px-2 py-1.5 rounded-[8px] text-[11px] font-medium transition-colors duration-200 ${
            !showProjects ? 'text-[#ffffff] font-semibold' : 'text-white/50 hover:text-white'
          }`}
        >
          <Activity className="h-3 w-3" />
          Reminders
        </button>
      </div>
    </div>
  )
}
