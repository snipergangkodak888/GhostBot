"use client"

import { memo, ReactNode, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTelegram } from "@/components/telegram-provider"
import { useAppData } from "@/contexts/app-data-context"
import { useMergeGame } from "@/contexts/merge-game-context"

interface TopBarProps {
  telegramId: number
  showProfile?: boolean
  rightContent?: ReactNode
}

function TopBar({ telegramId, showProfile = true, rightContent }: TopBarProps) {
  const router = useRouter()
  const { user: telegramUser } = useTelegram()
  const { userProfile, userRank } = useAppData()
  const { energy } = useMergeGame()
  const isAnonymous = userProfile?.user?.anonymousMode === true
  const displayName = isAnonymous ? 'Anonymous' : userProfile?.user?.firstName

  const initials = useMemo(() => {
    const name = displayName || 'A'
    return name.charAt(0).toUpperCase()
  }, [displayName])

  return (
    <div className="bg-transparent">
      <div className="max-w-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Profile Section */}
          {showProfile && userProfile && (
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); router.push('/dashboard/profile') }}
              onClick={() => router.push('/dashboard/profile')}
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
              className="flex items-center gap-3"
            >
              {/* Avatar - no border */}
              <div className="relative w-11 h-11 shrink-0">
                <img
                  src={(telegramUser?.photo_url as string | undefined) || userProfile.user?.photoUrl || '/images/Icons/Anony.webp'}
                  alt={telegramUser?.first_name || userProfile.user?.firstName || 'User'}
                  className="w-11 h-11 rounded-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/images/Icons/Anony.webp' }}
                />
              </div>

              <div className="flex flex-col items-start justify-center">
                <span className="text-sm font-semibold text-white">{displayName || 'Anonymous'}</span>
              </div>
            </button>
          )}

          {/* Right: Leaderboard Button with Ranking */}
          <div className="flex items-center gap-2">
            {rightContent ? (
              rightContent
            ) : (
              <button
                type="button"
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); router.push('/dashboard/leaderboard') }}
                onClick={() => router.push('/dashboard/leaderboard')}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
                className="flex items-center gap-2 px-3 py-2 bg-[#C3D82E] rounded-full hover:brightness-95 transition-colors"
              >
                <img src="/images/Stickers/trophy.webp" alt="trophy" className="w-5 h-5" />
                <span className="text-sm font-bold text-[#044F4D] tabular-nums">#{userRank || '-'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(TopBar)
