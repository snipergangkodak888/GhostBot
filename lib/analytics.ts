/**
 * Google Analytics 4 event tracking utility.
 * All game-specific events are defined here so they're consistent
 * across every part of the app.
 *
 * Usage:
 *   import { trackEvent } from '@/lib/analytics'
 *   trackEvent('merge', { from_level: 2, to_level: 3 })
 */

type GtagFn = (...args: any[]) => void

function gtag(...args: any[]) {
  if (typeof window === 'undefined') return
  const w = window as any
  if (typeof w.gtag === 'function') {
    (w.gtag as GtagFn)(...args)
  }
}

// ---------------------------------------------------------------------------
// Generic event
// ---------------------------------------------------------------------------
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
) {
  gtag('event', eventName, params)
}

// ---------------------------------------------------------------------------
// Game — Merge
// ---------------------------------------------------------------------------
export function trackMerge(fromLevel: number, toLevel: number) {
  gtag('event', 'merge', {
    event_category: 'game',
    from_level: fromLevel,
    to_level: toLevel,
  })
}

export function trackLevelUp(newLevel: number) {
  gtag('event', 'level_up', {
    event_category: 'game',
    level: newLevel,
  })
}

// ---------------------------------------------------------------------------
// Game — Energy
// ---------------------------------------------------------------------------
export function trackEnergyUsed(amount: number, remaining: number) {
  gtag('event', 'energy_used', {
    event_category: 'energy',
    amount,
    remaining,
  })
}

export function trackEnergyRefill(amount: number, source: 'task' | 'referral' | 'daily') {
  gtag('event', 'energy_refill', {
    event_category: 'energy',
    amount,
    source,
  })
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------
export function trackCouponClaimed(couponCode: string, level?: number) {
  gtag('event', 'coupon_claimed', {
    event_category: 'reward',
    coupon_code: couponCode,
    ...(level !== undefined && { level }),
  })
}

export function trackCouponViewed(couponCode: string) {
  gtag('event', 'coupon_viewed', {
    event_category: 'reward',
    coupon_code: couponCode,
  })
}

// ---------------------------------------------------------------------------
// Social / Tasks
// ---------------------------------------------------------------------------
export function trackTaskCompleted(taskId: string, taskTitle: string) {
  gtag('event', 'task_completed', {
    event_category: 'social',
    task_id: taskId,
    task_title: taskTitle,
  })
}

export function trackReferralJoined(referrerId?: string) {
  gtag('event', 'referral_joined', {
    event_category: 'social',
    ...(referrerId && { referrer_id: referrerId }),
  })
}

// ---------------------------------------------------------------------------
// User lifecycle
// ---------------------------------------------------------------------------
export function trackLogin(userId: string | number) {
  gtag('event', 'login', {
    event_category: 'user',
    method: 'telegram',
    user_id: String(userId),
  })
}

export function trackFirstOpen(userId: string | number) {
  gtag('event', 'first_open', {
    event_category: 'user',
    user_id: String(userId),
  })
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
export function trackLeaderboardView(userId?: string | number) {
  gtag('event', 'leaderboard_view', {
    event_category: 'navigation',
    ...(userId && { user_id: String(userId) }),
  })
}
