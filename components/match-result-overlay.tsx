"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import confetti from "canvas-confetti"
import type { MatchResult } from "@/contexts/game-context"

const WIN_STICKER = "/images/InGameStickers/Emojis/8Ball/CAACAgQAAxUAAWm1kJU7KgaDLrZp3u6wLebTNgqUAAJDHQACBKYJUTt4nbMlkoWoOgQ/CAACAgQAAxUAAWm1kJU7KgaDLrZp3u6wLebTNgqUAAJDHQACBKYJUTt4nbMlkoWoOgQ.webp"
const LOSE_STICKER = "/images/InGameStickers/Emojis/8Ball/CAACAgQAAxUAAWm1kJVGr8qgrBXAZQUIL0FV__FlAAJUHAACrBQRUbCF7gnCYfgYOgQ/CAACAgQAAxUAAWm1kJVGr8qgrBXAZQUIL0FV__FlAAJUHAACrBQRUbCF7gnCYfgYOgQ.webp"
const MEDAL_ICON = "/images/Icons/Medal.webp"
const TOKEN_ICON = "/images/Token/888.png"

interface FlyingItem {
  id: number
  startX: number
  startY: number
  endX: number
  endY: number
  delay: number
  type: 'medal' | 'token'
}

interface Props {
  result: MatchResult
  onClose: () => void
  /** Called when collect animation starts so TopBar can trigger fill + sparkles */
  onCollectStart?: () => void
}

export default function MatchResultOverlay({ result, onClose, onCollectStart }: Props) {
  const isWin = result.outcome === 'win'
  const [phase, setPhase] = useState<'show' | 'flying' | 'done'>('show')
  const [flyingItems, setFlyingItems] = useState<FlyingItem[]>([])
  const [showPlusEffect, setShowPlusEffect] = useState<{ medals: boolean; tokens: boolean }>({ medals: false, tokens: false })
  const [visible, setVisible] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const flyIdRef = useRef(0)

  // Fade in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // Gold confetti side cannons on win
  useEffect(() => {
    if (!isWin) return
    const goldColors = ['#FFD700', '#FFC300', '#DAA520', '#F0C040', '#FFEA70']
    const end = Date.now() + 3000
    let raf: number

    const frame = () => {
      if (Date.now() > end) return
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        startVelocity: 60,
        origin: { x: 0, y: 0.5 },
        colors: goldColors,
        zIndex: 201,
      })
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        startVelocity: 60,
        origin: { x: 1, y: 0.5 },
        colors: goldColors,
        zIndex: 201,
      })
      raf = requestAnimationFrame(frame)
    }
    frame()

    return () => cancelAnimationFrame(raf)
  }, [isWin])

  const handleCollect = useCallback(() => {
    if (phase !== 'show') return
    setPhase('flying')

    // Find fly targets on the page
    const medalTarget = document.querySelector('[data-fly-target="medals"]')
    const tokenTarget = document.querySelector('[data-fly-target="tokens"]')
    const medalRect = medalTarget?.getBoundingClientRect()
    const tokenRect = tokenTarget?.getBoundingClientRect()

    // Starting position: center of overlay
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2 + 40

    const items: FlyingItem[] = []

    // Create flying medals
    if (medalRect && result.awarded > 0) {
      const count = Math.min(result.awarded, 8) // cap visual particles
      for (let i = 0; i < count; i++) {
        items.push({
          id: ++flyIdRef.current,
          startX: centerX + (Math.random() - 0.5) * 60,
          startY: centerY + (Math.random() - 0.5) * 30,
          endX: medalRect.left + medalRect.width / 2,
          endY: medalRect.top + medalRect.height / 2,
          delay: i * 80,
          type: 'medal',
        })
      }
    }

    // Create flying tokens (if tokens awarded — for now show same as medals count)
    if (tokenRect && result.awarded > 0) {
      const tokenCount = Math.min(result.awarded, 6)
      for (let i = 0; i < tokenCount; i++) {
        items.push({
          id: ++flyIdRef.current,
          startX: centerX + (Math.random() - 0.5) * 60,
          startY: centerY + 40 + (Math.random() - 0.5) * 30,
          endX: tokenRect.left + tokenRect.width / 2,
          endY: tokenRect.top + tokenRect.height / 2,
          delay: 200 + i * 80,
          type: 'token',
        })
      }
    }

    setFlyingItems(items)

    // Trigger level progress animation
    if (onCollectStart) {
      setTimeout(() => onCollectStart(), 400)
    }

    // Show +N effects when first items arrive
    const medalArrival = 600 // animation duration + first delay
    const tokenArrival = 800
    setTimeout(() => setShowPlusEffect(p => ({ ...p, medals: true })), medalArrival)
    setTimeout(() => setShowPlusEffect(p => ({ ...p, tokens: true })), tokenArrival)

    // Close after all animations complete
    setTimeout(() => {
      setPhase('done')
      setTimeout(() => {
        setVisible(false)
        setTimeout(onClose, 300)
      }, 600)
    }, 2200)
  }, [phase, result.awarded, onCollectStart, onClose])

  const handleClose = useCallback(() => {
    setVisible(false)
    setTimeout(onClose, 300)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center transition-opacity duration-300"
      style={{
        opacity: visible ? 1 : 0,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        background: isWin
          ? 'radial-gradient(ellipse at center, rgba(20,60,20,0.92) 0%, rgba(0,0,0,0.95) 100%)'
          : 'radial-gradient(ellipse at center, rgba(40,15,15,0.92) 0%, rgba(0,0,0,0.95) 100%)',
      }}
    >
      {/* Sticker */}
      <div className={`mb-4 transition-transform duration-700 ${visible ? 'scale-100' : 'scale-50'}`}>
        <img
          src={isWin ? WIN_STICKER : LOSE_STICKER}
          alt={isWin ? "Win" : "Lose"}
          className="w-32 h-32 object-contain"
        />
      </div>

      {/* Title */}
      <h1
        className={`text-4xl font-black mb-2 transition-all duration-500 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        } ${isWin ? 'text-green-400' : 'text-red-400'}`}
      >
        {isWin ? 'You Won!' : 'You Lost'}
      </h1>

      {/* Score */}
      <div className="text-white/60 text-sm mb-6">
        Score: <span className="text-white font-bold">{result.score}</span>
      </div>

      {/* Rewards / Losses */}
      <div className="flex flex-col gap-3 items-center mb-8 min-w-[200px]">
        {/* Medals */}
        <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl ${
          isWin ? 'bg-white/10' : 'bg-red-500/10'
        }`}>
          <img src={MEDAL_ICON} alt="Medal" className="w-7 h-7" />
          <span className={`text-xl font-bold tabular-nums ${
            isWin ? 'text-green-400' : 'text-red-400'
          }`}>
            {isWin ? '+' : '-'}{Math.abs(result.awarded)}
          </span>
          <span className="text-white/50 text-sm">Medals</span>
        </div>

        {/* Tokens */}
        <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl ${
          isWin ? 'bg-white/10' : 'bg-red-500/10'
        }`}>
          <Image src={TOKEN_ICON} alt="Token" width={28} height={28} />
          <span className={`text-xl font-bold tabular-nums ${
            isWin ? 'text-green-400' : 'text-red-400'
          }`}>
            {isWin ? '+' : '-'}{Math.abs(result.awarded)}
          </span>
          <span className="text-white/50 text-sm">Tokens</span>
        </div>
      </div>

      {/* Button */}
      {isWin ? (
        <button
          onClick={handleCollect}
          disabled={phase !== 'show'}
          className={`px-10 py-3.5 rounded-2xl font-bold text-lg transition-all duration-300 ${
            phase === 'show'
              ? 'bg-green-500 text-white active:scale-95 shadow-[0_0_30px_rgba(34,197,94,0.4)]'
              : 'bg-green-500/40 text-white/50'
          }`}
        >
          Collect
        </button>
      ) : (
        <button
          onClick={handleClose}
          className="px-10 py-3.5 rounded-2xl font-bold text-lg bg-white/10 text-white active:scale-95 transition-transform"
        >
          Close
        </button>
      )}

      {/* Flying items */}
      {flyingItems.map(item => (
        <FlyingParticle key={item.id} item={item} />
      ))}

      {/* +N effect at medal target */}
      {showPlusEffect.medals && isWin && (
        <FloatingPlus value={result.awarded} targetSelector="[data-fly-target='medals']" />
      )}
      {showPlusEffect.tokens && isWin && (
        <FloatingPlus value={result.awarded} targetSelector="[data-fly-target='tokens']" />
      )}
    </div>
  )
}

function FlyingParticle({ item }: { item: FlyingItem }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const timer = setTimeout(() => {
      el.style.transition = 'all 0.6s cubic-bezier(0.17, 0.67, 0.29, 1.0)'
      el.style.left = `${item.endX}px`
      el.style.top = `${item.endY}px`
      el.style.transform = 'translate(-50%, -50%) scale(0.3)'
      el.style.opacity = '0.6'
    }, item.delay)

    return () => clearTimeout(timer)
  }, [item])

  return (
    <div
      ref={ref}
      className="fixed pointer-events-none z-[201]"
      style={{
        left: item.startX,
        top: item.startY,
        transform: 'translate(-50%, -50%) scale(1)',
        opacity: 1,
      }}
    >
      {item.type === 'medal' ? (
        <img src={MEDAL_ICON} alt="" className="w-6 h-6" />
      ) : (
        <Image src={TOKEN_ICON} alt="" width={24} height={24} />
      )}
    </div>
  )
}

function FloatingPlus({ value, targetSelector }: { value: number; targetSelector: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = document.querySelector(targetSelector)
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 4 })
  }, [targetSelector])

  if (!pos) return null

  return (
    <div
      className="fixed pointer-events-none z-[202] text-green-400 font-bold text-lg"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, 0)',
        animation: 'float-up 1.2s ease-out forwards',
      }}
    >
      +{value}
      <style>{`
        @keyframes float-up {
          0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -30px) scale(1.3); }
        }
      `}</style>
    </div>
  )
}
