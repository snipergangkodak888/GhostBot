"use client"

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react"
import { useAppData } from "@/contexts/app-data-context"
import { useTelegram } from "@/components/telegram-provider"
import InGameReactionsOverlay from "@/components/in-game-reactions-overlay"

// ── Renderer diagnostic component ────────────────────────────────────────────
function RendererDiag({ iframeRef }: { iframeRef: React.RefObject<HTMLIFrameElement> }) {
  const [info, setInfo] = useState("R:? FPS:?")
  const [isWebGL, setIsWebGL] = useState<boolean | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [racksOn, setRacksOn] = useState(true)

  const toggleRacks = (e: React.MouseEvent) => {
    e.stopPropagation()
    const win = iframeRef.current?.contentWindow as any
    const gi = win?.playState?.gameInfo ?? win?.gi
    if (!gi) return
    const next = !racksOn
    if (gi.rackSolids)  gi.rackSolids.visible  = next
    if (gi.rackStripes) gi.rackStripes.visible = next
    setRacksOn(next)
  }

  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf: number

    const tick = () => {
      frames++
      const now = performance.now()
      if (now - last >= 1000) {
        try {
          const win = iframeRef.current?.contentWindow as any
          const rt  = win?.game?.renderType ?? null
          const fps = frames

          // Draw calls counted by the getContext patch in index.html
          const dcTotal = (win?._dbg_dc ?? 0) as number
          if (win) win._dbg_dc = 0                       // reset counter
          const dcPerFrame = fps > 0 ? Math.round(dcTotal / fps) : 0

          // CPU ms: peak physics time seen in the last second
          const cpuMs = typeof win?._dbg_cpu_peak === "number"
            ? win._dbg_cpu_peak.toFixed(1)
            : typeof win?._dbg_cpu === "number"
              ? win._dbg_cpu.toFixed(1)
              : null
          if (win) win._dbg_cpu_peak = 0  // reset peak

          const atlasState = win?._dbg_atlas ? ` [${win._dbg_atlas}]` : ''
          const bbState = win?._dbg_blackball ? ` [bb:${win._dbg_blackball}]` : ''
          const cacheState = win?._dbg_cache ? ` [${win._dbg_cache}]` : ''

          const label = rt === 1 ? "CANVAS" : rt === 2 ? "WEBGL" : "R:?"
          setInfo(`${fps}fps | DC:${dcPerFrame} | cpu:${cpuMs !== null ? cpuMs + 'ms' : '-'}`)
          setIsWebGL(rt === 2)
        } catch {
          setInfo(`R:err ${frames}fps`)
        }
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [iframeRef])

  return (
    <div style={{
      position: "fixed",
      bottom: 72,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 99999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      pointerEvents: "none",
    }}>
      {/* FPS pill */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: "rgba(0,0,0,0.80)",
          color: isWebGL === true ? "#00ff88" : isWebGL === false ? "#ff8800" : "#aaa",
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: 12,
          padding: collapsed ? "4px 8px" : "4px 12px",
          borderRadius: 6,
          cursor: "pointer",
          pointerEvents: "auto",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {collapsed ? "●" : info}
      </div>
      {/* Racks toggle */}
      {!collapsed && (
        <button
          onClick={toggleRacks}
          style={{
            fontFamily: "monospace",
            fontWeight: "bold",
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 5,
            border: "1px solid rgba(255,255,255,0.18)",
            cursor: "pointer",
            pointerEvents: "auto",
            background: racksOn ? "rgba(0,0,0,0.72)" : "rgba(200,40,40,0.72)",
            color: racksOn ? "#aaa" : "#ff9090",
            whiteSpace: "nowrap",
          }}
        >
          {racksOn ? "racks ON" : "racks OFF"}
        </button>
      )}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchResult {
  outcome: 'win' | 'loss'
  awarded: number
  score: string
  time: string
}

interface GameContextType {
  /** Whether the game iframe is ready (loaded) */
  isReady: boolean
  /** Whether the game is currently visible/active */
  isPlaying: boolean
  /** Show the game (optionally auto-start a mode) */
  showGame: (mode?: "ai" | "local" | null, playCardId?: string | null) => void
  /** Hide the game and return to dashboard */
  hideGame: () => void
  /** Result of the last completed match (null if none pending) */
  matchResult: MatchResult | null
  /** Clear the match result after overlay is dismissed */
  clearMatchResult: () => void
}

const GameContext = createContext<GameContextType>({
  isReady: false,
  isPlaying: false,
  showGame: () => {},
  hideGame: () => {},
  matchResult: null,
  clearMatchResult: () => {},
})

export const useGame = () => useContext(GameContext)

/* ── Module-level game-ready signal ────────────────────────────────────
   Works outside React's render cycle so the splash's async authenticate()
   can subscribe without depending on useEffect timing.                  */
let _gameReady = false
const _gameReadyListeners = new Set<() => void>()

export function notifyGameReady() {
  if (_gameReady) return
  _gameReady = true
  _gameReadyListeners.forEach(fn => fn())
  _gameReadyListeners.clear()
}

/**
 * Returns a Promise that resolves the moment the game iframe posts
 * `metal8ball:ready`.  Resolves immediately if the game is already ready.
 * Pure JS — no React dependency, safe to call from async functions.
 */
export function waitForGameReady(): Promise<void> {
  if (_gameReady) return Promise.resolve()
  return new Promise<void>(resolve => {
    // Double-check after microtask in case it resolved between check and listener
    if (_gameReady) { resolve(); return }
    _gameReadyListeners.add(resolve)
  })
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // URL MUST be stable across re-renders — changing it reloads the iframe!
  const [gameUrl] = useState(() => "/8ball/index.html?v=337-events&embedded=1&t=" + Date.now())
  const [isReady, setIsReady] = useState(false)
  const [swReady, setSwReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showLoseExitOverlay, setShowLoseExitOverlay] = useState(false)
  const [isStartingMatch, setIsStartingMatch] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const clearMatchResult = useCallback(() => setMatchResult(null), [])
  const pendingModeRef = useRef<string | null>(null)
  const activePlayCardIdRef = useRef<string | null>(null)
  const activeMatchTokenRef = useRef<string | null>(null)
  const reportedMatchTokenRef = useRef<string | null>(null)
  const autoExitQueuedRef = useRef<string | null>(null)
  const { userProfile, refreshData } = useAppData()
  const { user: telegramUser } = useTelegram()

  // Expose Telegram profile photo URL on parent window for iframe game to read
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__metalP1Photo = telegramUser?.photo_url || null
      // For AI mode, P2 stays default; for online, set P2 photo here when available
      ;(window as any).__metalP2Photo = null
    }
  }, [telegramUser?.photo_url])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) {
      setSwReady(true)
      return
    }

    let resolved = false
    const resolve = () => {
      if (resolved) return
      resolved = true
      setSwReady(true)
    }

    // Absolute safety net: if SW isn't active after 5 s, render the iframe anyway.
    // The iframe can still load — SW just won't intercept requests.
    const swTimer = setTimeout(() => {
      if (!resolved) {
        console.warn('[GameCtx] SW activation timed out after 5 s — proceeding without SW')
        resolve()
      }
    }, 5000)

    navigator.serviceWorker.register('/sw-8ball-idb-v7.js?v=301', { scope: '/' })
      .then((reg) => {
        reg.update().catch(() => {})

        if (reg.active) {
          clearTimeout(swTimer)
          resolve()
          return
        }

        // SW is still installing or waiting — listen for state changes
        const worker = reg.installing || reg.waiting
        if (worker) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'redundant') {
              clearTimeout(swTimer)
              resolve()
            }
          })
        }

        // Also resolve on navigator.serviceWorker.ready (whichever fires first)
        navigator.serviceWorker.ready.then(() => {
          clearTimeout(swTimer)
          resolve()
        })
      })
      .catch(() => {
        clearTimeout(swTimer)
        resolve()
      })

    return () => clearTimeout(swTimer)
  }, [])

  // If swReady becomes true but handleLoad never fires (iframe HTML fails to
  // load, e.g. SW serves stale/corrupt response, network offline), we still
  // need to resolve the game-ready signal.  The handleLoad callback starts its
  // own 15 s fallback poll, so this only covers the gap where onLoad itself
  // never fires at all.
  useEffect(() => {
    if (!swReady) return
    const t = setTimeout(() => {
      if (!_gameReady) {
        console.warn('[GameCtx] iframe onLoad never fired after swReady + 18 s — resolving game-ready')
        notifyGameReady()
      }
    }, 18000)
    return () => clearTimeout(t)
  }, [swReady])

  const reportMatchResult = useCallback(
    async (outcome: "win" | "loss", options?: { playCardId?: string; matchId?: string }) => {
      try {
        const payload = {
          outcome,
          playCardId: options?.playCardId || activePlayCardIdRef.current || undefined,
          matchId: options?.matchId,
        }

        const res = await fetch('/api/user/play-result', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          const data = await res.json()
          await refreshData(['profile', 'leaderboard'])
          return data
        }
      } catch (error) {
        console.error('Failed to report match result:', error)
      }
      return null
    },
    [refreshData]
  )

  const getDisplayNameForMatch = useCallback(() => {
    if (userProfile?.user?.anonymousMode === true) return "Anonymous"
    return userProfile?.user?.firstName || "Player"
  }, [userProfile?.user?.anonymousMode, userProfile?.user?.firstName])

  const applyMatchIdentity = useCallback(() => {
    const iframe = iframeRef.current
    const win = iframe?.contentWindow as any
    if (!win) return

    const displayName = getDisplayNameForMatch()

    try {
      const storage = win.Metal8ball?.localStorage
      if (storage?.setItem) {
        storage.setItem("playerName", displayName)
        storage.setItem("player1Name", displayName)
        storage.setItem("userName", displayName)
        storage.setItem("anonymousMode", userProfile?.user?.anonymousMode === true ? "1" : "0")
      }
    } catch {}

    try {
      if (typeof win.localStorage?.setItem === "function") {
        win.localStorage.setItem("playerName", displayName)
        win.localStorage.setItem("player1Name", displayName)
        win.localStorage.setItem("userName", displayName)
        win.localStorage.setItem("anonymousMode", userProfile?.user?.anonymousMode === true ? "1" : "0")
      }
    } catch {}

    try {
      if (typeof win.Metal8ball_setPlayerName === "function") {
        win.Metal8ball_setPlayerName(displayName)
      }
    } catch {}

    try {
      if (win.projectInfo) {
        win.projectInfo.playerName = displayName
        win.projectInfo.player1Name = displayName
      }
    } catch {}
  }, [getDisplayNameForMatch, userProfile?.user?.anonymousMode])

  // Called when iframe HTML finishes loading (scripts parsed, but Phaser still booting).
  // The game will notify us via postMessage when it's actually ready.
  // A fallback interval also polls the iframe's _metal8ballReady flag in case
  // the postMessage was missed (race with listener setup on Suspense remounts).
  const readyPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleLoad = useCallback(() => {
    try {
      const iframe = iframeRef.current
      const win = iframe?.contentWindow as any
      const lang = (typeof window !== 'undefined' ? localStorage.getItem('appLanguage') : null) || 'en'
      if (win?.Metal8ball_setLanguage) win.Metal8ball_setLanguage(lang)
    } catch {}
    applyMatchIdentity()
    console.log('[GameCtx] iframe onLoad fired — waiting for metal8ball:ready message')

    // Fallback: poll _metal8ballReady flag every 500 ms in case postMessage was lost.
    // Also detects game-boot failures (Phaser load errors, JS crashes) so we
    // never poll forever — after 15 s we resolve anyway.
    if (readyPollRef.current) clearInterval(readyPollRef.current)
    let pollCount = 0
    readyPollRef.current = setInterval(() => {
      pollCount++
      try {
        const win = iframeRef.current?.contentWindow as any
        if (win?._metal8ballReady) {
          console.log('[GameCtx] ✓ fallback poll detected _metal8ballReady')
          setIsReady(true)
          notifyGameReady()
          if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null }
          return
        }
        // Detect failed boot: if Phaser never reached mainMenu after 15 s,
        // resolve the game-ready signal so splash + dashboard aren't blocked.
        // The game continues loading in the background and will be usable
        // once it eventually boots (or user can retry).
        if (pollCount >= 30) { // 30 × 500ms = 15s
          console.warn('[GameCtx] game boot did not complete after 15 s — resolving game-ready signal')
          notifyGameReady()
          if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null }
        }
      } catch {}
    }, 500)
  }, [applyMatchIdentity])

  // Start a match directly — called only after game is confirmed at mainMenu.
  // No polling: playState.create sends metal8ball:playing when done.
  const startMode = useCallback((mode: string) => {
    try {
      const iframe = iframeRef.current
      const win = iframe?.contentWindow as any
      if (!win?.game?.state || !win?.projectInfo) {
        console.error('[GameCtx] startMode: game objects not available')
        setIsStartingMatch(false)
        return
      }

      win.game.paused = false
      win.game.halt = false
      try { win.game.sound.mute = false } catch {}

      console.log('[GameCtx] starting', mode, 'match (state:', win.game.state.current + ')')

      if (mode === "ai") {
        win.projectInfo.mode = 1
        win.projectInfo.levelName = "1player_" + (win.projectInfo.aiRating || 3).toString()
      } else if (mode === "local") {
        win.projectInfo.mode = 2
        win.projectInfo.levelName = "2players"
      }

      // Clear any lingering HTML overlays inside the iframe
      try {
        ["load-overlay", "menu-overlay", "pause-overlay", "gameover-overlay", "cd-overlay"].forEach(id => {
          const el = win.document?.getElementById(id)
          if (el) el.classList.remove("active")
        })
      } catch {}

      activeMatchTokenRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      reportedMatchTokenRef.current = null
      win.projectInfo.lastBreaker = "none"

      // Ensure unpaused and GO — playState.create will fire metal8ball:playing
      win.game.paused = false
      win.game.halt = false
      win.game.state.start("play")
    } catch (e) {
      console.error('[GameCtx] startMode error:', e)
      setIsStartingMatch(false)
    }
  }, [])

  // ── Event-driven game lifecycle via postMessage (NO polling) ──
  // The iframe sends:
  //   { type: 'metal8ball:ready' }   — Phaser reached mainMenu
  //   { type: 'metal8ball:playing' } — play state create() finished
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try { if (e.source !== iframeRef.current?.contentWindow) return } catch { return }

      if (e.data?.type === 'metal8ball:ready') {
        console.log('[GameCtx] ✓ metal8ball:ready — game at mainMenu')
        setIsReady(true)
        notifyGameReady()
        // Clear fallback poll — we got the real message
        if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null }
        try {
          const win = iframeRef.current?.contentWindow as any
          const lo = win?.document?.getElementById('load-overlay')
          if (lo) lo.style.display = 'none'
        } catch {}

        if (pendingModeRef.current) {
          console.log('[GameCtx] → executing pending mode:', pendingModeRef.current)
          const mode = pendingModeRef.current
          pendingModeRef.current = null
          startMode(mode)
        } else {
          // Park the engine to save CPU/GPU
          try {
            const win = iframeRef.current?.contentWindow as any
            if (win?.Metal8ball_pause) win.Metal8ball_pause()
          } catch {}
        }
      }

      if (e.data?.type === 'metal8ball:playing') {
        console.log('[GameCtx] ✓ metal8ball:playing — match is live')
        setIsStartingMatch(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [startMode])

  // Safety: if isStartingMatch gets stuck, clear it to prevent permanent black screen
  useEffect(() => {
    if (!isStartingMatch) return
    const safety = window.setTimeout(() => {
      console.warn('[GameCtx] ⚠ isStartingMatch stuck for 15s — force-clearing')
      setIsStartingMatch(false)
    }, 15_000)
    return () => clearTimeout(safety)
  }, [isStartingMatch])

  const showGame = useCallback(
    (mode?: "ai" | "local" | null, playCardId?: string | null) => {
      setShowLoseExitOverlay(false)
      setMatchResult(null)

      if (playCardId) {
        activePlayCardIdRef.current = playCardId
        try { localStorage.setItem("metal_last_play_card_id", playCardId) } catch {}
      }

      // Ensure player identity inside match respects Anonymous Mode.
      applyMatchIdentity()

      // If starting a mode, set loading cover BEFORE showing iframe
      if (mode) {
        setIsStartingMatch(true)
      }

      // Force-unpause the Phaser engine so it can transition states
      const iframe = iframeRef.current
      if (iframe?.contentWindow) {
        try {
          const win = iframe.contentWindow as any
          if (win.game?.paused) {
            win.game.paused = false
            try { win.game.sound.mute = false } catch {}
          }
        } catch {}
      }

      setIsPlaying(true)

      if (mode) {
        if (isReady) {
          startMode(mode)
        } else {
          pendingModeRef.current = mode
        }
      }
    },
    [applyMatchIdentity, isReady, startMode]
  )

  const hideGame = useCallback(() => {
    setShowLoseExitOverlay(false)
    setIsStartingMatch(false)
    autoExitQueuedRef.current = null
    setIsPlaying(false)

    // Reset game back to the menu and PAUSE the engine to save CPU/GPU
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      try {
        const win = iframe.contentWindow as any
        if (win.game && win.game.state) {
          win.game.state.start("mainMenu")
        }
        // Pause after a short delay so the state transition completes
        setTimeout(() => {
          try {
            if (win.Metal8ball_pause) win.Metal8ball_pause()
          } catch {}
        }, 500)
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    ;(window as any).Metal8ball_reportMatchResult = reportMatchResult

    return () => {
      try {
        delete (window as any).Metal8ball_reportMatchResult
      } catch {}
    }
  }, [reportMatchResult])

  useEffect(() => {
    if (!isPlaying || !isReady) return

    const interval = window.setInterval(() => {
      try {
        const iframe = iframeRef.current
        const win = iframe?.contentWindow as any
        const gameInfo = win?.playState?.gameInfo
        const matchToken = activeMatchTokenRef.current
        if (!gameInfo || !matchToken) return

        if (gameInfo.gameOver === true && gameInfo.winner && reportedMatchTokenRef.current !== matchToken) {
          const outcome = gameInfo.winner === 'p1' ? 'win' : 'loss'
          reportedMatchTokenRef.current = matchToken

          // Read score & time from the iframe's projectInfo
          let score = '0', time = '0:00'
          try {
            const pwin = iframe?.contentWindow as any
            score = String(pwin?.projectInfo?.score ?? '0')
            // time from gameOverPanel text3
            const t3 = gameInfo.text3 || gameInfo.gameOverPanel?.text3
            time = t3?.text ?? '0:00'
          } catch {}

          // Report to server
          reportMatchResult(outcome, { matchId: matchToken }).then(result => {
            // Read awarded medals from API response
            const awarded = typeof result?.awarded === 'number' ? result.awarded : (outcome === 'win' ? 10 : 0)

            // Store result for dashboard overlay
            setMatchResult({ outcome, awarded, score, time })
          })

          if (autoExitQueuedRef.current !== matchToken) {
            autoExitQueuedRef.current = matchToken
            setShowLoseExitOverlay(true)
            window.setTimeout(() => {
              try { hideGame() } catch {}
            }, 2200)
          }
        }
      } catch {}
    }, 800)

    return () => {
      window.clearInterval(interval)
    }
  }, [hideGame, isPlaying, isReady, reportMatchResult])

  useEffect(() => {
    if (typeof window === "undefined") return
    const tg = (window as any).Telegram?.WebApp
    const bb = tg?.BackButton
    if (!bb || !isPlaying) return

    const onBack = () => {
      const ok = window.confirm("Are you sure you want to leave the match? you will be surrended.")
      if (!ok) return

      const token = activeMatchTokenRef.current || `${Date.now()}-surrender`
      reportedMatchTokenRef.current = token
      setMatchResult({ outcome: 'loss', awarded: 0, score: '0', time: '0:00' })
      void reportMatchResult("loss", { matchId: token })
      hideGame()
    }

    try {
      bb.show()
      bb.onClick(onBack)
    } catch {}

    return () => {
      try {
        bb.offClick(onBack)
        bb.hide()
      } catch {}
    }
  }, [hideGame, isPlaying, reportMatchResult])

  return (
    <GameContext.Provider value={{ isReady, isPlaying, showGame, hideGame, matchResult, clearMatchResult }}>
      {/* Dashboard sits ABOVE the pre-loading iframe (z-index:1 > iframe z-index:0) */}
      {!isPlaying && <div style={{ position: "relative", zIndex: 1 }}>{children}</div>}

      {/* ── Renderer diagnostic overlay ─────────────────────────────── */}
      {isPlaying && isReady && (
        <>
          <RendererDiag iframeRef={iframeRef} />
          <InGameReactionsOverlay />
        </>
      )}

      {/* Seamless loading: dark screen while game engine initialises */}
      {isPlaying && (!isReady || isStartingMatch) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 102, background: "#18181b" }} />
      )}

      {isPlaying && showLoseExitOverlay && (
        <div style={{ position: "fixed", inset: 0, zIndex: 101, background: "rgba(9,9,11,0.88)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", color: "#fff", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
            <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1, marginBottom: 10 }}>Calculating...</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>Preparing your results</div>
          </div>
        </div>
      )}

      {/* Persistent game iframe — always in DOM, always opacity:1 so the browser
          never throttles requestAnimationFrame (which would prevent Phaser from booting).
          Visibility is controlled purely via z-index layering and the loading overlay above. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: isPlaying ? 100 : 0,
          opacity: 1,
          pointerEvents: (isPlaying && isReady && !isStartingMatch) ? "auto" : "none",
          background: "#18181b",
        }}
      >
        {swReady && (
          <iframe
            id="metal-game-iframe"
            ref={iframeRef}
            src={gameUrl}
            onLoad={handleLoad}
            allow="autoplay"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
            }}
          />
        )}
      </div>
    </GameContext.Provider>
  )
}
