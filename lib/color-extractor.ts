import { FastAverageColor } from 'fast-average-color'

const fac = new FastAverageColor()

interface ColorResult {
  hex: string
  rgb: string
  rgba: string
  isDark: boolean
  isLight: boolean
}

// Cache for storing extracted colors
const colorCache: Map<string, ColorResult> = new Map()

// Default fallback colors
const DEFAULT_HOME_COLOR: ColorResult = {
  hex: '#22c55e',
  rgb: 'rgb(34, 197, 94)',
  rgba: 'rgba(34, 197, 94, 1)',
  isDark: false,
  isLight: false
}

const DEFAULT_AWAY_COLOR: ColorResult = {
  hex: '#3b82f6',
  rgb: 'rgb(59, 130, 246)',
  rgba: 'rgba(59, 130, 246, 1)',
  isDark: false,
  isLight: false
}

/**
 * Load image with retry mechanism
 */
async function loadImage(url: string, retries = 2): Promise<HTMLImageElement> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const img = document.createElement('img')
      img.crossOrigin = 'Anonymous'
      
      // Add cache busting only on retries to avoid CORS issues
      const imageUrl = attempt > 0 ? `${url}?retry=${attempt}` : url
      img.src = imageUrl

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Image load failed'))
        
        // Timeout after 5 seconds
        setTimeout(() => reject(new Error('Image load timeout')), 5000)
      })

      return img
    } catch (error) {
      if (attempt === retries) {
        throw error
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error('All retries failed')
}

/**
 * Check if color is too dark/light and needs adjustment
 */
function enhanceColor(color: ColorResult): ColorResult {
  // Parse RGB values
  const rgbMatch = color.rgb.match(/\d+/g)
  if (!rgbMatch) return color

  const [r, g, b] = rgbMatch.map(Number)
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  
  // If color is too dark (black/very dark), brighten it
  if (luminance < 0.15) {
    const factor = 0.15 / luminance
    const newR = Math.min(255, Math.round(r * factor * 2))
    const newG = Math.min(255, Math.round(g * factor * 2))
    const newB = Math.min(255, Math.round(b * factor * 2))
    
    return {
      hex: `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`,
      rgb: `rgb(${newR}, ${newG}, ${newB})`,
      rgba: `rgba(${newR}, ${newG}, ${newB}, 1)`,
      isDark: true,
      isLight: false
    }
  }
  
  // If color is too light (white/very light), darken it slightly
  if (luminance > 0.9) {
    const newR = Math.round(r * 0.7)
    const newG = Math.round(g * 0.7)
    const newB = Math.round(b * 0.7)
    
    return {
      hex: `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`,
      rgb: `rgb(${newR}, ${newG}, ${newB})`,
      rgba: `rgba(${newR}, ${newG}, ${newB}, 1)`,
      isDark: false,
      isLight: true
    }
  }
  
  return color
}

/**
 * Extract the dominant color from an image URL with enhanced robustness
 * @param imageUrl - The URL of the image to extract color from
 * @param isHomeTeam - Whether this is the home team (affects fallback color)
 * @returns Promise with color information
 */
export async function extractColor(imageUrl: string, isHomeTeam: boolean = true): Promise<ColorResult> {
  // Check cache first
  const cacheKey = imageUrl
  if (colorCache.has(cacheKey)) {
    return colorCache.get(cacheKey)!
  }

  try {
    // Load image with retry mechanism
    const img = await loadImage(imageUrl)

    // Extract color with high quality settings
    const color = await fac.getColorAsync(img, {
      algorithm: 'dominant',
      ignoredColor: [
        [255, 255, 255, 255, 50], // Ignore white/transparent backgrounds
        [0, 0, 0, 255, 30]         // Ignore pure black
      ]
    })

    // Enhance color if needed
    let result: ColorResult = {
      hex: color.hex,
      rgb: color.rgb,
      rgba: color.rgba,
      isDark: color.isDark,
      isLight: color.isLight
    }

    result = enhanceColor(result)

    // Cache the result
    colorCache.set(cacheKey, result)

    console.log(`✅ Color extracted for ${imageUrl}: ${result.hex}`)
    return result

  } catch (error) {
    console.warn(`⚠️ Failed to extract color from ${imageUrl}:`, error)
    
    // Return appropriate default color
    const defaultColor = isHomeTeam ? DEFAULT_HOME_COLOR : DEFAULT_AWAY_COLOR
    colorCache.set(cacheKey, defaultColor)
    return defaultColor
  }
}

/**
 * Get a gradient string for use in CSS from two team logo colors with dark background base
 */
export function createGradient(color1: ColorResult, color2: ColorResult, opacity: number = 0.3): string {
  const rgba1 = color1.rgba.replace(/[\d.]+\)$/, `${opacity})`)
  const rgba2 = color2.rgba.replace(/[\d.]+\)$/, `${opacity * 0.85})`) // Slightly less opacity for away
  // Create gradient with solid dark base
  return `linear-gradient(135deg, 
    rgba(17, 24, 39, 1) 0%, 
    ${rgba1} 25%, 
    ${rgba2} 75%, 
    rgba(17, 24, 39, 1) 100%)`
}

/**
 * Get a border color with opacity
 */
export function getBorderColor(color: ColorResult, opacity: number = 0.7): string {
  return color.rgba.replace(/[\d.]+\)$/, `${opacity})`)
}

/**
 * Clear color cache (useful for debugging or manual refresh)
 */
export function clearColorCache() {
  colorCache.clear()
  console.log('🗑️ Color cache cleared')
}

/**
 * Get cache size for monitoring
 */
export function getColorCacheSize(): number {
  return colorCache.size
}
