/** Default slippage allowance shared by Pump Buy Setup and the funding-swap preview. */
export const PUMP_CUSTOM_FUNDING_SLIPPAGE_BPS = 200;

import type { PumpfunCustomQuoteTerms } from './pumpfun-quote-math.ts';
/** Explicit funding targets; the start request also caps each wallet's SOL debit at its reviewed preview. */
export interface PumpCustomFundingInput {
  slippageBps: number;
  /** Optional total SOL input in lamports; omitted means only the planned shortfalls. */
  nativeInLamports?: string;
  /** Extra buying may include funded wallets; all wallets still short remain mandatory. */
  walletScope?: 'all' | 'short' | string[];
  wallets: Array<{ walletId: string; quoteAmountAtomic: string; nativeReserveLamports: string }>;
  maxNativeInputLamports?: Record<string, string>;
}
/** Funding amounts use raw quote units or lamports, including for eight-decimal quote mints. */
export interface PumpCustomFundingPreview {
  quote: PumpfunCustomQuoteTerms;
  quotedAt: string;
  aggregatorId: string | null;
  /** Raw reference rate used to size the reviewed wallet inputs. */
  rate: { nativeInLamports: string; quoteOutAtomic: string } | null;
  /** Need-sized inputs and selected wallets define the editable amount bounds. */
  requiredNativeInputLamports: string;
  maxNativeInputLamports: string;
  scopedWalletIds: string[];
  walletScope: 'all' | 'short' | 'custom';
  wallets: Array<{
    walletId: string;
    address: string;
    quoteBalanceAtomic: string;
    quoteShortfallAtomic: string;
    /** Planned need plus slippage-protected output for any extra native input. */
    minimumQuoteOutputAtomic: string;
    requiredNativeInputLamports: string;
    nativeInputLamports: string;
    nativeReserveLamports: string;
    nativeShortfallLamports: string;
    nativeBalanceLamports: string;
  }>;
}

/**
 * Sizes each quote shortfall from a raw native/quote rate, preserving slippage headroom.
 * @param needs - Wallet IDs mapped to raw quote shortfalls; nonpositive entries are omitted
 * @param nativeIn - Positive native input of the reference quote
 * @param quoteOut - Positive raw output of the reference quote
 * @param slippageBps - Integer slippage allowance from zero through 9,999
 * @returns Wallet IDs mapped to native inputs rounded upward
 * @throws Error for a nonpositive rate or invalid slippage
 */
export function sizeLaunchQuoteFunding(
  needs: ReadonlyMap<string, bigint>,
  nativeIn: bigint,
  quoteOut: bigint,
  slippageBps: number,
): Map<string, bigint> {
  if (quoteOut <= 0n) throw new Error('Launch funding quote returned no output');
  if (
    nativeIn <= 0n ||
    quoteOut <= 0n ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  )
    throw new Error('Invalid launch funding rate or slippage');
  const denominator = quoteOut * (10_000n - BigInt(slippageBps));
  return new Map(
    [...needs]
      .filter(([, need]) => need > 0n)
      .map(([id, need]) => [id, (need * nativeIn * 10_000n + denominator - 1n) / denominator]),
  );
}
