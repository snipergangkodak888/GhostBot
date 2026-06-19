// Simplified color utility - stable fallback colors only
// No complex extraction that causes transparency issues

interface ColorResult {
  hex: string
  rgb: string
  rgba: string
  isDark: boolean
  isLight: boolean
}

// Solid fallback colors
const FALLBACK_COLOR: ColorResult = {
  hex: '#374151',
  rgb: 'rgb(55, 65, 81)',
  rgba: 'rgba(55, 65, 81, 1)',
  isDark: true,
  isLight: false
}

/**
 * Extract color from image - returns solid fallback
 */
export async function extractColor(url: string): Promise<ColorResult> {
  return FALLBACK_COLOR
}

/**
 * Create gradient background - solid colors
 */
export function createGradient(): string {
  // Use solid gray gradient - stable and visible
  return 'linear-gradient(135deg, rgba(31, 41, 55, 0.6) 0%, rgba(55, 65, 81, 0.6) 100%)'
}

/**
 * Get border color - solid gray
 */
export function getBorderColor(): string {
  return 'rgba(75, 85, 99, 0.5)'
}
