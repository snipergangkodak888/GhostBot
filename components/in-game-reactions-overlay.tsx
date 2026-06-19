"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Smile, Sticker } from "lucide-react"

const EMOJI_PACK = [
  "CAACAgQAAxUAAWm1kJU7KgaDLrZp3u6wLebTNgqUAAJDHQACBKYJUTt4nbMlkoWoOgQ",
  "CAACAgQAAxUAAWm1kJU8gS74xUiKxJ0gaPRN3hpOAAL3GwACwswJUaT95Ce4gOD7OgQ",
  "CAACAgQAAxUAAWm1kJULgfV2nFGlEwmLYzjWIskOAAICGgACWdoRUa3a-aK7xoCNOgQ",
  "CAACAgQAAxUAAWm1kJUSRkZr7YKIeus6F7Xep9C1AALGGAACDN85UX9dvTgpTZHoOgQ",
  "CAACAgQAAxUAAWm1kJUXXRStmmi4q4CPzRmTmBV4AALaGgACNkcIUT4B8XoAATy8_DoE",
  "CAACAgQAAxUAAWm1kJUm98V0vc9Hv1qkdc-WV9HnAAL9IQACXJURUUdRqccDe-EPOgQ",
  "CAACAgQAAxUAAWm1kJUoHN7lsqkAAYvKJjjxFAcAAdIAAtkZAAISCQlRXaEUBdwiOpo6BA",
  "CAACAgQAAxUAAWm1kJUtn_Pg0q2_nx1doqNPpOFyAAIGHAACZloRUZjD-G-nY_jOOgQ",
  "CAACAgQAAxUAAWm1kJUw9MUb7uPf_sITHX1IdQ7kAAJrHQACoSUIUQ6eJ6rHc_3SOgQ",
  "CAACAgQAAxUAAWm1kJVGr8qgrBXAZQUIL0FV__FlAAJUHAACrBQRUbCF7gnCYfgYOgQ",
  "CAACAgQAAxUAAWm1kJVJtRvRGcHSF-uyLStVoTWjAAJoGgACj-gJUbeseKFlwBImOgQ",
  "CAACAgQAAxUAAWm1kJVL9yUjD0CfUuMzCnZkORGVAAKrGgAC3hsQUSgO72MHUrLhOgQ",
  "CAACAgQAAxUAAWm1kJVbLdZQ0TVthDtN1EKiUjlKAAIwGgACNkAQUSR4JC24TDbEOgQ",
  "CAACAgQAAxUAAWm1kJVc3jUh0cIf-bo1YlgkQrjiAAL_HQACU9QJUdrktdHv6DTLOgQ",
  "CAACAgQAAxUAAWm1kJWBMTVMzKxjJjmv2JE9SPUrAALqGwAC1xYRUTdEI4axZ4LtOgQ",
  "CAACAgQAAxUAAWm1kJWQEtqT2v3u8wvcHsrPhZh-AAKSGAACKx8RUXmyunHJEGptOgQ",
  "CAACAgQAAxUAAWm1kJWZAlH11gPm07j5AuNJMA-aAAJZGgAC_OYJUZDM71pbOg82OgQ",
  "CAACAgQAAxUAAWm1kJXADaadORMK-8oE53XtLidjAAKsIgACtX8JUUxPTs9dMJNTOgQ",
  "CAACAgQAAxUAAWm1kJXNW1kU28G8vsUvwh2HgHa3AAJPGwACT_0RUQcZBcxJYImfOgQ",
  "CAACAgQAAxUAAWm1kJXceEHLK5RrHDOJ3C1ai7zSAAKQFgACmIsQUXC0uv8oDkLLOgQ",
  "CAACAgQAAxUAAWm1kJXcf3XnAX11abOyathRZsOWAAIbHAACNmQQUcA39PfHVdohOgQ",
  "CAACAgQAAxUAAWm1kJXgor5BmFoYrcDMIJblpEcsAAKyGgACXW8RUegiMkkzOx3oOgQ"
]

export default function InGameReactionsOverlay() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"emojis" | "stickers">("emojis")
  const [activeReaction, setActiveReaction] = useState<string | null>(null)
  const [activeReactionSource, setActiveReactionSource] = useState<"self" | "opponent">("self")
  const [reactionPlayToken, setReactionPlayToken] = useState(0)
  const [inPlayState, setInPlayState] = useState(false)
  const [inMatch, setInMatch] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)
  const [buttonPos, setButtonPos] = useState<{ left: number; top: number } | null>(null)

  // Track active state and place button above power bar on mobile.
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const iframe = document.getElementById('metal-game-iframe') as HTMLIFrameElement
        if (!iframe?.contentWindow) return
        const win = iframe.contentWindow as any
        const doc = win?.document as Document | undefined
        const cur = win?.game?.state?.current
        const info = win?.playState?.gameInfo

        const overlayIds = ["menu-overlay", "pause-overlay", "gameover-overlay"]
        const appMenuOpen = overlayIds.some((id) => {
          const el = doc?.getElementById?.(id)
          if (!el) return false
          const activeClass = el.classList.contains("active")
          const visibleStyle = (win?.getComputedStyle?.(el)?.display || "") !== "none"
          return activeClass || visibleStyle
        })
        const cdOverlay = doc?.getElementById?.("cd-overlay")
        const cdOverlayOpen = !!cdOverlay && (
          cdOverlay.classList.contains("active") ||
          ((win?.getComputedStyle?.(cdOverlay)?.display || "") !== "none")
        )
        const gamePaused = !!win?.game?.paused

        const isMobile = !!(win?.game?.device?.touch || win?.game?.device?.iOS || win?.game?.device?.android)
        setIsMobileView(isMobile)

        const isPlayState = cur === "play" || cur === "playState"
        const isCountdown = !!info?._countdownActive
        const playSession = isPlayState && !!info && !appMenuOpen && !gamePaused
        const liveMatch = playSession && !isCountdown && !cdOverlayOpen
        setInPlayState(playSession)
        setInMatch(liveMatch)

        if (playSession && isMobile && info?.powerBar) {
          const canvas = win?.document?.querySelector?.('#mygame canvas') as HTMLCanvasElement | null
          if (!canvas) return

          const iframeRect = iframe.getBoundingClientRect()
          const canvasRect = canvas.getBoundingClientRect()
          const absLeft = iframeRect.left + canvasRect.left
          const absTop = iframeRect.top + canvasRect.top
          const sx = canvasRect.width / Math.max(1, canvas.width)
          const sy = canvasRect.height / Math.max(1, canvas.height)

          const powerX = absLeft + (info.powerBar.x * sx)
          const powerY = absTop + (info.powerBar.y * sy)
          const size = 38

          const left = Math.max(8, Math.min(window.innerWidth - size - 8, powerX - size / 2))
          const top = Math.max(8, Math.min(window.innerHeight - size - 8, powerY - 186))
          setButtonPos({ left, top })
        } else {
          setButtonPos(null)
        }
      } catch (e) {}
    }, 500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!inMatch) {
      setIsOpen(false)
      setActiveReaction(null)
      setActiveReactionSource("self")
    }
  }, [inMatch])

  useEffect(() => {
    const handleOpponentReaction = (ev: Event) => {
      try {
        const custom = ev as CustomEvent<{ id?: string }>
        const id = custom?.detail?.id
        if (!id) return
        setActiveReactionSource("opponent")
        setActiveReaction(id)
        setReactionPlayToken((t) => t + 1)
      } catch {}
    }

    window.addEventListener("metal-opponent-reaction", handleOpponentReaction as EventListener)
    return () => window.removeEventListener("metal-opponent-reaction", handleOpponentReaction as EventListener)
  }, [])

  // Auto-hide the popup chat bubble after 3.5 seconds
  useEffect(() => {
    if (activeReaction) {
      const timer = setTimeout(() => {
        setActiveReaction(null)
      }, 3500)
      return () => clearTimeout(timer)
    }
  }, [activeReaction])

  const sendReaction = useCallback((id: string, isSticker: boolean) => {
    setActiveReactionSource("self")
    setActiveReaction(id)
    setReactionPlayToken((t) => t + 1)
    setIsOpen(false)
  }, [])

  // Keep mounted during 3,2,1 so icon can preload under countdown overlay.
  if (!inPlayState) return null

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            className="fixed inset-0 bg-black/20 z-[99990]" 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeReaction && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: -10, y: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", bounce: 0.4 }}
            className="flex items-center justify-center pointer-events-none drop-shadow-2xl"
            style={{ 
              position: "fixed", 
              top: "85px", 
              left: "65px",
              zIndex: 99995,
            }}
          >
            <div className="w-16 h-16 flex items-center justify-center">
              <img
                src={`/images/InGameStickers/Emojis/8Ball/${activeReaction}/${activeReaction}.webp`}
                alt=""
                className="w-full h-full object-contain"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Button: On mobile, auto-positioned above power bar; only visible in a live match. */}
      <button 
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        className={`flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${isOpen ? 'scale-110 opacity-70' : 'opacity-90'}`}
        style={
          isMobileView
            ? {
                position: "fixed",
                left: buttonPos ? `${Math.round(buttonPos.left)}px` : "12px",
                top: buttonPos ? `${Math.round(buttonPos.top)}px` : "calc(100vh - 240px)",
                width: "38px",
                height: "38px",
                zIndex: inMatch ? 99999 : 50,
                pointerEvents: inMatch ? "auto" : "none",
                background: "none",
                border: "none",
                touchAction: "manipulation",
              }
            : {
                position: "fixed",
                right: "24px",
                top: "18vh",
                width: "42px",
                height: "42px",
                zIndex: inMatch ? 99999 : 50,
                pointerEvents: inMatch ? "auto" : "none",
                background: "none",
                border: "none",
                touchAction: "manipulation",
              }
        }
      >
        <Smile className="w-8 h-8 text-white drop-shadow-xl" />
      </button>

      {/* Overlay Sheet - smaller 35vh, drag to close */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#111111]/70 backdrop-blur-2xl border-t border-white/10 rounded-t-3xl overflow-hidden flex flex-col shadow-2xl" 
            style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "35vh", zIndex: 100000, touchAction: "none" }}
          >
            <motion.div
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.4}
              onDragEnd={(_, info) => {
                if (info.offset.y > 40 || info.velocity.y > 120) {
                  setIsOpen(false)
                }
              }}
              className="w-full flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
              style={{ touchAction: "none" }}
            >
              <div className="w-10 h-1.5 bg-white/20 rounded-full" />
            </motion.div>

            <div className="flex-1 overflow-y-auto px-4 pb-2 pt-2 scrollbar-none" style={{ touchAction: "pan-y" }}>
              {activeTab === "emojis" ? (
                <div className="grid grid-cols-6 md:grid-cols-8 gap-3 pb-16">
                  {EMOJI_PACK.map((id) => (
                    <button 
                      key={id} 
                      className="aspect-square flex items-center justify-center p-1 rounded-2xl hover:bg-white/10 active:scale-90 transition-all"
                      onClick={(e) => { e.stopPropagation(); sendReaction(id, false); }}
                      style={{ touchAction: "manipulation" }}
                    >
                      <img
                        src={`/images/InGameStickers/Emojis/8Ball/${id}/${id}.png`}
                        alt=""
                        className="w-[120%] h-[120%] object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-white/40 pb-16 text-sm font-medium">
                  <p>Stickers coming soon...</p>
                </div>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-[60px] bg-black/40 backdrop-blur-md border-t border-white/5 flex">
              <button 
                onClick={(e) => { e.stopPropagation(); setActiveTab("emojis"); }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${
                  activeTab === "emojis" ? "text-blue-400 bg-white/5" : "text-white/40 hover:text-white/60"
                }`}
              >
                <Smile className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-wide">Emojis</span>
              </button>
              
              <div className="w-[1px] h-full bg-white/5" />

              <button 
                onClick={(e) => { e.stopPropagation(); setActiveTab("stickers"); }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${
                  activeTab === "stickers" ? "text-blue-400 bg-white/5" : "text-white/40 hover:text-white/60"
                }`}
              >
                <Sticker className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-wide">Stickers</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
