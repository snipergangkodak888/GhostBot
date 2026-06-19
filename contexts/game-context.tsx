"use client"

import React, { createContext, useContext, useState, useCallback } from "react"

/**
 * Simplified GameContext — the 8Ball iframe game has been replaced by the
 * merge-game-context.  This stub keeps the existing import/provider tree
 * working without any iframe, service-worker, or Phaser references.
 */

export interface MatchResult {
  outcome: "win" | "loss"
  awarded: number
  score: string
  time: string
}

interface GameContextType {
  isReady: boolean
  isPlaying: boolean
  showGame: (mode?: "ai" | "local" | null, playCardId?: string | null) => void
  hideGame: () => void
  matchResult: MatchResult | null
  clearMatchResult: () => void
}

const GameContext = createContext<GameContextType>({
  isReady: true,
  isPlaying: false,
  showGame: () => {},
  hideGame: () => {},
  matchResult: null,
  clearMatchResult: () => {},
})

export const useGame = () => useContext(GameContext)

/** No-op: the 8Ball iframe game has been removed. Resolves immediately. */
export function waitForGameReady(): Promise<void> {
  return Promise.resolve()
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [isPlaying] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const clearMatchResult = useCallback(() => setMatchResult(null), [])
  const showGame = useCallback(() => {}, [])
  const hideGame = useCallback(() => {}, [])

  return (
    <GameContext.Provider
      value={{
        isReady: true,
        isPlaying,
        showGame,
        hideGame,
        matchResult,
        clearMatchResult,
      }}
    >
      {children}
    </GameContext.Provider>
  )
}
