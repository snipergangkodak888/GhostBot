// Official Telegram Bot API Sticker structure
export interface TelegramSticker {
  file_id: string
  file_unique_id: string
  type: 'regular' | 'mask' | 'custom_emoji'
  width: number
  height: number
  is_animated: boolean
  is_video: boolean
  thumbnail?: {
    file_id: string
    file_unique_id: string
    width: number
    height: number
    file_size?: number
  }
  emoji?: string
  set_name?: string
  premium_animation?: {
    file_id: string
    file_unique_id: string
  }
  custom_emoji_id?: string
}

// Official Telegram Bot API Gift structure from getAvailableGifts
export interface TelegramBotGift {
  id: string
  sticker: TelegramSticker
  star_count: number
  upgrade_star_count?: number
  total_count?: number
  remaining_count?: number
  // Note: Gift name is typically derived from sticker set_name or emoji
}

// Response from Telegram Bot API getAvailableGifts
export interface AvailableGiftsResponse {
  ok: boolean
  result: {
    gifts: TelegramBotGift[]
  }
}

// Our database model - extends official gift with game mechanics
export interface TelegramGift {
  _id?: string
  giftId: string // Official Telegram gift ID
  giftSlug?: string // NFT slug for Fragment gifts (e.g., "SnoopDogg-18212")
  telegramGiftUrl?: string // Original Telegram URL added by admin (e.g., "https://t.me/nft/SnoopDogg-18212")
  categoryId?: string // Reference to GiftCategory for organizing gifts
  sticker?: TelegramSticker // Official sticker for display in Mini App
  customImage?: string // Custom image URL (e.g. for NFT gifts)
  customAnimation?: string // Custom animation URL (e.g. for NFT gifts)
  thumbnailUrl?: string // Direct cached thumbnail URL for fast display
  animationUrl?: string // Direct cached animation URL
  starCount: number // Stars needed (from Telegram)
  name?: string // Display name
  winChance: number // Percentage 0-100 (our game mechanic)
  priceInTon: number // Our custom price
  createdAt: Date
  updatedAt: Date
  isActive: boolean
  // Fragment NFT fields
  isFragmentNft?: boolean // True if this is a Fragment NFT gift
  fragmentUrl?: string // Full Fragment URL (e.g., "https://fragment.com/gift/astralshard-2028")
  fragmentSlug?: string // Extracted slug from URL (e.g., "astralshard-2028")
}

export interface AddGiftRequest {
  telegramGiftUrl: string // Telegram gift link: t.me/gift/xxx or gift ID directly
  winChance: number
  priceInTon: number
  name?: string // Custom name for the gift
  // Fragment NFT specific fields
  isFragmentNft?: boolean
  fragmentUrl?: string
  fragmentSlug?: string
  categoryId?: string
}

export interface TonApiNftResponse {
  name?: string
  title?: string
  image?: {
    original?: string
    preview?: string
  }
  previews?: Array<{ url: string }>
  metadata?: {
    image?: string
    animation_url?: string
  }
  collection?: {
    name?: string
    address?: string
  }
  collection_name?: string
  description?: string
  address?: string
  contract_address?: string
  id?: string
  token_id?: string
}
