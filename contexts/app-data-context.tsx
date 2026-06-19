"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useTelegram } from '@/components/telegram-provider'
import { primePhotoCache } from '@/components/telegram-profile-photo'

interface PlayCard {
  id: string
  title: string
  bgUrl: string
  matchCost: number
  adminFee: number
  winnerMedals: number
  loserMedals: number
  active: boolean
}

interface AppDataContextType {
  loading: boolean
  userProfile: any
  tokens: number | null
  tokensPerSecond: number
  medals: number
  metalPriceUsd: number
  withdrawalEstimate: string
  tasks: any[]
  referrals: any
  leaderboard: any[]
  userRank: number | null
  userTotalBonus: number
  userTotalMetals: number
  userMedals: number
  rankInfo: any
  platformName: string
  maintenanceMode: boolean
  // Referral settings
  botUsername: string
  referralReward: number
  referralMetalPercentage: number
  signupRewardEnabled: boolean
  commissionEnabled: boolean
  // Animation icons
  giftIcon: string
  // Game settings
  gameCardBgUrl: string
  gameCardTitle: string
  playCards: PlayCard[]
  refreshData: (sections?: string[]) => Promise<void>
  refreshTokens: () => Promise<void>
  refreshLeaderboard: () => Promise<void>
}

const AppDataContext = createContext<AppDataContextType | undefined>(undefined)

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { user: telegramUser } = useTelegram()
  const [loading, setLoading] = useState(true)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [tokens, setTokens] = useState<number | null>(null)
  const [tokensPerSecond, setTokensPerSecond] = useState<number>(0)
  const [medals, setMedals] = useState<number>(0)
  const [metalPriceUsd, setMetalPriceUsd] = useState<number>(0)
  const [withdrawalEstimate, setWithdrawalEstimate] = useState<string>('')
  const [tasks, setTasks] = useState<any[]>([])
  const [referrals, setReferrals] = useState<any>(null)
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [userRank, setUserRank] = useState<number | null>(null)
  const [userTotalBonus, setUserTotalBonus] = useState<number>(0)
  const [userTotalMetals, setUserTotalMetals] = useState<number>(0)
  const [userMedals, setUserMedals] = useState<number>(0)
  const [rankInfo, setRankInfo] = useState<any>(null)
  const [platformName, setPlatformName] = useState<string>('')
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false)
  // Referral settings state
  const [botUsername, setBotUsername] = useState<string>('')
  const [referralReward, setReferralReward] = useState<number>(0)
  const [referralMetalPercentage, setReferralMetalPercentage] = useState<number>(0)
  const [signupRewardEnabled, setSignupRewardEnabled] = useState<boolean>(false)
  const [commissionEnabled, setCommissionEnabled] = useState<boolean>(false)
  // Animation icons state
  const [giftIcon, setGiftIcon] = useState<string>('')
  // Game settings state
  const [gameCardBgUrl, setGameCardBgUrl] = useState<string>('')
  const [gameCardTitle, setGameCardTitle] = useState<string>('')
  const [playCards, setPlayCards] = useState<PlayCard[]>([])
  
  // Cache timestamp to prevent re-fetching too frequently (30 seconds stale time)
  const [lastFetchTime, setLastFetchTime] = useState<number>(0)
  const STALE_TIME = 30000 // 30 seconds

  // Load platform settings independently
  const loadPlatformSettings = async () => {
    try {
      const response = await fetch('/api/public-settings')
      if (response.ok) {
        const data = await response.json()
        if (data.settings?.platformName) {
          setPlatformName(data.settings.platformName)
        }
        
        setMaintenanceMode(!!data.settings?.maintenanceMode)
        
        // Load Metal token price from admin settings
        if (data.settings?.metalTokenPrice) {
          setMetalPriceUsd(data.settings.metalTokenPrice)
        }

        // Load withdrawal estimate timing
        if (data.settings?.withdrawalEstimate) {
          setWithdrawalEstimate(data.settings.withdrawalEstimate)
        }
        
        // Load bot username
        if (data.settings?.telegramBotUsername) {
          setBotUsername(data.settings.telegramBotUsername)
        }
        
        // Load referral settings
        const refSettings = data.settings?.referralSettings
        if (refSettings) {
          if (refSettings.rewardValue) setReferralReward(refSettings.rewardValue)
          if (refSettings.metalPercentage || refSettings.spinPercentage) setReferralMetalPercentage(refSettings.metalPercentage || refSettings.spinPercentage)
          // Use explicit boolean check - default to false if not explicitly set to true
          setSignupRewardEnabled(refSettings.signupRewardEnabled === true)
          setCommissionEnabled(refSettings.commissionEnabled === true)
        }
        
        // Load animation icons
        const animIcons = data.settings?.animationIcons
        if (animIcons?.giftIcon) {
          setGiftIcon(animIcons.giftIcon)
        }
        
        // Load game settings
        if (data.settings?.gameCardBgUrl) {
          setGameCardBgUrl(data.settings.gameCardBgUrl)
        }
        if (data.settings?.gameCardTitle) {
          setGameCardTitle(data.settings.gameCardTitle)
        }
        // Load play cards array
        if (Array.isArray(data.settings?.playCards)) {
          setPlayCards(
            data.settings.playCards
              .filter((c: any) => c.active)
              .map((c: any) => ({
                ...c,
                winnerMedals: typeof c.winnerMedals === 'number' ? c.winnerMedals : 10,
                loserMedals: typeof c.loserMedals === 'number' ? c.loserMedals : 0,
              }))
          )
        }
      }
    } catch (error) {
      console.error('Error loading platform settings:', error)
    }
  }

  useEffect(() => {
    if (telegramUser?.id) {
      loadAllData()
    }
  }, [telegramUser?.id])

  // Load settings independently (doesn't require auth)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      loadPlatformSettings()
    }
  }, [])

  const loadAllData = async (retryCount = 0, forceRefresh = false) => {
    if (!telegramUser?.id) return

    // Check if data is fresh (within stale time) and not forcing refresh
    const now = Date.now()
    if (!forceRefresh && userProfile && (now - lastFetchTime) < STALE_TIME) {
      console.log('Using cached data, last fetch was', Math.round((now - lastFetchTime) / 1000), 'seconds ago')
      return
    }

    try {
      setLoading(true)

      // Fetch all data in parallel
      const [
        profileRes,
        tokensRes,
        tasksRes,
        referralsRes,
        leaderboardRes,
        rankInfoRes,
      ] = await Promise.all([
        fetch('/api/user/profile', {
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/json',
            'x-telegram-id': telegramUser.id.toString()
          }
        }),
        fetch('/api/user/tokens', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }),
        fetch('/api/user/tasks', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }),
        fetch('/api/user/referrals', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }),
        fetch('/api/user/leaderboard', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }),
        fetch('/api/user/rank-info', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }),
      ])

      // Parse all responses
      const [
        profileData,
        tokensData,
        tasksData,
        referralsData,
        leaderboardData,
        rankInfoData,
      ] = await Promise.all([
        profileRes.ok ? profileRes.json() : null,
        tokensRes.ok ? tokensRes.json() : null,
        tasksRes.ok ? tasksRes.json() : null,
        referralsRes.ok ? referralsRes.json() : null,
        leaderboardRes.ok ? leaderboardRes.json() : null,
        rankInfoRes.ok ? rankInfoRes.json() : null,
      ])

      // Set all state
      if (profileData) {
        setUserProfile(profileData)
        // Set medals from profile
        setMedals(profileData.medals || profileData.user?.medals || 0)
      } else if (retryCount < 2) {
        console.log('Profile load failed, retrying...', retryCount + 1)
        setLoading(false)
        setTimeout(() => loadAllData(retryCount + 1), 1000)
        return
      }
      
      if (tokensData?.success) {
        setTokens(tokensData.tokens.totalTokens)
        setTokensPerSecond(tokensData.tokens.tokensPerSecond || 0)
      }
      
      if (tasksData?.success) {
        setTasks(tasksData.tasks || [])
      }
      
      if (referralsData) {
        setReferrals(referralsData)
      }
      
      if (leaderboardData?.success) {
        const lb = leaderboardData.leaderboard || []
        setLeaderboard(lb)
        primePhotoCache(lb.filter((u: any) => !u.anonymousMode && u.photoUrl).map((u: any) => ({ telegramId: Number(u.telegramId), photoUrl: u.photoUrl })))
        if (leaderboardData.userRank) {
          setUserRank(leaderboardData.userRank)
        }
        if (leaderboardData.userTotalBonus !== undefined) {
          setUserTotalBonus(leaderboardData.userTotalBonus)
        }
        if (leaderboardData.userTotalMetals !== undefined) {
          setUserTotalMetals(leaderboardData.userTotalMetals)
        }
        if (leaderboardData.userMedals !== undefined) {
          setUserMedals(leaderboardData.userMedals)
        }
      }
      
      if (rankInfoData) {
        setRankInfo(rankInfoData)
      }

      // Update last fetch time on successful load
      setLastFetchTime(Date.now())

    } catch (error) {
      console.error('Error loading app data:', error)
      if (retryCount < 2) {
        // Retry on error for first-time registration
        console.log('Error loading data, retrying...', retryCount + 1)
        setLoading(false)
        setTimeout(() => loadAllData(retryCount + 1), 1000)
        return
      }
    } finally {
      setLoading(false)
    }
  }

  const refreshData = async (sections?: string[]) => {
    if (!telegramUser?.id) return

    // If refreshing all data, use loadAllData with force refresh
    if (!sections || sections.length === 0) {
      return loadAllData(0, true)
    }

    try {
      const requests: Promise<Response>[] = []
      const keys: string[] = []

      // If no sections specified, refresh all
      const sectionsToRefresh = sections || ['profile', 'tokens', 'tasks', 'referrals', 'leaderboard', 'rankInfo']

      if (sectionsToRefresh.includes('profile')) {
        requests.push(fetch('/api/user/profile', {
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/json',
            'x-telegram-id': telegramUser.id.toString()
          }
        }))
        keys.push('profile')
      }

      if (sectionsToRefresh.includes('tokens')) {
        requests.push(fetch('/api/user/tokens', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }))
        keys.push('tokens')
      }

      if (sectionsToRefresh.includes('tasks')) {
        requests.push(fetch('/api/user/tasks', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }))
        keys.push('tasks')
      }

      if (sectionsToRefresh.includes('referrals')) {
        requests.push(fetch('/api/user/referrals', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }))
        keys.push('referrals')
      }

      if (sectionsToRefresh.includes('leaderboard')) {
        requests.push(fetch('/api/user/leaderboard', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }))
        keys.push('leaderboard')
      }

      if (sectionsToRefresh.includes('rankInfo')) {
        requests.push(fetch('/api/user/rank-info', {
          headers: { 'x-telegram-id': telegramUser.id.toString() }
        }))
        keys.push('rankInfo')
      }

      const responses = await Promise.all(requests)
      const data = await Promise.all(responses.map(r => r.ok ? r.json() : null))

      // Update state based on what was refreshed
      keys.forEach((key, index) => {
        const result = data[index]
        if (!result) return

        switch (key) {
          case 'profile':
            setUserProfile(result)
            setMedals(result.medals || result.user?.medals || 0)
            break
          case 'tokens':
            if (result.success) {
              setTokens(result.tokens.totalTokens)
              setTokensPerSecond(result.tokens.tokensPerSecond || 0)
            }
            break
          case 'tasks':
            if (result.success) {
              setTasks(result.tasks || [])
            }
            break
          case 'referrals':
            setReferrals(result)
            break
          case 'leaderboard':
            if (result.success) {
              const lb = result.leaderboard || []
              setLeaderboard(lb)
              primePhotoCache(lb.filter((u: any) => !u.anonymousMode && u.photoUrl).map((u: any) => ({ telegramId: Number(u.telegramId), photoUrl: u.photoUrl })))
            }
            break
          case 'rankInfo':
            setRankInfo(result)
            break
        }
      })
    } catch (error) {
      console.error('Error refreshing data:', error)
    }
  }

  const refreshTokens = async () => {
    await refreshData(['tokens', 'rankInfo'])
  }

  const refreshLeaderboard = async () => {
    if (!telegramUser?.id) return
    try {
      const response = await fetch('/api/user/leaderboard', {
        headers: { 'x-telegram-id': telegramUser.id.toString() }
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const lb = data.leaderboard || []
          setLeaderboard(lb)
          primePhotoCache(lb.filter((u: any) => !u.anonymousMode && u.photoUrl).map((u: any) => ({ telegramId: Number(u.telegramId), photoUrl: u.photoUrl })))
          if (data.userRank) {
            setUserRank(data.userRank)
          }
          if (data.userTotalBonus !== undefined) {
            setUserTotalBonus(data.userTotalBonus)
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing leaderboard:', error)
    }
  }

  return (
    <AppDataContext.Provider
      value={{
        loading,
        userProfile,
        tokens,
        tokensPerSecond,
        medals,
        metalPriceUsd,
        withdrawalEstimate,
        tasks,
        referrals,
        leaderboard,
        userRank,
        userTotalBonus,
        userTotalMetals,
        userMedals,
        rankInfo,
        platformName,
        maintenanceMode,
        botUsername,
        referralReward,
        referralMetalPercentage,
        signupRewardEnabled,
        commissionEnabled,
        giftIcon,
        gameCardBgUrl,
        gameCardTitle,
        playCards,
        refreshData,
        refreshTokens,
        refreshLeaderboard
      }}
    >
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const context = useContext(AppDataContext)
  if (context === undefined) {
    throw new Error('useAppData must be used within an AppDataProvider')
  }
  return context
}
