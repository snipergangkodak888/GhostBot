"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { toast } from 'sonner'
import { useTelegram } from "@/components/telegram-provider"

// ── Merge Game Item Types ──
export interface MergeItem {
  id: string
  level: number
  row: number
  col: number
  emoji: string
  name: string
}

export interface MergeReward {
  type: "promo_code" | "bonus_energy" | "badge"
  value: string
  label: string
}

export interface PendingCouponChoice {
  triggerLevel: number
}

// Item definitions per level
export const MERGE_ITEMS: Record<number, { emoji: string; name: string }> = {
  1: { emoji: "⚽", name: "Football" },
  2: { emoji: "🥾", name: "Pro Boots" },
  3: { emoji: "👕", name: "Jersey" },
  4: { emoji: "🏆", name: "Gold Trophy" },
  5: { emoji: "🎫", name: "VIP Ticket" },
  6: { emoji: "💎", name: "Diamond Pass" },
  7: { emoji: "🏟️", name: "Stadium" },
  8: { emoji: "🎖️", name: "VIVATBET Reward" },
}

const GRID_SIZE = 5
const ENERGY_PER_SPAWN = 2
const MERGE_STATE_API = "/api/user/merge-state"

// Default spawn weights (level 1–5 only; levels 6-8 are merge-only)
// These can be overridden via admin settings stored in DB
const DEFAULT_SPAWN_WEIGHTS: Record<number, number> = { 1: 60, 2: 25, 3: 10, 4: 4, 5: 1 }

function weightedRandomLevel(weights: Record<number, number>): number {
  const entries = Object.entries(weights).map(([k, v]) => ({ level: Number(k), weight: Number(v) }))
  const total = entries.reduce((s, e) => s + e.weight, 0)
  let rand = Math.random() * total
  for (const { level, weight } of entries) {
    rand -= weight
    if (rand <= 0) return level
  }
  return entries[entries.length - 1].level
}

interface MergeGameContextType {
  grid: (MergeItem | null)[][]
  energy: number
  score: number
  highestLevel: number
  unlockedLevelPrizes: number[]
  itemDefs: Record<number, { emoji: string; name: string; prizeType?: string; prizeAmount?: number; iconUrl?: string }>
  spawnItem: () => void
  mergeItems: (from: { row: number; col: number }, to: { row: number; col: number }) => MergeReward | null
  moveItem: (from: { row: number; col: number }, to: { row: number; col: number }) => void
  removeItem: (pos: { row: number; col: number }) => void
  isCellLocked: (r: number, c: number) => boolean
  canSpawn: boolean
  boardFull: boolean
  dailyStreak: number
  rewards: MergeReward[]
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  refreshEnergy: () => Promise<void>
  pendingCouponChoices: PendingCouponChoice[]
  resolveCouponChoice: (triggerLevel: number, chosenType: 'casino' | 'sports') => Promise<MergeReward | null>
}

const MergeGameContext = createContext<MergeGameContextType>({
  grid: [],
  energy: 100,
  score: 0,
  highestLevel: 1,
  unlockedLevelPrizes: [],
  itemDefs: MERGE_ITEMS,
  spawnItem: () => {},
  mergeItems: () => null,
  moveItem: () => {},
  removeItem: () => {},
  isCellLocked: () => false,
  canSpawn: true,
  boardFull: false,
  dailyStreak: 0,
  rewards: [],
  isPlaying: false,
  setIsPlaying: () => {},
  refreshEnergy: async () => {},
  pendingCouponChoices: [],
  resolveCouponChoice: async () => null,
})

export const useMergeGame = () => useContext(MergeGameContext)

function createEmptyGrid(): (MergeItem | null)[][] {
  return Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => null))
}

function normalizeGrid(input: any): (MergeItem | null)[][] {
  const fallback = createEmptyGrid()
  if (!Array.isArray(input) || input.length !== GRID_SIZE) return fallback

  return input.map((row: any, ri: number) => {
    if (!Array.isArray(row) || row.length !== GRID_SIZE) return fallback[ri]
    return row.map((cell: any, ci: number) => {
      if (!cell || typeof cell !== "object") return null
      const level = Number(cell.level)
      if (!MERGE_ITEMS[level]) return null
      return {
        id: String(cell.id || generateId()),
        level,
        row: ri,
        col: ci,
        emoji: MERGE_ITEMS[level].emoji,
        name: MERGE_ITEMS[level].name,
      } as MergeItem
    })
  })
}

function generateId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// NOTE: Level prizes are fully configured in the admin Gameplay page (prizeType + prizeAmount per level).
// The server awards prizes (energy or promo code) on first-time level reach.
// No prize logic lives in the client — prizes come back in POST /api/user/merge-state responses.

export function MergeGameProvider({ children }: { children: React.ReactNode }) {
  const { user: telegramUser } = useTelegram()
  const [grid, setGrid] = useState<(MergeItem | null)[][]>(createEmptyGrid())
  const [energy, setEnergy] = useState<number>(0)
  const [score, setScore] = useState(0)
  const [highestLevel, setHighestLevel] = useState(1)
  const [unlockedLevelPrizes, setUnlockedLevelPrizes] = useState<number[]>([])
  const [dailyStreak, setDailyStreak] = useState(0)
  const [rewards, setRewards] = useState<MergeReward[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [spawnWeights, setSpawnWeights] = useState<Record<number, number>>(DEFAULT_SPAWN_WEIGHTS)
  const [spawnPrice, setSpawnPrice] = useState<number>(ENERGY_PER_SPAWN)
  const [itemDefs, setItemDefs] = useState<Record<number, { emoji: string; name: string; prizeType?: string; prizeAmount?: number; iconUrl?: string }>>(MERGE_ITEMS)
  const [pendingCouponChoices, setPendingCouponChoices] = useState<PendingCouponChoice[]>([])
  
  // Calculate unlocked slots based on earned prizes
  const unlockedSlots = unlockedLevelPrizes.filter((lvl) => {
    const def = itemDefs[lvl] || MERGE_ITEMS[lvl]
    return def?.prizeType === "unlock_board_slot"
  }).length

  const isCellLocked = useCallback((r: number, c: number) => {
    // 5 bottom blocks = row 4. Lock based on remaining unlocked.
    // If unlockedSlots = 1, col 0 is unlocked. So locked if col >= unlockedSlots
    if (r !== 4) return false
    return c >= unlockedSlots
  }, [unlockedSlots])

  const gridRef = useRef(grid)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Track energy at last server sync so we can send a delta (spent amount) instead of absolute value
  const lastSyncedEnergyRef = useRef<number>(0)

  useEffect(() => {
    gridRef.current = grid
  }, [grid])

  useEffect(() => {
    // Wait for Telegram to provide the user — firing without an id just gets a 401
    // and locks isLoaded=true before the real data arrives.
    if (!telegramUser?.id) return

    let cancelled = false

    const loadState = async () => {
      // Retry up to 3 times with backoff — on first open the mergeScores doc may
      // not exist yet if the auth route hasn't finished writing it.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(MERGE_STATE_API, {
            method: "GET",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "x-telegram-id": telegramUser.id.toString(),
            },
            cache: "no-store",
          })

          if (!res.ok) {
            // Wait and retry — auth may still be creating the user
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
              continue
            }
            break
          }

          const data = await res.json()
          const state = data?.state || {}
          if (cancelled) return

          const freshEnergy = Math.max(0, Number(state.energy ?? 100))
          setGrid(normalizeGrid(state.grid))
          setEnergy(freshEnergy)
          lastSyncedEnergyRef.current = freshEnergy
          setScore(Math.max(0, Number(state.score ?? 0)))
          setHighestLevel(Math.max(1, Number(state.highestLevel ?? 1)))
          setUnlockedLevelPrizes(Array.isArray(state.unlockedLevelPrizes) ? state.unlockedLevelPrizes : [])
          setDailyStreak(Math.max(0, Number(state.dailyStreak ?? 0)))
          break
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
        }
      }
      if (!cancelled) setIsLoaded(true)
    }

    loadState()

    // Load spawn weights + item defs from public settings (non-blocking)
    fetch('/api/public-settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (typeof data?.settings?.spawnPrice === 'number') {
          setSpawnPrice(data.settings.spawnPrice)
        }
        const w = data?.settings?.spawnWeights
        if (w && typeof w === 'object') {
          const parsed: Record<number, number> = {}
          for (const [k, v] of Object.entries(w)) {
            const level = Number(k)
            const weight = Number(v)
            if (level >= 1 && weight >= 0) parsed[level] = weight
          }
          if (Object.keys(parsed).length > 0) setSpawnWeights(parsed)
        }
        const defs = data?.settings?.mergeItemDefs
        if (Array.isArray(defs)) {
          const parsed: Record<number, { emoji: string; name: string; prizeType?: string; prizeAmount?: number }> = {}
          for (const d of defs) {
            const level = Number(d.level)
            if (level >= 1 && d.name) {
              parsed[level] = {
                emoji: String(d.emoji || ''),
                name: String(d.name),
                prizeType: d.prizeType ?? 'none',
                prizeAmount: Math.max(0, Number(d.prizeAmount) || 0),
                ...(d.iconUrl ? { iconUrl: String(d.iconUrl) } : {}),
              }
            }
          }
          if (Object.keys(parsed).length > 0) setItemDefs(parsed)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [telegramUser?.id])

  useEffect(() => {
    if (!isLoaded) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    saveTimeoutRef.current = setTimeout(() => {
      // Only send energy spent (delta) — never overwrite server balance with client value.
      // Reward APIs ($inc) accumulate freely; client only reports how much was consumed.
      const energySpent = Math.max(0, lastSyncedEnergyRef.current - energy)
      lastSyncedEnergyRef.current = energy
      fetch(MERGE_STATE_API, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(telegramUser?.id ? { "x-telegram-id": telegramUser.id.toString() } : {}),
        },
        body: JSON.stringify({
          grid,
          energySpent,
          score,
          highestLevel,
          unlockedLevelPrizes,
          dailyStreak,
        }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return

          // Sync server unlocked levels locally in case user achieved unlock_board_slot or energy
          if (Array.isArray(data.unlockedLevelPrizes)) {
            setUnlockedLevelPrizes(data.unlockedLevelPrizes)
          }

          // Server awarded energy prizes for first-time level reaches
          if (data.energyPrizes?.length) {
            const prizes: Array<{ level: number; amount: number }> = data.energyPrizes
            setRewards(prev => [
              ...prev,
              ...prizes.map(p => ({
                type: "bonus_energy" as const,
                value: String(p.amount),
                label: `+${p.amount} Energy! (Level ${p.level} reward)`,
              }))
            ])
            prizes.forEach(p => {
              toast.success(`⚡ +${p.amount} Energy! Level ${p.level} journey reward unlocked!`, { duration: 4000 })
            })
          }

          // Server awarded slot unlocks
          if (data.slotPrizes?.length) {
            const slots: Array<{ level: number }> = data.slotPrizes
            setRewards(prev => [
              ...prev,
              ...slots.map(s => ({
                type: "badge" as const,
                value: "Unlocked Slot",
                label: `🔓 Board space unlocked! (Level ${s.level} reward)`,
              }))
            ])
            slots.forEach(s => {
              toast.success(`🔓 Board space unlocked! Level ${s.level} journey reward!`, { duration: 4000 })
            })
          }

          // Sync energy to true server value (after $inc for spawn + prize)
          if (typeof data.newEnergy === 'number') {
            const val = Math.max(0, data.newEnergy)
            setEnergy(val)
            lastSyncedEnergyRef.current = val
          }

          // Promo codes awarded automatically (no choice needed)
          if (data.assignedCoupons?.length) {
            setRewards(prev => [
              ...prev,
              ...data.assignedCoupons.map((c: { code: string; description: string; level: number; type: string }) => ({
                type: "promo_code" as const,
                value: c.code,
                label: `🎟️ ${c.type === 'casino' ? '🎰 Casino' : c.type === 'sports' ? '⚽ Sports' : ''} ${c.description || `Level ${c.level} Reward`}: ${c.code}`,
              }))
            ])
            data.assignedCoupons.forEach((c: { code: string; description: string; level: number; type: string }) => {
              toast.success(`🎟️ Promo code unlocked! Level ${c.level} reward: ${c.code}`, { duration: 6000 })
            })
          }

          // Pending choices (both casino + sports available — user picks)
          if (data.pendingChoices?.length) {
            setPendingCouponChoices(prev => [
              ...prev,
              ...data.pendingChoices.filter((p: PendingCouponChoice) =>
                !prev.some(existing => existing.triggerLevel === p.triggerLevel)
              )
            ])
          }
        })
        .catch(() => {})
    }, 300)

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [grid, energy, score, highestLevel, dailyStreak, isLoaded, telegramUser?.id])

  const refreshEnergy = useCallback(async () => {
    if (!telegramUser?.id) return
    try {
      const res = await fetch(MERGE_STATE_API, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-id': telegramUser.id.toString(),
        },
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      const freshEnergy = data?.state?.energy
      if (typeof freshEnergy === 'number') {
        const val = Math.max(0, freshEnergy)
        setEnergy(val)
        lastSyncedEnergyRef.current = val
      }
    } catch {}
  }, [telegramUser?.id])

  const boardFull = isLoaded && !grid.some((row, r) => row.some((cell, c) => cell === null && !isCellLocked(r, c)))
  const canSpawn = isLoaded && energy >= spawnPrice && !boardFull

  const spawnItem = useCallback(() => {
    if (energy < spawnPrice) return
    const emptyCells: { row: number; col: number }[] = []
    grid.forEach((row, ri) => row.forEach((cell, ci) => {
      if (!cell && !isCellLocked(ri, ci)) emptyCells.push({ row: ri, col: ci })
    }))
    if (emptyCells.length === 0) return

    const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)]
    const level = weightedRandomLevel(spawnWeights)
    const itemDef = itemDefs[level] ?? MERGE_ITEMS[level]

    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      next[cell.row][cell.col] = {
        id: generateId(),
        level,
        row: cell.row,
        col: cell.col,
        emoji: itemDef.emoji,
        name: itemDef.name,
      }
      return next
    })
    setEnergy((e) => e - spawnPrice)
  }, [energy, grid, spawnWeights, itemDefs, spawnPrice, isCellLocked])

  const moveItem = useCallback((from: { row: number; col: number }, to: { row: number; col: number }) => {
    if (isCellLocked(to.row, to.col)) return
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      const item = next[from.row][from.col]
      if (!item || next[to.row][to.col]) return prev
      next[to.row][to.col] = { ...item, row: to.row, col: to.col }
      next[from.row][from.col] = null
      return next
    })
  }, [isCellLocked])

  const removeItem = useCallback((pos: { row: number; col: number }) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      next[pos.row][pos.col] = null
      return next
    })
  }, [])

  const mergeItems = useCallback((from: { row: number; col: number }, to: { row: number; col: number }): MergeReward | null => {
    if (isCellLocked(to.row, to.col)) return null
    const currentGrid = gridRef.current
    const fromItem = currentGrid[from.row]?.[from.col]
    const toItem = currentGrid[to.row]?.[to.col]
    if (!fromItem || !toItem) return null
    if (fromItem.level !== toItem.level) return null
    if (fromItem.id === toItem.id) return null

    const newLevel = fromItem.level + 1
    if (newLevel > 8) return null

    const newDef = itemDefs[newLevel] ?? MERGE_ITEMS[newLevel]
    const mergedItem: MergeItem = {
      id: generateId(),
      level: newLevel,
      row: to.row,
      col: to.col,
      emoji: newDef.emoji,
      name: newDef.name,
    }

    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      next[from.row][from.col] = null
      next[to.row][to.col] = mergedItem
      return next
    })

    setScore((s) => s + newLevel * 10)
    setHighestLevel((prev) => (newLevel > prev ? newLevel : prev))

    // Prizes are awarded server-side (see save effect above).
    // mergeItems only updates local grid/score/highestLevel — never awards energy locally.
    return null
  }, [itemDefs, isCellLocked])

  const resolveCouponChoice = useCallback(async (triggerLevel: number, chosenType: 'casino' | 'sports'): Promise<MergeReward | null> => {
    if (!telegramUser?.id) return null
    try {
      const res = await fetch('/api/user/coupon-choice', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-telegram-id': String(telegramUser.id) },
        body: JSON.stringify({ triggerLevel, chosenType }),
      })
      const data = await res.json()
      // Remove from pending
      setPendingCouponChoices(prev => prev.filter(p => p.triggerLevel !== triggerLevel))
      if (!res.ok || !data.coupon) return null
      const reward: MergeReward = {
        type: 'promo_code',
        value: data.coupon.code,
        label: `🎟️ ${chosenType === 'casino' ? '🎰 Casino' : '⚽ Sports'} ${data.coupon.description || `Level ${triggerLevel} Reward`}: ${data.coupon.code}`,
      }
      setRewards(prev => [...prev, reward])
      return reward
    } catch {
      return null
    }
  }, [telegramUser?.id])

  return (
    <MergeGameContext.Provider
      value={{
        grid,
        energy,
        score,
        highestLevel,
        itemDefs,
        spawnItem,
        mergeItems,
        moveItem,
        removeItem,
        isCellLocked,
        unlockedLevelPrizes,
        canSpawn,
        boardFull,
        dailyStreak,
        rewards,
        isPlaying,
        setIsPlaying,
        refreshEnergy,
        pendingCouponChoices,
        resolveCouponChoice,
      }}
    >
      {children}
    </MergeGameContext.Provider>
  )
}
