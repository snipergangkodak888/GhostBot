"use client"

import { memo } from "react"
import { getLevelProgress } from "@/lib/level-system"

export interface LevelInfo {
  level: number
  medals: number
  minMedals: number
  maxMedals: number
  progress: number // 0-100
}

export function getUserLevel(medals: number): LevelInfo {
  const levelInfo = getLevelProgress(medals)
  return {
    level: levelInfo.level,
    medals: levelInfo.medals,
    minMedals: levelInfo.currentLevelMin,
    maxMedals: levelInfo.nextLevelTarget,
    progress: levelInfo.progressPercent,
  }
}

interface LevelBadgeProps {
  medals: number
  compact?: boolean
}

function LevelBadge({ medals, compact = false }: LevelBadgeProps) {
  const levelInfo = getUserLevel(medals)

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-zinc-600/30 to-zinc-700/30 border border-zinc-500/40">
        <span className="text-[10px]">🏅</span>
        <span className="text-[10px] font-semibold text-zinc-200">Lv.{levelInfo.level}</span>
        <span className="text-[10px] text-white/50">{medals}</span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-zinc-600/30 to-zinc-700/30 border border-zinc-500/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏅</span>
          <div>
            <span className="text-sm font-bold text-zinc-200">Level {levelInfo.level}</span>
            <p className="text-[10px] text-white/40">1v1 Battle Rank</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-white">{medals}</span>
          <p className="text-[10px] text-white/40">Medals</p>
        </div>
      </div>
      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500`}
          style={{
            width: `${levelInfo.progress}%`,
            background: "linear-gradient(90deg, #e5e7eb, #ffffff)",
          }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-white/30">{levelInfo.minMedals}</span>
        <span className="text-[9px] text-white/30">{levelInfo.maxMedals}</span>
      </div>
    </div>
  )
}

export default memo(LevelBadge)
