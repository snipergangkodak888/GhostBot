import type { RevenueChain } from "@/lib/revenue-types"

const EXPLORER_TX_BASE: Record<RevenueChain, string> = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  bnb: "https://bscscan.com/tx/",
  robinhood: "https://robinhoodchain.blockscout.com/tx/",
  solana: "https://solscan.io/tx/",
}

export function revenueTransactionUrl(chain: RevenueChain | string | null | undefined, transactionHash: unknown) {
  const base = EXPLORER_TX_BASE[chain as RevenueChain]
  const hash = String(transactionHash || "").trim()
  return base && hash ? `${base}${encodeURIComponent(hash)}` : null
}
