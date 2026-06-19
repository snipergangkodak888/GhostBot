"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface TelegramWebApp {
  ready: () => void
  expand?: () => void
  requestFullscreen?: () => void
  disableVerticalSwipes?: () => void
  onEvent?: (eventType: string, eventHandler: () => void) => void
  offEvent?: (eventType: string, eventHandler: () => void) => void
  safeAreaInset?: { top?: number }
  contentSafeAreaInset?: { top?: number }
  initDataUnsafe?: {
    user?: {
      id: number
      first_name: string
      last_name?: string
      username?: string
      language_code?: string
      is_premium?: boolean
      photo_url?: string
    }
    start_param?: string
  }
  initData?: string
  version?: string
  platform?: string
}

interface TelegramContextType {
  webApp: TelegramWebApp | null
  user: TelegramWebApp['initDataUnsafe']['user'] | null
  startParam: string | null
  isReady: boolean
  isTelegram: boolean
}

const TelegramContext = createContext<TelegramContextType>({
  webApp: null,
  user: null,
  startParam: null,
  isReady: false,
  isTelegram: false,
})

export const useTelegram = () => useContext(TelegramContext)

interface TelegramProviderProps {
  children: ReactNode
}

export function TelegramProvider({ children }: TelegramProviderProps) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [user, setUser] = useState<TelegramWebApp['initDataUnsafe']['user'] | null>(null)
  const [startParam, setStartParam] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isTelegram, setIsTelegram] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Simple initialization without SDK
    const tg = (window as any).Telegram?.WebApp
    
    if (tg) {
      setIsTelegram(true)
      
      try {
        // Call ready immediately
        if (tg.ready) tg.ready()
        
        setWebApp(tg)
        
        // Get user data if available
        if (tg.initDataUnsafe?.user) {
          setUser(tg.initDataUnsafe.user)
        }
        
        // Get start_param (referral code) if available
        if (tg.initDataUnsafe?.start_param) {
          setStartParam(tg.initDataUnsafe.start_param)
        }
        
        // Expand once after ready. Do not force fullscreen again if the user exits it.
        const timer = window.setTimeout(() => {
          try {
            if (tg.expand) tg.expand()
            if (tg.requestFullscreen) tg.requestFullscreen()
            if (tg.disableVerticalSwipes) {
              tg.disableVerticalSwipes()
            }
          } catch (e) {
            // Ignore
          }

          // Sync safe area insets to CSS custom properties
          const syncSafeArea = () => {
            const root = document.documentElement
            if (tg.safeAreaInset) {
              root.style.setProperty('--tg-safe-area-inset-top', `${tg.safeAreaInset.top || 0}px`)
            }
            if (tg.contentSafeAreaInset) {
              root.style.setProperty('--tg-content-safe-area-inset-top', `${tg.contentSafeAreaInset.top || 0}px`)
            }
          }
          syncSafeArea()
          // Listen for safe area changes
          if (tg.onEvent) {
            tg.onEvent('safeAreaChanged', syncSafeArea)
            tg.onEvent('contentSafeAreaChanged', syncSafeArea)
          }
        }, 50)

        return () => window.clearTimeout(timer)
        
      } catch (error) {
        // Ignore errors, just continue
      }
    }
    
    setIsReady(true)
  }, [])

  return (
    <TelegramContext.Provider value={{ webApp, user, startParam, isReady, isTelegram }}>
      {children}
    </TelegramContext.Provider>
  )
}
