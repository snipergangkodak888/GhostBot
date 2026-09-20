import type { LaunchLabCurveTerms } from './launchlab-quote-math.ts';

/**
 * Who vouches for a StonkFun quote mint, and how strongly.
 *
 * StonkFun curates every category except `custom`, whose mints are added on
 * user request and may impersonate a well-known ticker, so those are checked
 * against Jupiter's token list instead.
 *
 * @property source - `stonkfun` for curated categories, `jupiter` for custom mints
 * @property verified - Curated mints are always true. For custom mints this is
 *   Jupiter's explicit answer (`true`/`false`), or `null` when Jupiter had no
 *   opinion at all: the mint was absent from its list or the lookup failed, so
 *   the badge must say nothing rather than imply a negative verdict.
 * @property holderCount - Jupiter's holder count when known, else null
 */
export interface StonkFunQuoteVerification {
  source: 'stonkfun' | 'jupiter';
  verified: boolean | null;
  holderCount: number | null;
}

/**
 * Quote asset a StonkFun launch is priced against, as listed by the StonkFun catalog.
 *
 * `symbolAmbiguous` and `verification` are display-only: the catalog repeats
 * tickers across unrelated mints, so the picker needs both to tell rows apart.
 */
export interface StonkFunQuoteAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgramId: string;
  logoUrl: string | null;
  category: string;
  categoryLabel: string;
  /** StonkFun's own flag that this ticker is shared by several listed mints. */
  symbolAmbiguous: boolean;
  verification: StonkFunQuoteVerification;
}

/**
 * Reward-mode transfer fee baked into the base mint at creation.
 *
 * @property basisPoints - Holder tax on every transfer, from StonkFun's published rates
 * @property maximumFee - Per-transfer cap in raw base units (StonkFun's builder uses the full supply)
 * @property withdrawWithheldAuthority - StonkFun's authority that collects and distributes the tax
 */
export interface StonkFunRewardTransferFee {
  basisPoints: number;
  maximumFee: string;
  withdrawWithheldAuthority: string;
}

/**
 * Server-resolved StonkFun creation terms persisted with a draft.
 *
 * Every transaction-relevant value comes from StonkFun's pricing response
 * cross-checked against the on-chain global and platform configs. The raise is
 * locked when the quote is saved; only an explicit refresh replaces it.
 */
export interface StonkFunLaunchTerms {
  quote: StonkFunQuoteAsset;
  /**
   * `standard`: untaxed mint on StonkFun's standard platform. `reward`: a
   * Token-2022 mint with an immutable transfer fee on StonkFun's reward
   * platform; the fee is paid to holders by StonkFun.
   */
  mode: 'standard' | 'reward';
  /** Present only in reward mode; mirrored into `curve.transferFee` for the math. */
  transferFee?: StonkFunRewardTransferFee;
  /** Reward tax rates StonkFun published when these terms were resolved, in basis points; absent on drafts saved before reward mode existed. */
  rewardTaxBpsOptions?: number[];
  programId: string;
  /** LaunchLab GlobalConfig for this quote mint. */
  configId: string;
  /** StonkFun platform config attributed by the create instruction. */
  platformId: string;
  /** Platform curve-rule account appended last (read-only) to the create instruction. */
  curveRuleId: string;
  baseDecimals: number;
  cpmmCreatorFeeOn: number;
  curve: LaunchLabCurveTerms;
  /** Virtual reserves derived from `curve`, re-checked against the built pool. */
  virtualBase: string;
  virtualQuote: string;
  /** Smallest raise the global config accepts, in quote atomic units. */
  minimumRaiseRaw: string;
  /** StonkFun's price observation the raise was sized from. */
  pricing: {
    observedAt: string;
    quoteUsd: number | null;
    solUsd: number | null;
    startMarketCapUsd: number | null;
    graduationMarketCapUsd: number | null;
  };
  /** When SUMO resolved and verified these terms. */
  resolvedAt: string;
}
