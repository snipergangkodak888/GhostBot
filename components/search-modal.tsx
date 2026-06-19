"use client"

import { useState, useEffect } from "react"
import { Search, X, TrendingUp } from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { KeyframesMultipleIcon } from "@hugeicons/core-free-icons"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { extractColor, createGradient, getBorderColor } from "@/lib/color-extractor-simple"

interface League {
  _id: string
  leagueId: number
  name: string
  logo?: string
  country: string
  order?: number
}

interface Match {
  _id: string
  fixtureId: number
  homeTeam: {
    id: number
    name: string
    logo?: string
  }
  awayTeam: {
    id: number
    name: string
    logo?: string
  }
  league: {
    id: number
    name: string
    logo?: string
  }
  date: string
  status: string
  prediction?: {
    predictions: {
      winner: {
        name: string
        comment: string
      }
      percent: {
        home: string
        draw: string
        away: string
      }
    }
  }
}

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null) // null = "All"
  const [leagues, setLeagues] = useState<League[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [teamColors, setTeamColors] = useState<Record<string, { home: any, away: any }>>({})
  const [predictionsRemaining, setPredictionsRemaining] = useState<number | null>(null)
  const [consumedFixtureIds, setConsumedFixtureIds] = useState<Set<number>>(new Set()) // Track consumed predictions
  const [isVIP, setIsVIP] = useState(false)
  const [dailyFreePrediction, setDailyFreePrediction] = useState<{enabled: boolean, fixtureId: string | null}>({ enabled: false, fixtureId: null })
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)
  const [collapsedLeagues, setCollapsedLeagues] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (isOpen) {
      setMatches([])
      setCurrentPage(1)
      setHasMore(true)
      fetchData()
      fetchConsumedPredictions() // Fetch consumed predictions
    }
  }, [isOpen, selectedLeagueId])

  // Debounced search effect
  useEffect(() => {
    if (!isOpen) return

    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }

    // Set new timeout for search
    const timeout = setTimeout(() => {
      setMatches([])
      setCurrentPage(1)
      setHasMore(true)
      fetchMatches(1)
    }, 500) // Wait 500ms after user stops typing

    setSearchTimeout(timeout)

    return () => {
      if (timeout) clearTimeout(timeout)
    }
  }, [searchQuery])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch user profile for predictions remaining
  const profileRes = await fetch('/api/user/profile', { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        setPredictionsRemaining(profileData.predictions.remaining)
        setIsVIP(profileData.subscription !== null)
      }

      // Fetch settings for daily free prediction
  const settingsRes = await fetch('/api/public-settings', { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        if (settingsData.settings?.dailyFreePrediction) {
          setDailyFreePrediction({
            enabled: settingsData.settings.dailyFreePrediction.enabled || false,
            fixtureId: settingsData.settings.dailyFreePrediction.fixtureId || null
          })
        }
      }

      // Fetch leagues
      const ts = Date.now()
      const leaguesRes = await fetch(`/api/user/football/leagues?_t=${ts}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
      if (leaguesRes.ok) {
        const leaguesData = await leaguesRes.json()
        const sorted = (leaguesData.leagues || []).slice().sort((a: League, b: League) => {
          const ao = typeof a.order === 'number' ? a.order : 9999
          const bo = typeof b.order === 'number' ? b.order : 9999
          return ao - bo || a.name.localeCompare(b.name)
        })
        setLeagues(sorted)
      }

      // Fetch initial matches
      await fetchMatches(1)
    } catch (error) {
      console.error('Error fetching search data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMatches = async (page: number) => {
    try {
      if (page === 1) {
        setLoading(true)
      } else {
        setLoadingMore(true)
      }

      // Build search query
      const query = new URLSearchParams({
        page: page.toString(),
        pageSize: '20',
        status: 'NS'
      })
      
      if (selectedLeagueId) {
        query.append('leagueId', selectedLeagueId.toString())
      }

      // Add search query to API (we'll need to update the API to support this)
      if (searchQuery) {
        query.append('search', searchQuery)
      }
      
  const matchesRes = await fetch(`/api/user/football/matches?${query}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      if (matchesRes.ok) {
        const matchesData = await matchesRes.json()
        const fetchedMatches = matchesData.matches || []
        
        if (page === 1) {
          setMatches(fetchedMatches)
        } else {
          setMatches(prev => [...prev, ...fetchedMatches])
        }
        
        setHasMore(fetchedMatches.length === 20) // If we got full page, there might be more
        setCurrentPage(page)
        
        // Extract colors from team logos
        await extractMatchColors(fetchedMatches)
      }
    } catch (error) {
      console.error('Error fetching matches:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMoreMatches = () => {
    if (loadingMore || !hasMore) return
    fetchMatches(currentPage + 1)
  }

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const container = e.target as HTMLElement
      if (!container) return

      const scrollPercentage = (container.scrollTop + container.clientHeight) / container.scrollHeight

      if (scrollPercentage > 0.8 && !loadingMore && hasMore) {
        loadMoreMatches()
      }
    }

    const container = document.getElementById('search-results-container')
    if (container) {
      container.addEventListener('scroll', handleScroll)
      return () => container.removeEventListener('scroll', handleScroll)
    }
  }, [loadingMore, hasMore])

  const fetchConsumedPredictions = async () => {
    try {
  const response = await fetch('/api/user/predictions/history', { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      
      if (response.ok) {
        const data = await response.json()
        const consumedIds = new Set<number>(
          data.predictions
            .map((pred: any) => pred.fixtureId)
            .filter((id: any) => typeof id === 'number')
        )
        setConsumedFixtureIds(consumedIds)
      }
    } catch (error) {
      console.error('Error fetching consumed predictions:', error)
    }
  }

  const extractMatchColors = async (matches: any[]) => {
    // Simplified - use solid fallback colors for all matches
    const colors: Record<string, { home: any, away: any }> = {}
    
    matches.forEach((match) => {
      colors[match.fixtureId] = {
        home: { hex: '#374151', rgb: 'rgb(55, 65, 81)', rgba: 'rgba(55, 65, 81, 1)', isDark: true, isLight: false },
        away: { hex: '#374151', rgb: 'rgb(55, 65, 81)', rgba: 'rgba(55, 65, 81, 1)', isDark: true, isLight: false }
      }
    })
    
    setTeamColors(colors)
  }

  const handleLeagueClick = (leagueId: number | null) => {
    setSelectedLeagueId(leagueId)
  }

  const filteredMatches = matches.filter(match => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      match.homeTeam.name.toLowerCase().includes(query) ||
      match.awayTeam.name.toLowerCase().includes(query) ||
      match.league.name.toLowerCase().includes(query)
    )
  })

  const handleMatchClick = (fixtureId: number) => {
    router.push(`/dashboard/match/${fixtureId}`)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/95 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] bg-gradient-to-br from-gray-900 to-black rounded-2xl border border-gray-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-white">Search Matches</h2>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Search Input */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search teams or leagues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition-colors"
            />
          </div>

          {/* League Filter Buttons */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
            {/* All Matches Button */}
            <button
              onClick={() => handleLeagueClick(null)}
              className={`transition-all duration-300 ease-in-out rounded-full flex items-center justify-center flex-shrink-0 ${
                selectedLeagueId === null
                  ? "bg-green-500 text-black px-3 py-2 min-w-fit"
                  : "w-9 h-9 bg-gray-800 hover:bg-gray-700"
              }`}
            >
              {selectedLeagueId === null ? (
                <>
                  <HugeiconsIcon icon={KeyframesMultipleIcon} size={16} color="#000000" className="mr-1.5" />
                  <span className="font-semibold text-xs whitespace-nowrap">All</span>
                </>
              ) : (
                <HugeiconsIcon icon={KeyframesMultipleIcon} size={16} color="#ffffff" />
              )}
            </button>

            {/* League Filter Buttons */}
            {leagues.map((league) => (
              <button
                key={league._id}
                onClick={() => handleLeagueClick(league.leagueId)}
                className={`transition-all duration-300 ease-in-out rounded-full flex items-center justify-center flex-shrink-0 ${
                  selectedLeagueId === league.leagueId
                    ? "bg-green-500 text-black px-3 py-2 min-w-fit"
                    : "w-9 h-9 bg-gray-800 hover:bg-gray-700"
                }`}
              >
                {selectedLeagueId === league.leagueId ? (
                  <>
                    {league.logo && (
                      <div className="w-4 h-4 relative mr-1.5 flex-shrink-0">
                        <Image
                          src={league.logo}
                          alt={league.name}
                          fill
                          className="object-contain"
                        />
                      </div>
                    )}
                    <span className="font-semibold text-xs whitespace-nowrap truncate max-w-[120px]">{league.name}</span>
                  </>
                ) : (
                  <div className="w-5 h-5 relative">
                    {league.logo ? (
                      <Image 
                        src={league.logo} 
                        alt={league.name} 
                        fill 
                        className="object-contain" 
                      />
                    ) : (
                      <span className="text-white text-[10px] font-bold">
                        {league.name.substring(0, 2)}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div id="search-results-container" className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Matches Section */}
              <div>
                {filteredMatches.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-8">No matches found</p>
                ) : (
                  <>
                    <div className="space-y-3">{/* Reduced spacing for mobile */}
                      {(() => {
                        const grouped: Record<number, Match[]> = {}
                        for (const m of filteredMatches) {
                          const lid = m.league.id
                          if (!grouped[lid]) grouped[lid] = []
                          grouped[lid].push(m)
                        }
                        const sections: JSX.Element[] = []
                        for (const league of leagues) {
                          const group = grouped[league.leagueId] || []
                          if (group.length === 0) continue
                          const isCollapsed = !!collapsedLeagues[league.leagueId]
                          sections.push(
                            <div key={league._id} className="mb-3">
                              <button
                                onClick={() => setCollapsedLeagues(prev => ({ ...prev, [league.leagueId]: !prev[league.leagueId] }))}
                                className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10"
                              >
                                <div className="flex items-center gap-2">
                                  {league.logo && (
                                    <div className="w-4 h-4 relative">
                                      <Image src={league.logo} alt={league.name} fill className="object-contain" />
                                    </div>
                                  )}
                                  <span className="text-xs font-semibold text-white">{league.name}</span>
                                </div>
                                <span className="text-[10px] text-gray-400">{group.length}</span>
                              </button>
                              {!isCollapsed && (
                                <div className="space-y-3 mt-2">
                                  {group.map((match) => {
                                    const matchDate = new Date(match.date)
                                    const isLive = match.status === 'LIVE' || match.status === '1H' || match.status === '2H'
                                    const timeDisplay = isLive ? 'LIVE' : matchDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                                    const prediction = match.prediction?.predictions
                                    const homePercent = prediction?.percent?.home ? parseFloat(prediction.percent.home) : null
                                    const drawPercent = prediction?.percent?.draw ? parseFloat(prediction.percent.draw) : null
                                    const awayPercent = prediction?.percent?.away ? parseFloat(prediction.percent.away) : null
                                    const bgGradient = 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)'
                                    const borderColor = 'rgba(255, 255, 255, 0.1)'
                                    const boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.2)'
                                    return (
                                      <div
                                        key={match._id}
                                        className="rounded-xl p-4 backdrop-blur-md transition-all duration-300 hover:scale-[1.02] hover:shadow-xl border"
                                        style={{ background: bgGradient, borderColor: borderColor, boxShadow: boxShadow }}
                                      >
                                        {/* League Info - Smaller for mobile */}
                                        <div className="flex items-center gap-1.5 mb-3">
                                          {match.league.logo && (
                                            <Image src={match.league.logo} alt={match.league.name} width={14} height={14} className="object-contain" />
                                          )}
                                          <span className="text-[10px] text-gray-400 truncate">{match.league.name}</span>
                                          <span className="text-[10px] text-gray-600">•</span>
                                          <span className="text-[10px] text-gray-400">{matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                        <div className="flex items-center justify-between mb-4">
                                          {/* Team 1 - Smaller */}
                                          <div className="flex flex-col items-center w-16">
                                            <div className="w-9 h-9 flex items-center justify-center mb-2">
                                              <Image src={match.homeTeam.logo || '/images/clubplaceholder.svg'} alt={match.homeTeam.name} width={32} height={32} className="object-contain max-h-[150px]" />
                                            </div>
                                            <span className="text-white text-[10px] font-medium text-center leading-tight px-0.5 max-w-full truncate">{match.homeTeam.name}</span>
                                          </div>
                                          {/* VS and Time - Smaller */}
                                          <div className="flex flex-col items-center flex-1 mx-2">
                                            <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 ${isLive ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300'}`}>{timeDisplay}</div>
                                            <div className="text-green-500 text-lg font-bold">VS</div>
                                          </div>
                                          {/* Team 2 - Smaller */}
                                          <div className="flex flex-col items-center w-16">
                                            <div className="w-9 h-9 flex items-center justify-center mb-2">
                                              <Image src={match.awayTeam.logo || '/images/clubplaceholder.svg'} alt={match.awayTeam.name} width={32} height={32} className="object-contain max-h-[150px]" />
                                            </div>
                                            <span className="text-white text-[10px] font-medium text-center leading-tight px-0.5 max-w-full truncate">{match.awayTeam.name}</span>
                                          </div>
                                        </div>
                                        {/* Prediction Display - Smaller */}
                                        {prediction && homePercent !== null && (
                                          <div className="mb-3 grid grid-cols-3 gap-1.5">
                                            <div className="text-center p-1.5 bg-gray-800/50 rounded-lg">
                                              <div className="text-[9px] text-gray-400">Home</div>
                                              <div className="text-xs font-bold text-green-400">{homePercent.toFixed(1)}%</div>
                                            </div>
                                            <div className="text-center p-1.5 bg-gray-800/50 rounded-lg">
                                              <div className="text-[9px] text-gray-400">Draw</div>
                                              <div className="text-xs font-bold text-yellow-400">{drawPercent?.toFixed(1)}%</div>
                                            </div>
                                            <div className="text-center p-1.5 bg-gray-800/50 rounded-lg">
                                              <div className="text-[9px] text-gray-400">Away</div>
                                              <div className="text-xs font-bold text-blue-400">{awayPercent?.toFixed(1)}%</div>
                                            </div>
                                          </div>
                                        )}
                                        <div className="flex justify-center mt-3">
                                          {consumedFixtureIds.has(match.fixtureId) ? (
                                            <button
                                              onClick={() => handleMatchClick(match.fixtureId)}
                                              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-blue-500/25 flex gap-1.5 py-2 px-3 items-center tracking-tighter text-xs font-semibold"
                                            >
                                              <TrendingUp className="w-3.5 h-3.5" />
                                              <span className="leading-3">View Prediction</span>
                                            </button>
                                          ) : (
                                            dailyFreePrediction.enabled && dailyFreePrediction.fixtureId === String(match.fixtureId) && !isVIP ? (
                                              <button
                                                onClick={() => handleMatchClick(match.fixtureId)}
                                                className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 flex gap-1.5 py-2 px-3 items-center tracking-tighter text-xs font-semibold"
                                              >
                                                <span className="text-base">🎁</span>
                                                <span className="leading-3">Free Daily</span>
                                              </button>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  if (predictionsRemaining === 0) return
                                                  handleMatchClick(match.fixtureId)
                                                }}
                                                className={`rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg flex gap-1.5 py-2 px-3 items-center tracking-tighter text-xs font-semibold ${
                                                  predictionsRemaining === 0
                                                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                                    : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-black hover:shadow-green-500/25'
                                                }`}
                                              >
                                                <TrendingUp className="w-3.5 h-3.5" />
                                                <span className="leading-3">{predictionsRemaining === 0 ? 'No Credits' : 'Unlock Prediction'}</span>
                                              </button>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        }
                        return sections
                      })()}
                    </div>

                    {/* Loading More Indicator */}
                    {loadingMore && (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                        <span className="ml-3 text-gray-400 text-sm">Loading more matches...</span>
                      </div>
                    )}

                    {/* All Loaded Message */}
                    {!loadingMore && !hasMore && matches.length >= 10 && (
                      <div className="text-center py-6">
                        <p className="text-gray-500 text-sm">All matches loaded</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
