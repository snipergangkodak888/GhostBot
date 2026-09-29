import { createDefaultRequest, getModelCatalog } from './catalog'

export type LaunchVenueGroup = 'solana' | 'bnb' | 'robinhood' | 'dex'

export const launchVenueGroups: Record<LaunchVenueGroup, string> = {
  solana: 'Solana', bnb: 'BNB Chain', robinhood: 'Robinhood Chain', dex: 'DEX examples',
}
const venueNames: Record<string, string> = {
  pumpfun: 'Pump.fun · SOL', 'pumpfun-custom': 'Pump.fun · USDC',
  stonkfun: 'Stonkfun', launchlab: 'LaunchLab · Stonkfun settings',
  'raydium-cpmm': 'Raydium CPMM', fourmeme: 'Four.meme', flap: 'Flap',
  pons: 'Pons V2', letscash: 'LetsCash', 'pools-instant': 'Pools · Instant Launch',
  'lunch-v3': 'lunch.fun · V3', 'lunch-v4-tax': 'lunch.fun · V4 tax',
  'lunch-v4-rewards': 'lunch.fun · V4 rewards', 'sushi-launchpad': 'Sushi Launchpad · V1',
  'uniswap-v2': 'Uniswap V2', 'uniswap-v3': 'Uniswap V3 · full range',
}

export function groupFor(modelId: string): LaunchVenueGroup {
  if (modelId.startsWith('uniswap-')) return 'dex'
  const chain = createDefaultRequest(modelId).chain
  return chain === 'Solana' ? 'solana' : chain === 'BNB Chain' ? 'bnb' : 'robinhood'
}

export function venueName(modelId: string): string {
  return venueNames[modelId] || getModelCatalog().find(model => model.id === modelId)?.label || modelId
}

/** Both Telegram tools draw their choices from the report catalogue. */
export function getLaunchVenues() {
  return getModelCatalog().map(model => {
    const request = createDefaultRequest(model.id)
    return { ...model, name: venueName(model.id), chainId: groupFor(model.id), symbol: request.quote.symbol,
      type: model.requiresLiquidity ? 'amm' as const : 'curve' as const,
      defaultLp: model.requiresLiquidity ? Number(request.liquidityAmounts![0]) : undefined }
  })
}
export function launchVenue(id: string) { return getLaunchVenues().find(venue => venue.id === id) }
