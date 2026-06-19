"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { APP_NAME, MAIN_LOGO_URL } from '@/lib/branding'

interface AdminSettings {
  platformName: string
  logoUrl: string
  telegramBotUsername: string
  contactTelegram: string
  contactEmail: string
}

interface AdminSettingsContextType {
  settings: AdminSettings
  loading: boolean
  refresh: () => Promise<void>
}

const DEFAULT_SETTINGS: AdminSettings = {
  platformName: APP_NAME,
  logoUrl: MAIN_LOGO_URL,
  telegramBotUsername: '',
  contactTelegram: '',
  contactEmail: ''
}

const CACHE_KEY = 'adminSettingsCache'
const CACHE_TIME_KEY = 'adminSettingsCacheTime'
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

const AdminSettingsContext = createContext<AdminSettingsContextType | undefined>(undefined)

export function AdminSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)

  const loadSettings = useCallback(async (force = false) => {
    // Check cache first (browser only)
    if (typeof window !== 'undefined' && !force) {
      const cached = localStorage.getItem(CACHE_KEY)
      const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
      
      if (cached && cacheTime) {
        const age = Date.now() - parseInt(cacheTime)
        if (age < CACHE_DURATION) {
          try {
            const parsed = JSON.parse(cached)
            setSettings({
              platformName: parsed.platformName || DEFAULT_SETTINGS.platformName,
              logoUrl: DEFAULT_SETTINGS.logoUrl,
              telegramBotUsername: parsed.telegramBotUsername || '',
              contactTelegram: parsed.contactTelegram || '',
              contactEmail: parsed.contactEmail || ''
            })
            setLoading(false)
            setInitialized(true)
            return
          } catch (e) {
            // Invalid cache, continue to fetch
          }
        }
      }
    }

    try {
      const res = await fetch('/api/public-settings', { 
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.ok) {
        const json = await res.json()
        const newSettings: AdminSettings = {
          platformName: json?.settings?.platformName || DEFAULT_SETTINGS.platformName,
          logoUrl: DEFAULT_SETTINGS.logoUrl,
          telegramBotUsername: json?.settings?.telegramBotUsername || '',
          contactTelegram: json?.settings?.contactTelegram || '',
          contactEmail: json?.settings?.contactEmail || ''
        }
        
        setSettings(newSettings)
        
        // Cache in localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem(CACHE_KEY, JSON.stringify(newSettings))
          localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
        }
      }
    } catch (error) {
      console.error('Failed to load admin settings:', error)
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }, [])

  // Initial load
  useEffect(() => {
    if (!initialized) {
      loadSettings()
    }
  }, [initialized, loadSettings])

  // Periodic refresh (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      loadSettings(true) // Force refresh
    }, CACHE_DURATION)
    
    return () => clearInterval(interval)
  }, [loadSettings])

  // Update document title when settings change
  useEffect(() => {
    if (typeof document !== 'undefined' && settings.platformName) {
      // Only update if we're in admin area
      if (window.location.pathname.startsWith('/admin')) {
        const currentTitle = document.title
        // Preserve page-specific suffix if present
        if (currentTitle.includes(' | ') || currentTitle.includes(' - ')) {
          const suffix = currentTitle.split(/\s[|-]\s/).slice(1).join(' | ')
          document.title = suffix ? `${settings.platformName} Admin | ${suffix}` : `${settings.platformName} Admin`
        } else {
          document.title = `${settings.platformName} Admin`
        }
      }
    }
  }, [settings.platformName])

  const value = useMemo(() => ({
    settings,
    loading,
    refresh: () => loadSettings(true)
  }), [settings, loading, loadSettings])

  return (
    <AdminSettingsContext.Provider value={value}>
      {children}
    </AdminSettingsContext.Provider>
  )
}

export function useAdminSettings() {
  const context = useContext(AdminSettingsContext)
  if (context === undefined) {
    throw new Error('useAdminSettings must be used within an AdminSettingsProvider')
  }
  return context
}
