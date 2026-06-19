"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/contexts/language-context"
import { Play, CheckCircle2, Clock, Coins } from "lucide-react"
import { toast } from "sonner"

interface AdPlayerProps {
  telegramId: number
  onRewardClaimed?: (reward: number) => void
}

interface AdSettings {
  adsgram: { enabled: boolean; rewardPerAd: number; blockId: string }
  onclicka: { enabled: boolean; rewardPerAd: number; zoneId: string }
  adsonar: { enabled: boolean; rewardPerAd: number; blockId: string }
  callbackConfigured?: boolean
}

export default function AdPlayer({ telegramId, onRewardClaimed }: AdPlayerProps) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [adSettings, setAdSettings] = useState<AdSettings | null>(null)
  const [watchedToday, setWatchedToday] = useState(0)
  const [totalEarned, setTotalEarned] = useState(0)
  const [isWatchingAd, setIsWatchingAd] = useState(false)
  const [lastWatchTime, setLastWatchTime] = useState<Date | null>(null)

  useEffect(() => {
    fetchAdSettings()
    fetchAdStats()
  }, [])

  // Preload ad SDKs when settings are loaded
  useEffect(() => {
    if (!adSettings) return
    
    const preloadSdk = (url: string, globalVar: string) => {
      if ((window as any)[globalVar]) return // Already loaded
      const script = document.createElement('script')
      script.src = url
      script.async = true
      document.head.appendChild(script)
    }
    
    if (adSettings.adsgram?.enabled && adSettings.adsgram?.blockId) {
      preloadSdk('https://sad.adsgram.ai/js/sad.min.js', 'Adsgram')
    }
    if (adSettings.adsonar?.enabled && adSettings.adsonar?.blockId) {
      preloadSdk('https://cdn.adsonar.com/js/adsonar.min.js', 'Adsonar')
    }
  }, [adSettings])

  const fetchAdSettings = async () => {
    try {
      const response = await fetch('/api/public-settings')
      if (response.ok) {
        const data = await response.json()
        setAdSettings(data.settings.adNetworks || null)
      }
    } catch (error) {
      console.error('Error fetching ad settings:', error)
    }
  }

  const fetchAdStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/user/ads', {
        headers: { 'x-telegram-id': telegramId.toString() }
      })
      
      if (response.ok) {
        const data = await response.json()
        setWatchedToday(data.watchedToday || 0)
        setTotalEarned(data.totalEarned || 0)
        
        if (data.lastWatchTime) {
          setLastWatchTime(new Date(data.lastWatchTime))
        }
      }
    } catch (error) {
      console.error('Error fetching ad stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const canWatchAd = () => {
    if (!lastWatchTime) return true
    
    // 30 second cooldown between ads
    const cooldownMs = 30 * 1000
    const timeSinceLastWatch = Date.now() - lastWatchTime.getTime()
    return timeSinceLastWatch >= cooldownMs
  }

  const getCooldownSeconds = () => {
    if (!lastWatchTime) return 0
    
    const cooldownMs = 30 * 1000
    const timeSinceLastWatch = Date.now() - lastWatchTime.getTime()
    const remainingMs = cooldownMs - timeSinceLastWatch
    
    return Math.max(0, Math.ceil(remainingMs / 1000))
  }

  const getAvailableNetwork = () => {
    if (!adSettings) return null
    
    // Priority: Adsgram > AdSonar > Onclicka
    if (adSettings.adsgram.enabled && adSettings.adsgram.blockId) return 'adsgram'
    if (adSettings.adsonar.enabled && adSettings.adsonar.blockId) return 'adsonar'
    if (adSettings.onclicka.enabled) return 'onclicka'
    
    return null
  }

  const getRewardForNetwork = (network: string) => {
    if (!adSettings) return 0
    
    switch (network) {
      case 'adsgram':
        return adSettings.adsgram.rewardPerAd
      case 'onclicka':
        return adSettings.onclicka.rewardPerAd
      case 'adsonar':
        return adSettings.adsonar.rewardPerAd
      default:
        return 0
    }
  }

  const watchAd = async (network: string) => {
    if (!canWatchAd()) {
      toast.error(`${t('pleaseWait', 'Please wait')} ${getCooldownSeconds()} ${t('secondsBeforeNextAd', 'seconds before watching another ad')}`)
      return
    }

    try {
      setIsWatchingAd(true)
      
      let adWatched = false
      
      // Adsgram integration
      if (network === 'adsgram' && adSettings?.adsgram?.blockId) {
        toast.info(t('loadingAd', 'Loading ad...'))
        
        // Load Adsgram SDK if not already loaded
        if (!(window as any).Adsgram) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://sad.adsgram.ai/js/sad.min.js'
            script.async = true
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load Adsgram SDK'))
            document.head.appendChild(script)
          })
        }
        
        // Show the ad
        const AdController = (window as any).Adsgram?.init({ 
          blockId: adSettings.adsgram.blockId, 
          debug: false 
        })
        
        if (AdController) {
          try {
            await AdController.show()
            adWatched = true
          } catch (adError: any) {
            console.error('Adsgram error:', adError)
            if (adError?.error === 'No ads available') {
              toast.error('No ads available at the moment. Try again later.')
            } else {
              toast.error(t('adFailedToLoad', 'Ad failed to load'))
            }
            return
          }
        } else {
          toast.error(t('failedToInitializeAd', 'Failed to initialize ad'))
          return
        }
      } else if (network === 'adsonar' && adSettings?.adsonar?.blockId) {
        // AdSonar integration
        toast.info(t('loadingAd', 'Loading ad...'))
        
        // Load AdSonar SDK if not already loaded
        if (!(window as any).Adsonar) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdn.adsonar.com/js/adsonar.min.js'
            script.async = true
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load AdSonar SDK'))
            document.head.appendChild(script)
          })
        }
        
        // Show the ad
        const AdController = (window as any).Adsonar?.init({ 
          blockId: adSettings.adsonar.blockId, 
          debug: false 
        })
        
        if (AdController) {
          try {
            await AdController.show()
            adWatched = true
          } catch (adError: any) {
            console.error('AdSonar error:', adError)
            if (adError?.error === 'No ads available') {
              toast.error('No ads available at the moment. Try again later.')
            } else {
              toast.error(t('adFailedToLoad', 'Ad failed to load'))
            }
            return
          }
        } else {
          toast.error(t('failedToInitializeAd', 'Failed to initialize ad'))
          return
        }
      } else {
        // Fallback for other networks - placeholder
        toast.info(t('loadingAd', 'Loading ad...'))
        await new Promise(resolve => setTimeout(resolve, 3000))
        adWatched = true
      }

      if (!adWatched) {
        return
      }

      // Reward is granted only through secure server-to-server callback.
      if (!adSettings || !adSettings.callbackConfigured) {
        toast.error(t('adCallbackNotConfigured', 'Ad callback is not configured by admin'))
        return
      }

      const reward = getRewardForNetwork(network)
      toast.success(t('adCompletedRewardPending', 'Ad completed. Reward will be added after callback confirmation.'))

      setWatchedToday(prev => prev + 1)
      setLastWatchTime(new Date())

      // Refresh stats shortly after callback is expected.
      setTimeout(() => {
        fetchAdStats()
        onRewardClaimed?.(reward)
      }, 2500)
    } catch (error) {
      console.error('Error watching ad:', error)
      toast.error(t('failedToWatchAd', 'Failed to watch ad'))
    } finally {
      setIsWatchingAd(false)
    }
  }

  const handleWatchAd = () => {
    const network = getAvailableNetwork()
    if (!network) {
      toast.error(t('noAdNetworksAvailable', 'No ad networks available'))
      return
    }

    watchAd(network)
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Card>
    )
  }

  const network = getAvailableNetwork()
  const reward = network ? getRewardForNetwork(network) : 0

  if (!network) {
    return (
      <Card className="p-6">
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            {t('adRewardsUnavailable', 'Ad rewards are currently unavailable. Please check back later!')}
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Play className="w-4 h-4 text-primary" />
            <p className="text-sm text-muted-foreground">{t('today', 'Today')}</p>
          </div>
          <p className="text-2xl font-bold">{watchedToday}</p>
          <p className="text-xs text-muted-foreground">{t('adsWatched', 'Ads watched')}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-yellow-500" />
            <p className="text-sm text-muted-foreground">{t('total', 'Total')}</p>
          </div>
          <p className="text-2xl font-bold">{totalEarned.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{t('tokensEarned', 'Tokens earned')}</p>
        </Card>
      </div>

      {/* Watch Ad Card */}
      <Card className="p-6">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
            <Play className="w-8 h-8 text-primary" />
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-1">{t('watchAdAndEarn', 'Watch Ad & Earn')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('watchShortVideoEarnTokens', 'Watch a short video ad to earn tokens')}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-green-500/10">
            <Coins className="w-5 h-5 text-yellow-500" />
            <span className="text-xl font-bold text-green-500">+{reward}</span>
            <span className="text-sm text-muted-foreground">{t('tokens', 'tokens')}</span>
          </div>

          {!canWatchAd() && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>{t('nextAdIn', 'Next ad in')} {getCooldownSeconds()}s</span>
            </div>
          )}

          <Button
            onClick={handleWatchAd}
            disabled={!canWatchAd() || isWatchingAd}
            size="lg"
            className="w-full"
          >
            {isWatchingAd ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Watching Ad...
              </>
            ) : !canWatchAd() ? (
              <>
                <Clock className="w-4 h-4 mr-2" />
                Wait {getCooldownSeconds()}s
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Watch Ad
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground">
            Network: {network.toUpperCase()}
          </p>
        </div>
      </Card>

      {/* How It Works */}
      <Card className="p-6">
        <h4 className="font-semibold mb-3">How It Works</h4>
        <div className="space-y-3 text-sm">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
              1
            </div>
            <p className="text-muted-foreground">
              Click "Watch Ad" button to start
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
              2
            </div>
            <p className="text-muted-foreground">
              Watch the entire ad (usually 15-30 seconds)
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
              3
            </div>
            <p className="text-muted-foreground">
              Earn {reward} tokens instantly after completion
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
              4
            </div>
            <p className="text-muted-foreground">
              Wait 30 seconds before watching the next ad
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
