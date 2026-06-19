"use client"

import { useState, useEffect, useRef } from "react"
import { ChevronLeft } from "lucide-react"
import { APP_NAME, MAIN_LOGO_URL } from "@/lib/branding"

interface IntroScreenProps {
  platformName: string
  onComplete: () => void
}

const INTRO_SCREENS = [
  {
    id: 1,
    title: "Operations Hub",
    description: "See active projects, launch timing, payroll notes, and team status without leaving Telegram.",
    image: MAIN_LOGO_URL,
  },
  {
    id: 2,
    title: "Synced Reminders",
    description: "Create daily briefings, hourly checks, and project alerts that deliver through the bot.",
    image: "https://api.iconify.design/line-md:bell-alert-loop.svg?color=%23146efc",
  },
  {
    id: 3,
    title: "Ask The Bot",
    description: "Query revenue, launches, crypto prices, project notes, and internal docs in natural language.",
    image: "https://api.iconify.design/line-md:telegram.svg?color=%23146efc",
  },
]

const SCREEN_DURATION = 6000
const AGE_VERIFIED_KEY = "ghost_team_access_confirmed"

export const INTRO_GIF_URLS = INTRO_SCREENS.map(s => s.image)

export default function IntroScreen({ platformName, onComplete }: IntroScreenProps) {
  const [currentScreen, setCurrentScreen] = useState(0)
  const [progress, setProgress] = useState(0)
  const [ageVerified, setAgeVerified] = useState<boolean | null>(null)
  const [ageRejected, setAgeRejected] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const progressRef = useRef<NodeJS.Timeout | null>(null)

  const isLastScreen = currentScreen === INTRO_SCREENS.length - 1
  const isFirstScreen = currentScreen === 0

  const handleComplete = async () => {
    try {
      await fetch('/api/user/intro-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Failed to save intro completion:', error)
    }
    onComplete()
  }

  const goToNextScreen = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (progressRef.current) clearInterval(progressRef.current)
    if (currentScreen < INTRO_SCREENS.length - 1) {
      setCurrentScreen(prev => prev + 1)
    }
  }

  const goToPrevScreen = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (progressRef.current) clearInterval(progressRef.current)
    if (currentScreen > 0) {
      setCurrentScreen(prev => prev - 1)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const verified = localStorage.getItem(AGE_VERIFIED_KEY) === "true"
    setAgeVerified(verified)
  }, [])

  const handleAgeYes = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(AGE_VERIFIED_KEY, "true")
    }
    setAgeRejected(false)
    setAgeVerified(true)
  }

  const handleAgeNo = () => {
    setAgeRejected(true)
    setAgeVerified(false)
  }

  useEffect(() => {
    if (ageVerified !== true) {
      setProgress(0)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (progressRef.current) clearInterval(progressRef.current)
      return
    }

    setProgress(0)
    const startTime = Date.now()
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / SCREEN_DURATION) * 100, 100)
      setProgress(newProgress)
      if (newProgress >= 100 && progressRef.current) {
        clearInterval(progressRef.current)
      }
    }, 50)

    if (!isLastScreen) {
      timerRef.current = setTimeout(() => {
        setCurrentScreen(prev => Math.min(prev + 1, INTRO_SCREENS.length - 1))
      }, SCREEN_DURATION)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (progressRef.current) clearInterval(progressRef.current)
    }
  }, [currentScreen, isLastScreen, ageVerified])

  const handleScreenTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (ageVerified !== true) return
    if (!isLastScreen) {
      goToNextScreen()
    }
  }

  const screen = INTRO_SCREENS[currentScreen]

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" onClick={handleScreenTap}
      style={{ background: '#000' }}
    >
      {/* Noise overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(20,110,252,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(20,110,252,0.08) 1px, transparent 1px)`,
        backgroundRepeat: 'repeat',
        backgroundSize: '42px 42px',
      }} />
      {/* Top vignette */}
      <div className="absolute top-0 left-0 right-0 z-[1] pointer-events-none" style={{
        height: '308px',
        background: 'linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, #000 80%)',
      }} />
      {/* Bottom vignette */}
      <div className="absolute bottom-0 left-0 right-0 z-[1] pointer-events-none" style={{
        height: '308px',
        background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 80%)',
      }} />

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-56 h-56 mb-6 relative flex items-center justify-center rounded-[2rem] border border-[#146efc]/30 bg-[#146efc]/10">
          <img
            key={`intro-gif-${currentScreen}`}
            src={screen.image}
            alt={screen.title}
            className="relative w-28 h-28 object-contain"
          />
        </div>

        <h1 className="text-3xl font-bold text-white text-center mb-2">{screen.title}</h1>

        <p className="text-[#146efc] text-sm text-center mb-2">{platformName || APP_NAME}</p>

        <p className="text-white/70 text-center max-w-sm leading-relaxed text-base">
          {screen.description}
        </p>
      </div>

      {ageVerified !== true && (
        <div
          className="absolute inset-0 z-[210] flex items-center justify-center px-6"
          style={{ background: '#000' }}
        >
          {/* Noise overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `linear-gradient(rgba(20,110,252,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(20,110,252,0.08) 1px, transparent 1px)`,
            backgroundRepeat: 'repeat',
            backgroundSize: '42px 42px',
          }} />
          {/* Top vignette */}
          <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{
            height: '308px',
            background: 'linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, #000 80%)',
          }} />
          {/* Bottom vignette */}
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{
            height: '308px',
            background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 80%)',
          }} />
          <div className="relative z-10 w-full max-w-sm text-center">
            <h2 className="text-2xl font-bold text-white mb-3">Team Access Confirmation</h2>
            <p className="text-white/75 text-sm leading-relaxed mb-5">
              This app is for authorized internal team members handling operational data.
            </p>
            {ageRejected && (
              <p className="text-[#146efc] text-sm font-semibold mb-5">
                Confirm team access to continue.
              </p>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); handleAgeYes() }}
                className="w-full py-3.5 bg-white text-black font-bold text-base rounded-full transition-all active:scale-[0.98]"
              >
                Yes, I’m authorized
              </button>
              {!ageRejected && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleAgeNo() }}
                  className="w-full py-3.5 bg-white/10 border border-white/20 text-white font-semibold text-base rounded-full transition-all active:scale-[0.98]"
                >
                  Not now
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Section: Progress + Buttons */}
      <div className="relative z-10 px-6 pb-10">
        {/* Progress Bars - above buttons */}
        <div className="flex gap-1.5 mb-4">
          {INTRO_SCREENS.map((_, index) => (
            <div
              key={index}
              className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-[#146efc] rounded-full"
                style={{
                  width: index < currentScreen 
                    ? '100%' 
                    : index === currentScreen 
                      ? `${progress}%` 
                      : '0%',
                  transition: index === currentScreen ? 'none' : 'width 0.3s ease'
                }}
              />
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          {!isFirstScreen && (
            <button
              onClick={(e) => { e.stopPropagation(); goToPrevScreen() }}
              className="w-12 h-12 flex items-center justify-center bg-white/10 border border-white/20 text-white rounded-full transition-all active:scale-[0.95]"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          
          {isLastScreen ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleComplete() }}
              className="flex-1 py-3.5 bg-[#146efc] text-white font-bold text-lg rounded-full transition-all active:scale-[0.98]"
            >
              Enter Ops
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); goToNextScreen() }}
              className="flex-1 py-3.5 bg-white text-black font-bold text-lg rounded-full transition-all active:scale-[0.98]"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
