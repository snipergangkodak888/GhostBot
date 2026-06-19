// Airdrop System Types

export type GameMode = 'idle' | 'mine' | 'hold'

export interface UserTokens {
  _id?: string
  telegramId: number
  totalTokens: number
  idleTokens: number
  mineTokens: number
  holdTokens: number
  adTokens: number
  taskTokens: number
  referralTokens: number
  createdAt: Date
  updatedAt: Date
}

export interface MiningSession {
  _id?: string
  telegramId: number
  mode: GameMode
  status: 'active' | 'completed' | 'claimed'
  startTime: Date
  endTime?: Date
  duration?: number // minutes
  tokensEarned: number
  miningRate: number // tokens per minute
  level: number
  boosts: Boost[]
  createdAt: Date
  updatedAt: Date
}

export interface Boost {
  id: string
  name: string
  multiplier: number
  duration: number // minutes
  appliedAt: Date
  expiresAt: Date
}

export interface IdleProgress {
  _id?: string
  telegramId: number
  level: number
  totalEarned: number
  businesses: IdleBusiness[]
  managers: Manager[]
  lastCollectedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface IdleBusiness {
  id: number
  name: string
  level: number
  owned: boolean
  revenue: number // tokens per second
  cost: number // cost to upgrade
  totalEarned: number
  icon: string
  managerId?: number
  autoCollect: boolean
}

export interface Manager {
  id: number
  name: string
  businessId: number
  cost: number
  owned: boolean
  multiplier: number
  avatar: string
}

export interface Business {
  _id?: string
  id: number
  name: string
  baseCost: number
  baseRevenue: number
  icon: string
  unlockLevel: number
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface Task {
  _id?: string
  taskId: string
  type: 'telegram' | 'social' | 'custom'
  title: string
  description: string
  reward: number
  icon: string
  active: boolean
  order: number
  requirements?: {
    telegramAction?: 'join_channel' | 'join_group' | 'follow_bot'
    channelUrl?: string
    groupUrl?: string
    socialUrl?: string
    customUrl?: string
    verificationTimer?: number  // seconds to wait before claim allowed (for non-Telegram native tasks)
  }
  createdAt: Date
  updatedAt: Date
}

export interface TaskCompletion {
  _id?: string
  telegramId: number
  taskId: string
  status: 'pending' | 'completed' | 'verified' | 'rejected'
  completedAt?: Date
  verifiedAt?: Date
  rewardClaimed: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Referral {
  _id?: string
  referrerId: number // Telegram ID of person who referred
  referredId: number // Telegram ID of person who was referred
  referralCode: string
  bonusEarned: number
  referredUserActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface AdReward {
  _id?: string
  telegramId: number
  network: 'adsgram' | 'onclicka' | 'adsonar'
  adId: string
  tokensEarned: number
  createdAt: Date
}

export interface WithdrawalRequest {
  _id?: string
  telegramId: number
  walletAddress: string
  amount: number
  fee: number
  status: 'pending' | 'approved' | 'rejected' | 'completed'
  txHash?: string
  notes?: string
  createdAt: Date
  processedAt?: Date
  updatedAt: Date
}

export interface GameModeSettings {
  activeMode: GameMode
  idleEnabled: boolean
  mineEnabled: boolean
  holdEnabled: boolean
}

export interface AirdropSettings {
  tokenName: string
  tokenSymbol: string
  withdrawalFeeEnabled: boolean
  withdrawalFee: number
  minimumWithdrawal: number
  conversionRate: number
}

export interface AdNetworkSettings {
  adsgram: { enabled: boolean; rewardPerAd: number; blockId?: string }
  onclicka: { enabled: boolean; rewardPerAd: number; zoneId?: string }
  adsonar: { enabled: boolean; rewardPerAd: number; blockId?: string }
}

export interface ReferralSettings {
  enabled: boolean
  rewardPerReferral: number
  referrerBonusPercent: number
}

// Mining configuration
export interface MiningConfig {
  baseMiningRate: number // Base tokens per minute
  maxLevel: number
  levelMultiplier: number // Multiplier per level
  mineDuration: number // Default mine duration in minutes
  upgradeCosts: { level: number; cost: number }[]
  availableBoosts: {
    id: string
    name: string
    multiplier: number
    duration: number
    cost: number
    icon: string
  }[]
}

// Hold configuration
export interface HoldConfig {
  baseHoldRate: number // Base tokens per second while holding
  maxLevel: number
  levelMultiplier: number
  upgradeCosts: { level: number; cost: number }[]
}

// Ranking Tier System Types
export interface RankTier {
  _id?: string
  tierId: string
  name: string
  logoUrl: string
  requiredTokens: number
  order: number
  color: string
  benefits: string[]
  active: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface UserRankInfo {
  currentTier: RankTier | null
  nextTier: RankTier | null
  progress: number
  leaderboardPosition: number
  totalTokens: number
}

// Idle Game Card Types
export interface IdleCard {
  _id?: string
  cardId: string
  name: string
  icon: string
  description: string
  baseCost: number
  baseRevenue: number
  unlockLevel: number
  order: number
  active: boolean
  createdAt?: Date
  updatedAt?: Date
}

// Mine Game Settings Types
export interface MineSettings {
  baseMiningRate: number
  maxLevel: number
  levelMultiplier: number
  defaultDuration: number
  cooldownMinutes: number
  upgradeCosts: { level: number; cost: number }[]
}

// Hold Game Settings Types
export interface HoldSettings {
  baseHoldRate: number
  maxLevel: number
  levelMultiplier: number
  energyMax: number
  energyRegenRate: number
  upgradeCosts: { level: number; cost: number }[]
}
