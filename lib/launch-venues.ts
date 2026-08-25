import { LAUNCH_PADS, type LaunchChainId } from "@/lib/launch-math"

export type OperationalLaunchVenue = {
  id: string
  chainId: LaunchChainId
  name: string
  symbol: "SOL" | "ETH" | "BNB"
  calculatorSupported: boolean
}

const EXTRA_OPERATIONAL_VENUES: OperationalLaunchVenue[] = [
  {
    id: "uni-rh-v4",
    chainId: "rh",
    name: "Uniswap V4",
    symbol: "ETH",
    calculatorSupported: false,
  },
]

export const OPERATIONAL_LAUNCH_VENUES: OperationalLaunchVenue[] = [
  ...LAUNCH_PADS.map((venue) => ({
    id: venue.id,
    chainId: venue.chainId,
    name: venue.name,
    symbol: venue.symbol,
    calculatorSupported: true,
  })),
  ...EXTRA_OPERATIONAL_VENUES,
]

export function operationalLaunchVenue(id: unknown) {
  return OPERATIONAL_LAUNCH_VENUES.find((venue) => venue.id === String(id || "")) || null
}

export function operationalVenuesForChain(chainId: LaunchChainId) {
  return OPERATIONAL_LAUNCH_VENUES.filter((venue) => venue.chainId === chainId)
}
