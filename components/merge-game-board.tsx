"use client"

import React, { useState, useRef, useCallback, useEffect, memo } from "react"
import { Trash2, Zap, Ticket, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { useMergeGame, type MergeItem, type MergeReward } from "@/contexts/merge-game-context"
import { fireConfetti } from "@/lib/confetti-fire"

const GRID_GAP = 6

interface DragState {
  item: MergeItem
  startRow: number
  startCol: number
  currentX: number
  currentY: number
  ghostSize: number
}

// ─── Reward Progress Track (vertical) ────────────────────────────────────────

// Keyframes injected once
const PulseKeyframes = () => (
  <style>{`
    @keyframes vv-pulse {
      0%,100% { opacity:.4; transform:scale(1); }
      50%      { opacity:.9; transform:scale(1.22); }
    }
    @keyframes vv-check {
      0%   { transform:scale(0) rotate(-30deg); opacity:0; }
      70%  { transform:scale(1.2) rotate(4deg);  opacity:1; }
      100% { transform:scale(1)   rotate(0deg);  opacity:1; }
    }
  `}</style>
)

/* Sizes */
const SZ_CURRENT  = 52
function RewardProgressTrack({
  itemDefs,
  highestLevel,
  unlockedLevelPrizes = [],
}: {
  itemDefs: Record<number, { emoji: string; name: string; prizeType?: string; prizeAmount?: number; iconUrl?: string }>
  highestLevel: number
  unlockedLevelPrizes?: number[]
}) {
  const levels = Object.keys(itemDefs).map(Number).sort((a, b) => a - b)

  return (
    <div className="space-y-3">
      {levels.map((lvl) => {
        const def         = itemDefs[lvl]
        const isAchieved  = lvl < highestLevel || unlockedLevelPrizes.includes(lvl)
        const isCurrent   = lvl === highestLevel && !unlockedLevelPrizes.includes(lvl)
        const isLocked    = lvl > highestLevel
        const prizeType   = def?.prizeType ?? (lvl % 2 === 0 ? "promo_code" : lvl > 1 ? "energy" : "none")
        const prizeAmount = def?.prizeAmount && def.prizeAmount > 0 ? def.prizeAmount : 100
        // Item icon (left) — shows the merge item itself
        const itemEmoji   = def?.emoji ?? "❓"
        // Prize icon (shown in subtitle) — shows what reward you get
          const prizeIcon   = prizeType === "energy" ? "⚡" : prizeType === "promo_code" ? "🎟️" : prizeType === "unlock_board_slot" ? "🔓" : null

        return (
          <div key={lvl}
            className="p-3 rounded-xl border flex items-center gap-3"
            style={{
              background: isCurrent ? "rgba(195,216,46,0.07)" : "rgba(24,24,27,0.8)",
              borderColor: isCurrent ? "rgba(195,216,46,0.35)" : isAchieved ? "rgba(255,255,255,0.08)" : "rgba(39,39,42,1)",
              opacity: isLocked ? 0.5 : 1,
            }}
          >
            {/* Item icon (merge item visual) */}
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
              style={{ background: isCurrent ? "rgba(195,216,46,0.15)" : isAchieved ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.04)" }}
            >
              {def?.iconUrl
                ? <img src={def.iconUrl} alt="" className="w-7 h-7 object-contain rounded" />
                : <span style={{ opacity: isLocked ? 0.4 : 1 }}>{itemEmoji}</span>
              }
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: isCurrent ? "#ffffff" : isAchieved ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.30)" }}>
                {def?.name ?? `Level ${lvl}`}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: isCurrent ? "rgba(195,216,46,0.15)" : "rgba(255,255,255,0.06)",
                    color: isCurrent ? "#C3D82E" : "rgba(255,255,255,0.30)",
                  }}>Lv.{lvl}</span>
                {prizeType !== "none" && prizeIcon && (
                  <span className="text-[11px] font-semibold flex items-center gap-0.5" style={{ color: isLocked ? "rgba(255,255,255,0.20)" : prizeType === "energy" ? "#C3D82E" : "#ffc040" }}>
                      {prizeIcon} {prizeType === "energy" ? `+${prizeAmount} Energy` : prizeType === "unlock_board_slot" ? "Unlock Slot" : "Promo Code"}
                  </span>
                )}
                {prizeType === "none" && lvl === 1 && (
                  <span className="text-[10px] text-white/20 italic">No prize</span>
                )}
              </div>
            </div>

            {/* Status badge */}
            <div className="flex-shrink-0">
              {isAchieved ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs font-medium">Achieved</span>
                </div>
              ) : isCurrent ? (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                  style={{ background: "rgba(195,216,46,0.18)", color: "#C3D82E", border: "1px solid rgba(195,216,46,0.35)" }}>Current</span>
              ) : (
                <span className="text-[10px] text-white/20">🔒</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Board ───────────────────────────────────────────────────────────────

export { RewardProgressTrack }

// ─── Promo Wins Ticker ────────────────────────────────────────────────────────
interface PromoWin {
  id: string
  description: string
  type: string
  assignedAt: string
  firstName: string | null
  username: string | null
}

function maskName(firstName: string | null, username: string | null): string {
  const raw = (firstName || username || 'User').trim()
  return raw.slice(0, 3) + '****'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const FAKE_NAMES = ['Alex', 'Maria', 'John', 'Sara', 'Mike', 'Elena', 'Nick', 'Anna', 'Tom', 'Kate', 'Luca', 'Ines', 'Omar', 'Priya', 'Dan', 'Yuki', 'Carlos', 'Zara', 'Ben', 'Mia']
const FAKE_TYPES = ['Casino Bonus', 'Free Spins', 'Sports Bet', 'VIP Reward', 'Welcome Bonus', 'Reload Bonus', 'Cashback', 'Match Bonus', 'Loyalty Reward', 'Daily Bonus']

function makeFakeWin(seed: number): PromoWin {
  const name = FAKE_NAMES[seed % FAKE_NAMES.length]
  const type = FAKE_TYPES[seed % FAKE_TYPES.length]
  const id = `fake-${seed}`
  const minutesAgo = ((seed * 37) % 71) * 60_000 + ((seed * 13) % 59) * 1_000
  const hoursAgo = (seed * 7) % 72
  const assignedAt = new Date(Date.now() - hoursAgo * 3600_000 - minutesAgo).toISOString()
  return { id, description: type, type, assignedAt, firstName: name, username: null }
}

// Inject ticker keyframes once into <head> — never re-injects on re-render
function useTickerKeyframes() {
  useEffect(() => {
    const id = 'vv-ticker-keyframes'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
      @keyframes ticker-rtl {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      @keyframes ticker-ltr {
        0%   { transform: translateX(-50%); }
        100% { transform: translateX(0); }
      }
    `
    document.head.appendChild(el)
  }, [])
}

const TickerRow = memo(function TickerRow({ items, direction }: { items: PromoWin[]; direction: 'ltr' | 'rtl' }) {
  const doubled = [...items, ...items]
  const animName = direction === 'rtl' ? 'ticker-rtl' : 'ticker-ltr'
  return (
    <div className="w-full overflow-hidden" style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)' }}>
      <div
        className="flex gap-2"
        style={{ width: 'max-content', animation: `${animName} 120s linear infinite`, willChange: 'transform' }}
      >
        {doubled.map((w, i) => (
          <div
            key={w.id + '-' + i}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10"
          >
            <span className="text-xs font-bold text-white/80">{maskName(w.firstName, w.username)}</span>
            <span className="text-[10px] text-white/30">won a</span>
            <span className="text-xs font-semibold text-[#C3D82E]">{w.description || (w.type === 'casino' ? 'Casino Bonus' : w.type === 'sports' ? 'Sports Bonus' : 'Promo Reward')}</span>
            <span className="text-[10px] text-white/25">{formatTime(w.assignedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export const PromoWinsTicker = memo(function PromoWinsTicker() {
  useTickerKeyframes()

  const DEFAULT_LABELS = ['Casino Bonus', 'Free Spins', 'Sports Bet', 'VIP Reward', 'Welcome Bonus', 'Reload Bonus', 'Cashback', 'Match Bonus', 'Loyalty Reward', 'Daily Bonus']

  const makeFakeWinWithLabels = (seed: number, labels: string[]): PromoWin => {
    const name = FAKE_NAMES[seed % FAKE_NAMES.length]
    const type = labels[seed % labels.length]
    const id = `fake-${seed}`
    const minutesAgo = ((seed * 37) % 71) * 60_000 + ((seed * 13) % 59) * 1_000
    const hoursAgo = (seed * 7) % 72
    const assignedAt = new Date(Date.now() - hoursAgo * 3600_000 - minutesAgo).toISOString()
    return { id, description: type, type, assignedAt, firstName: name, username: null }
  }

  const buildFakeRows = (labels = DEFAULT_LABELS): [PromoWin[], PromoWin[]] => [
    Array.from({ length: 20 }, (_, i) => makeFakeWinWithLabels(i, labels)),
    Array.from({ length: 20 }, (_, i) => makeFakeWinWithLabels(i + 10, labels)),
  ]

  const [rows, setRows] = useState<[PromoWin[], PromoWin[]] | null>(() => buildFakeRows())

  useEffect(() => {
    fetch('/api/public-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(async d => {
        const show = d?.settings?.showPromoWinsTicker !== false
        if (!show) return

        const fakeMode = d?.settings?.fakePromoWinsTicker === true
        const labels: string[] = Array.isArray(d?.settings?.tickerPrizeLabels) && d.settings.tickerPrizeLabels.length > 0
          ? d.settings.tickerPrizeLabels
          : DEFAULT_LABELS

        let realWins: PromoWin[] = []
        try {
          const res = await fetch('/api/public/promo-wins', { cache: 'no-store' })
          const data = await res.json()
          if (data.success) {
            realWins = (data.wins as any[]).map((w, i) => ({ ...w, id: w.assignedAt + w.type + i }))
          }
        } catch {}

        const buildRow = (offset: number): PromoWin[] => {
          const out: PromoWin[] = []
          for (let i = 0; i < 20; i++) {
            if (realWins.length > 0) {
              out.push(realWins[(i + offset) % realWins.length])
            } else {
              out.push(makeFakeWinWithLabels(i + offset * 23, labels))
            }
          }
          return out
        }

        setRows([buildRow(0), buildRow(10)])
      })
      .catch(() => {
        setRows(buildFakeRows())
      })
  }, [])

  if (!rows) return null

  return (
    <div className="w-full flex flex-col gap-1.5">
      <TickerRow items={rows[0]} direction="rtl" />
      <TickerRow items={rows[1]} direction="ltr" />

    </div>
  )
})

// Rendered as a sibling of MergeGameBoard so game re-renders never touch it.
export const MergeGameEffects = memo(function MergeGameEffects() {
  const { highestLevel, itemDefs, rewards } = useMergeGame()
  const [rewardPopup, setRewardPopup] = useState<MergeReward | null>(null)
  const [isLevel8Reward, setIsLevel8Reward] = useState(false)
  const lastRewardsLenRef = useRef(0)
  const lastHighestLevelRef = useRef(0)

  // Fire confetti (imperative — no canvas in React tree) on every level-up
  useEffect(() => {
    if (lastHighestLevelRef.current === 0) {
      lastHighestLevelRef.current = highestLevel
      return
    }
    if (highestLevel <= lastHighestLevelRef.current) return
    lastHighestLevelRef.current = highestLevel
    const def = itemDefs[highestLevel]
    const name = def?.name ?? `Level ${highestLevel}`
    toast.success(`🎉 Merged to ${def?.emoji ?? ''} ${name}!`, { duration: 2500 })
    const isMax = highestLevel >= Object.keys(itemDefs).length
    fireConfetti(isMax ? "max" : "normal")
  }, [highestLevel, itemDefs])

  // Show popup + toast whenever server awards a prize
  useEffect(() => {
    if (rewards.length <= lastRewardsLenRef.current) {
      lastRewardsLenRef.current = rewards.length
      return
    }
    const newest = rewards[rewards.length - 1]
    lastRewardsLenRef.current = rewards.length
    if (!newest) return
    const isMax = newest.label?.includes('Level 8') || newest.label?.includes('VIVATBET Reward')
    if (newest.type === 'bonus_energy') {
      toast.success(`⚡ +${newest.label ?? 'Energy'} rewarded!`, { duration: 3000 })
      setIsLevel8Reward(false)
      fireConfetti("normal")
    } else if (newest.type === 'badge') {
      toast.success(newest.label, { duration: 4000 })
      setIsLevel8Reward(false)
      fireConfetti("normal")
    } else {
      if (isMax) {
        toast.success(`🏆 MAX LEVEL! Promo code: ${newest.value}`, { duration: 6000 })
        fireConfetti("max")
        setIsLevel8Reward(true)
      } else {
        toast.success(`🎟️ Promo code unlocked! Check your rewards.`, { duration: 4000 })
        setIsLevel8Reward(false)
        fireConfetti("normal")
      }
    }
    setRewardPopup(newest)
  }, [rewards])

  useEffect(() => {
    if (!rewardPopup) return
    const t = setTimeout(() => setRewardPopup(null), isLevel8Reward ? 5500 : 2800)
    return () => clearTimeout(t)
  }, [rewardPopup, isLevel8Reward])

  if (!rewardPopup) return null

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] pointer-events-none px-4">
      <p className="text-center text-sm sm:text-base font-semibold text-[#C3D82E]">
        {isLevel8Reward ? "🏆 MAX LEVEL! " : "🎉 "}
        {rewardPopup.label}
        {rewardPopup.type === "promo_code" ? ` (${rewardPopup.value})` : ""}
      </p>
    </div>
  )
})

const MemoCell = memo(function MemoCell({
  cell,
  ri,
  ci,
  isDragSource,
  isFlashing,
  isSelected,
  selectedCell, // NOTE: intentionally omitted, use locked prop instead
  locked,
  itemDefs,
  setSelectedCell,
  handleDragStart,
}: {
  cell: MergeItem | null
  ri: number
  ci: number
  isDragSource: boolean
  isFlashing: boolean
  isSelected: boolean
  selectedCell?: any
  locked?: boolean
  itemDefs?: Record<number, { emoji: string; name: string; prizeType?: string; prizeAmount?: number; iconUrl?: string }>
  setSelectedCell: (val: { row: number; col: number } | null) => void
  handleDragStart: (item: MergeItem, e: React.TouchEvent | React.MouseEvent) => void
}) {
  return (
    <div
      data-merge-cell="true"
      data-row={ri}
      data-col={ci}
      onClick={() => {
        if (!cell) setSelectedCell(null)
      }}
      className={[
        "relative rounded-xl flex items-center justify-center",
        "transition-transform duration-150 cursor-pointer",
        locked ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        isFlashing ? "ring-2 ring-[#C3D82E] scale-110 z-20" : "",
        isSelected ? "ring-2 ring-white scale-105 z-10" : "",
        !cell
          ? "border border-dashed border-white/10"
          : "border border-white/15",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        aspectRatio: "1 / 1",
        background: "transparent",
      }}
    >
      {locked && !cell && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <img src="/images/vivaimgs/items/lock.png" alt="locked" className="w-3/4 h-3/4 object-contain opacity-50" />
        </span>
      )}
      {cell && (
        <div
          className={`flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none w-full h-full transition-opacity ${
            isDragSource ? "opacity-0" : "opacity-100"
          }`}
          style={{
            touchAction: "none",
            pointerEvents: isDragSource ? "none" : "auto",
          }}
          onDragStart={(e) => e.preventDefault()}
          onTouchStart={(e) => {
            e.stopPropagation()
            e.preventDefault()
            handleDragStart(cell, e)
          }}
          onMouseDown={(e) => handleDragStart(cell, e)}
        >
          {(cell && itemDefs?.[cell.level]?.iconUrl)
            ? <img
                src={itemDefs[cell.level]!.iconUrl}
                alt={itemDefs[cell.level]?.name ?? ''}
                className="absolute inset-0 w-full h-full object-contain p-1 pointer-events-none"
              />
            : <span className="text-4xl leading-none">{cell?.emoji}</span>
          }
        </div>
      )}
    </div>
  )
})

export default function MergeGameBoard() {
  const {
    grid,
    energy,
    score,
    highestLevel,
    itemDefs,
    spawnItem,
    mergeItems,
    moveItem,
    removeItem,
    canSpawn,
    boardFull,
    rewards,
    pendingCouponChoices,
    resolveCouponChoice,
    isCellLocked,
  } = useMergeGame()

  const [dragState, setDragState] = useState<DragState | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [mergeFlash, setMergeFlash] = useState<string | null>(null)
  const [couponChoiceResolving, setCouponChoiceResolving] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)

  const getBoardPoint = useCallback((clientX: number, clientY: number) => {
    if (!boardRef.current) return { x: 0, y: 0 }
    const rect = boardRef.current.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const getCellFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      // Prefer element-based detection (most accurate)
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
      const cellEl = el?.closest("[data-merge-cell='true']") as HTMLElement | null
      if (cellEl) {
        const row = Number(cellEl.dataset.row)
        const col = Number(cellEl.dataset.col)
        if (!Number.isNaN(row) && !Number.isNaN(col)) return { row, col }
      }
      // Fallback: compute from board rect + actual cell width
      if (!boardRef.current) return null
      const firstCell = boardRef.current.querySelector(
        "[data-merge-cell='true']"
      ) as HTMLElement | null
      const cellW = firstCell ? firstCell.offsetWidth : 64
      const rect = boardRef.current.getBoundingClientRect()
      const x = clientX - rect.left - GRID_GAP
      const y = clientY - rect.top - GRID_GAP
      const col = Math.floor(x / (cellW + GRID_GAP))
      const row = Math.floor(y / (cellW + GRID_GAP))
      if (row >= 0 && row < grid.length && col >= 0 && col < (grid[0]?.length ?? 0)) {
        return { row, col }
      }
      return null
    },
    [grid]
  )

  const handleDragStart = useCallback(
    (item: MergeItem, e: React.TouchEvent | React.MouseEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
      const boardPoint = getBoardPoint(clientX, clientY)
      // Snapshot actual rendered cell size from DOM once — stable for entire drag
      const cellEl = boardRef.current?.querySelector(
        "[data-merge-cell='true']"
      ) as HTMLElement | null
      const ghostSize = cellEl ? cellEl.offsetWidth : 64
      setSelectedCell(null)
      const next: DragState = {
        item,
        startRow: item.row,
        startCol: item.col,
        currentX: boardPoint.x,
        currentY: boardPoint.y,
        ghostSize,
      }
      dragStateRef.current = next
      setDragState(next)
    },
    [getBoardPoint]
  )

  const handleDragMove = useCallback(
    (e: TouchEvent | MouseEvent) => {
      if (!dragStateRef.current) return
      if (e.cancelable) e.preventDefault()
      const clientX = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX
      const clientY = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY
      const boardPoint = getBoardPoint(clientX, clientY)
      setDragState((prev) => {
        if (!prev) return null
        const next = { ...prev, currentX: boardPoint.x, currentY: boardPoint.y }
        dragStateRef.current = next
        return next
      })
    },
    [getBoardPoint]
  )

  const handleDragEnd = useCallback(
    (e: TouchEvent | MouseEvent) => {
      const cur = dragStateRef.current
      if (!cur) return
      const clientX =
        "changedTouches" in e
          ? (e as TouchEvent).changedTouches[0].clientX
          : (e as MouseEvent).clientX
      const clientY =
        "changedTouches" in e
          ? (e as TouchEvent).changedTouches[0].clientY
          : (e as MouseEvent).clientY
      const target = getCellFromPoint(clientX, clientY)

      if (target && (target.row !== cur.startRow || target.col !== cur.startCol)) {
        const targetItem = grid[target.row]?.[target.col]
        if (targetItem && targetItem.level === cur.item.level) {
          mergeItems(
            { row: cur.startRow, col: cur.startCol },
            { row: target.row, col: target.col }
          )
          setMergeFlash(`${target.row}-${target.col}`)
          setTimeout(() => setMergeFlash(null), 400)
          // Prizes are handled server-side — reward popup triggered by rewards array in context
        } else if (!targetItem) {
          moveItem(
            { row: cur.startRow, col: cur.startCol },
            { row: target.row, col: target.col }
          )
        }
      } else if (target && target.row === cur.startRow && target.col === cur.startCol) {
        setSelectedCell((prev) =>
          prev?.row === target.row && prev?.col === target.col
            ? null
            : { row: target.row, col: target.col }
        )
      }

      dragStateRef.current = null
      setDragState(null)
    },
    [grid, getCellFromPoint, mergeItems, moveItem]
  )

  useEffect(() => {
    if (!dragState) return
    const onMove = (e: TouchEvent | MouseEvent) => handleDragMove(e)
    const onEnd = (e: TouchEvent | MouseEvent) => handleDragEnd(e)
    window.addEventListener("touchmove", onMove, { passive: false })
    window.addEventListener("mousemove", onMove)
    window.addEventListener("touchend", onEnd)
    window.addEventListener("mouseup", onEnd)
    return () => {
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("touchend", onEnd)
      window.removeEventListener("mouseup", onEnd)
    }
  }, [dragState, handleDragMove, handleDragEnd])

  const cols = grid[0]?.length ?? 5

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Game Grid — no backdrop-filter to prevent expensive GPU repaints on Safari/iOS */}
      <div
        ref={boardRef}
        className="relative rounded-2xl border border-white/10 bg-white/[0.08] w-full"
        style={{ padding: GRID_GAP }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: GRID_GAP,
          }}
        >
          {grid.map((row, ri) =>
            row.map((cell, ci) => {
              const locked = isCellLocked ? isCellLocked(ri, ci) : false;
              return (
                <MemoCell
                  key={`${ri}-${ci}`}
                  cell={cell}
                  locked={locked}
                  ri={ri}
                  ci={ci}
                  isDragSource={dragState?.startRow === ri && dragState?.startCol === ci}
                  isFlashing={mergeFlash === `${ri}-${ci}`}
                  isSelected={selectedCell?.row === ri && selectedCell?.col === ci}
                  itemDefs={itemDefs}
                  setSelectedCell={setSelectedCell}
                  handleDragStart={handleDragStart}
                />
              )
            })
          )}
        </div>

        {/* Drag ghost — size snapshotted at drag-start from DOM */}
        {dragState && (
          <div
            className="absolute pointer-events-none z-[70]"
            style={{
              left: dragState.currentX - dragState.ghostSize / 2,
              top: dragState.currentY - dragState.ghostSize / 2,
              width: dragState.ghostSize,
              height: dragState.ghostSize,
            }}
          >
            <div className="w-full h-full rounded-xl bg-[#044F4D]/80 border-2 border-[#C3D82E] flex flex-col items-center justify-center">
              {itemDefs[dragState.item.level]?.iconUrl
                ? <img src={itemDefs[dragState.item.level]!.iconUrl} alt="" className="w-3/4 h-3/4 object-contain" />
                : <span className="text-3xl">{dragState.item.emoji}</span>
              }
            </div>
          </div>
        )}
      </div>

      {/* Spawn + Remove */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onTouchEnd={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (canSpawn) spawnItem()
          }}
          onClick={() => {
            if (canSpawn) spawnItem()
          }}
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
          className={`relative z-10 px-8 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97] ${
            canSpawn
              ? "bg-[#C3D82E] text-black"
              : boardFull
              ? "bg-orange-500/30 text-orange-300 cursor-not-allowed"
              : "bg-gray-500/40 text-gray-400 cursor-not-allowed"
          }`}
        >
          {canSpawn ? "+ Spawn  2⚡" : boardFull ? "⛔ Board Full" : "⚡ No Energy"}
        </button>
        <button
          type="button"
          onTouchEnd={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (selectedCell) {
              removeItem(selectedCell)
              setSelectedCell(null)
            }
          }}
          onClick={() => {
            if (selectedCell) {
              removeItem(selectedCell)
              setSelectedCell(null)
            }
          }}
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
          className="relative z-10 flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm bg-white text-black transition-all duration-200 active:scale-[0.97]"
        >
          <Trash2 className="w-4 h-4" />
          Remove
        </button>
      </div>

      {/* Casino / Sports choice modal */}
      {pendingCouponChoices.length > 0 && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
          <div className="bg-[#032C2B] border border-[#C3D82E]/30 rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl">
            <div className="text-3xl mb-3">🎟️</div>
            <h3 className="text-lg font-bold text-white mb-1">You earned a promo code!</h3>
            <p className="text-sm text-white/60 mb-5">
              Choose your reward type for Level {pendingCouponChoices[0].triggerLevel}:
            </p>
            <div className="flex gap-3">
              {(["sports", "casino"] as const).map((type) => (
                <button
                  key={type}
                  disabled={couponChoiceResolving}
                  onClick={async () => {
                    setCouponChoiceResolving(true)
                    await resolveCouponChoice(pendingCouponChoices[0].triggerLevel, type)
                    // Popup + confetti triggered automatically by rewards watcher above
                    setCouponChoiceResolving(false)
                  }}
                  className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl bg-[#044F4D] border border-[#C3D82E]/20 hover:border-[#C3D82E]/60 transition-all active:scale-95 disabled:opacity-50"
                >
                  <span className="text-2xl">{type === "sports" ? "⚽" : "🎰"}</span>
                  <span className="text-sm font-semibold text-white capitalize">{type}</span>
                </button>
              ))}
            </div>
            {couponChoiceResolving && (
              <div className="mt-3 text-xs text-white/40">Assigning your code…</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
