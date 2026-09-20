/**
 * Token-2022 transfer-fee arithmetic, mirroring the SPL program exactly.
 *
 * A mint with the transfer-fee extension withholds a fee on every transfer:
 * `fee = min(ceil(amount * bps / 10_000), maximumFee)`, taken out of the amount
 * the recipient receives. LaunchLab and CPMM apply the same rule on the base
 * token's way out of a vault (buys) and into a vault (sells), so every launch
 * plan, quote and cleanup figure for a taxed mint has to be computed with these
 * functions rather than approximated.
 *
 * `calculatePreFeeAmount` and `calculateInverseTransferFee` are ports of
 * `TransferFee::calculate_pre_fee_amount` / `calculate_inverse_fee` from
 * `spl-token-2022`; the programs use the inverse when a caller fixes the net
 * amount (exact-out swaps).
 */

/** Transfer-fee terms in force for the current epoch. */
export interface Token2022TransferFee {
  /** Fee in basis points of the transferred amount (0-10_000). */
  basisPoints: number;
  /** Cap on the fee per transfer, in raw base units. */
  maximumFee: bigint;
}

/** Serializable form of {@link Token2022TransferFee} for persisted terms and HTTP. */
export interface Token2022TransferFeeTerms {
  basisPoints: number;
  maximumFee: string;
}

const ONE_IN_BASIS_POINTS = 10_000n;

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

/**
 * Parses persisted transfer-fee terms into arithmetic form.
 *
 * @param terms - Serialized terms, or undefined for an untaxed mint
 * @returns Fee terms, or undefined when the mint carries no fee
 * @throws Error when the basis points or cap are out of range
 */
export function parseToken2022TransferFee(
  terms: Token2022TransferFeeTerms | undefined,
): Token2022TransferFee | undefined {
  if (!terms) return undefined;
  if (
    !Number.isInteger(terms.basisPoints) ||
    terms.basisPoints < 0 ||
    terms.basisPoints > Number(ONE_IN_BASIS_POINTS)
  )
    throw new Error('Token-2022 transfer fee basis points out of range');
  const maximumFee = BigInt(terms.maximumFee);
  if (maximumFee < 0n) throw new Error('Token-2022 transfer fee cap out of range');
  return { basisPoints: terms.basisPoints, maximumFee };
}

/**
 * Fee withheld from a transfer of `amount` (SPL `calculate_fee`).
 *
 * @param amount - Gross amount debited from the sender, raw units
 * @param fee - Fee terms; undefined means no fee
 * @returns Fee withheld, raw units; zero for an untaxed mint or a zero amount
 *
 * @example
 * calculateTransferFee(1_000_000n, { basisPoints: 300, maximumFee: 10n ** 15n }); // 30_000n
 */
export function calculateTransferFee(
  amount: bigint,
  fee: Token2022TransferFee | undefined,
): bigint {
  if (!fee || fee.basisPoints === 0 || amount <= 0n) return 0n;
  const raw = ceilDiv(amount * BigInt(fee.basisPoints), ONE_IN_BASIS_POINTS);
  return raw > fee.maximumFee ? fee.maximumFee : raw;
}

/**
 * Amount the recipient keeps from a transfer of `amount`.
 *
 * @param amount - Gross amount debited from the sender
 * @param fee - Fee terms; undefined means no fee
 * @returns `amount` minus the withheld fee
 */
export function netOfTransferFee(amount: bigint, fee: Token2022TransferFee | undefined): bigint {
  return amount - calculateTransferFee(amount, fee);
}

/**
 * Smallest gross amount whose transfer delivers at least `postFeeAmount`
 * (SPL `calculate_pre_fee_amount`).
 *
 * @param postFeeAmount - Net amount the recipient must receive
 * @param fee - Fee terms; undefined means no fee
 * @returns Gross amount to debit from the sender
 *
 * @example
 * calculatePreFeeAmount(970_000n, { basisPoints: 300, maximumFee: 10n ** 15n }); // 1_000_000n
 */
export function calculatePreFeeAmount(
  postFeeAmount: bigint,
  fee: Token2022TransferFee | undefined,
): bigint {
  if (!fee || fee.basisPoints === 0) return postFeeAmount;
  if (postFeeAmount <= 0n) return 0n;
  const bps = BigInt(fee.basisPoints);
  if (bps === ONE_IN_BASIS_POINTS) return postFeeAmount + fee.maximumFee;
  const rawPreFee = ceilDiv(postFeeAmount * ONE_IN_BASIS_POINTS, ONE_IN_BASIS_POINTS - bps);
  return rawPreFee - postFeeAmount >= fee.maximumFee ? postFeeAmount + fee.maximumFee : rawPreFee;
}

/**
 * Fee the programs add on top of a fixed net amount (SPL `calculate_inverse_fee`).
 *
 * Exact-out swaps move `postFeeAmount + calculateInverseTransferFee(postFeeAmount)`
 * so that the recipient nets `postFeeAmount`.
 *
 * @param postFeeAmount - Net amount the recipient must receive
 * @param fee - Fee terms; undefined means no fee
 * @returns Fee charged on the gross transfer
 */
export function calculateInverseTransferFee(
  postFeeAmount: bigint,
  fee: Token2022TransferFee | undefined,
): bigint {
  return calculateTransferFee(calculatePreFeeAmount(postFeeAmount, fee), fee);
}

/**
 * Gross amount an exact-out swap moves so the recipient nets `postFeeAmount`.
 *
 * @param postFeeAmount - Net amount the recipient must receive
 * @param fee - Fee terms; undefined means no fee
 * @returns `postFeeAmount + calculateInverseTransferFee(postFeeAmount)`
 */
export function grossForNetTransfer(
  postFeeAmount: bigint,
  fee: Token2022TransferFee | undefined,
): bigint {
  return postFeeAmount + calculateInverseTransferFee(postFeeAmount, fee);
}
