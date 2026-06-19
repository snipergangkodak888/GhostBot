"use client"

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import Galaxy components to avoid SSR issues with WebGL
const Galaxy = dynamic(() => import('@/components/backgrounds/galaxy'), { ssr: false })
const GalaxyMono = dynamic(() => import('@/components/backgrounds/galaxy-mono'), { ssr: false })

export type ThemeLocation = 'landingPage' | 'miniApp' | 'brandingIntro' | 'adminPanel'
export type ThemeType = 'galaxy' | 'galaxyMono' | 'default'

interface ThemeSettings {
  activeTheme?: string
  galaxy?: {
    landingPage?: boolean
    miniApp?: boolean
    brandingIntro?: boolean
    adminPanel?: boolean
    lowDensity?: boolean
  }
  galaxyMono?: {
    landingPage?: boolean
    miniApp?: boolean
    brandingIntro?: boolean
    adminPanel?: boolean
    lowDensity?: boolean
  }
}

interface ThemeBackgroundProps {
  location: ThemeLocation
  fallback?: React.ReactNode
  className?: string
}

// Cache theme settings in memory
let cachedSettings: ThemeSettings | null = null
let cacheTime = 0
const CACHE_DURATION = 5000 // 5 seconds - shorter for more responsive updates

export default function ThemeBackground({ location, fallback, className = '' }: ThemeBackgroundProps) {
  const [themeSettings, setThemeSettings] = useState<ThemeSettings | null>(cachedSettings)
  const [loading, setLoading] = useState(!cachedSettings)

  useEffect(() => {
    const fetchSettings = async () => {
      // Use cache if fresh
      if (cachedSettings && Date.now() - cacheTime < CACHE_DURATION) {
        setThemeSettings(cachedSettings)
        setLoading(false)
        return
      }

      try {
        const res = await fetch('/api/public-settings', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        })
        if (res.ok) {
          const data = await res.json()
          const settings = data.settings?.themeSettings || {}
          console.log('🎨 [ThemeBackground] Fetched theme settings:', JSON.stringify(settings))
          cachedSettings = settings
          cacheTime = Date.now()
          setThemeSettings(settings)
        } else {
          console.error('🎨 [ThemeBackground] Failed to fetch settings, status:', res.status)
        }
      } catch (error) {
        console.error('Failed to fetch theme settings:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()
  }, [])

  // Determine which theme to show
  const getActiveTheme = (): ThemeType => {
    if (!themeSettings) {
      console.log('🎨 [ThemeBackground] No theme settings, returning default')
      return 'default'
    }
    
    // Check if Galaxy (colorful) is enabled for this location
    if (themeSettings.galaxy?.[location]) {
      console.log(`🎨 [ThemeBackground] Galaxy enabled for ${location}`)
      return 'galaxy'
    }
    
    // Check if Galaxy Mono (white/black) is enabled for this location
    if (themeSettings.galaxyMono?.[location]) {
      console.log(`🎨 [ThemeBackground] GalaxyMono enabled for ${location}`)
      return 'galaxyMono'
    }
    
    console.log(`🎨 [ThemeBackground] No theme enabled for ${location}`)
    return 'default'
  }

  const activeTheme = getActiveTheme()

  if (loading) {
    return fallback || null
  }

  if (activeTheme === 'galaxy') {
    const lowDensity = themeSettings?.galaxy?.lowDensity ?? false
    return (
      <div className={`fixed inset-0 z-0 pointer-events-none ${className}`}>
        <Galaxy 
          density={lowDensity ? 0.4 : 0.8}
          glowIntensity={0.4}
          saturation={0.5}
          hueShift={200}
          speed={0.5}
          transparent={false}
          mouseInteraction={false}
        />
      </div>
    )
  }

  if (activeTheme === 'galaxyMono') {
    const lowDensity = themeSettings?.galaxyMono?.lowDensity ?? false
    return (
      <div className={`fixed inset-0 z-0 pointer-events-none ${className}`}>
        <GalaxyMono 
          density={lowDensity ? 0.4 : 0.8}
          glowIntensity={0.3}
          speed={0.3}
          transparent={false}
        />
      </div>
    )
  }

  // Default theme - return the fallback (original gradient background)
  return fallback || null
}

// Export a hook for checking theme without rendering
export function useThemeSettings() {
  const [themeSettings, setThemeSettings] = useState<ThemeSettings | null>(cachedSettings)
  const [loading, setLoading] = useState(!cachedSettings)

  useEffect(() => {
    const fetchSettings = async () => {
      if (cachedSettings && Date.now() - cacheTime < CACHE_DURATION) {
        setThemeSettings(cachedSettings)
        setLoading(false)
        return
      }

      try {
        const res = await fetch('/api/public-settings')
        if (res.ok) {
          const data = await res.json()
          const settings = data.settings?.themeSettings || {}
          cachedSettings = settings
          cacheTime = Date.now()
          setThemeSettings(settings)
        }
      } catch (error) {
        console.error('Failed to fetch theme settings:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()
  }, [])

  const isGalaxyEnabled = (location: ThemeLocation): boolean => {
    return themeSettings?.galaxy?.[location] === true
  }

  const isGalaxyMonoEnabled = (location: ThemeLocation): boolean => {
    return themeSettings?.galaxyMono?.[location] === true
  }

  return { themeSettings, loading, isGalaxyEnabled, isGalaxyMonoEnabled }
}
