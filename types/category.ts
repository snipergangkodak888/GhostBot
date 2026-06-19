// Gift Category type for organizing gifts into spinnable categories
export interface GiftCategory {
  _id?: string
  name: string
  slug: string // URL-friendly identifier
  description?: string
  iconUrl?: string // Icon or webp image URL
  order: number // Display order (lower = first)
  spinsPerSpin: number // Number of spins consumed per spinning this category
  goodLuckWeight: number // Weight for "Good Luck Next Time" outcome (0-100, default 20)
  // Legacy fields for backwards compatibility
  spinPrice?: number
  spinChances?: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateCategoryRequest {
  name: string
  description?: string
  iconUrl?: string
  order?: number
  spinsPerSpin: number
}

export interface UpdateCategoryRequest {
  categoryId: string
  name?: string
  description?: string
  iconUrl?: string
  order?: number
  spinsPerSpin?: number
  isActive?: boolean
}
