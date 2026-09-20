/**
 * One weighted participant competing for a share of an integer total.
 *
 * @property id - Stable identifier echoed back by callers that key results by id
 * @property weight - Non-negative balance driving the proportional share
 */
export interface ApportionmentSource {
  id: string;
  weight: bigint;
}

/**
 * Apportions an integer total across ranked sources in proportion to their weights.
 *
 * Shared by token cleanup planning (destination wallets per source) and launch
 * budgeting (holder buckets per bundle wallet) so reserves and plans agree.
 *
 * Shares follow the largest-remainder method over the full total, so a source
 * holding 80% of the weight receives roughly 80% of the total. Two repairs run
 * afterwards:
 *
 * 1. Every source above `maxPerSource` is clamped and its surplus re-apportioned
 *    across the uncapped sources by weight (repeated until nothing overflows).
 * 2. Every source left with zero receives one, taken from the most over-served
 *    source (the highest count-to-weight ratio), so counts stay monotone in weight.
 *
 * When every weight is zero, the total splits as evenly as possible in input
 * order. Ties on remainders resolve by input order so results are deterministic.
 *
 * @param input.sources - Sources ranked by descending weight (input order breaks ties)
 * @param input.total - Integer total to hand out; must be at least `sources.length`
 * @param input.maxPerSource - Optional per-source ceiling
 * @returns Counts aligned with `input.sources`; each is at least 1 and at most the cap
 *
 * @throws {Error} When `total` is below the source count, or `maxPerSource`
 *   cannot absorb the total
 *
 * @example
 * apportionCountsByWeight({
 *   sources: [{ id: 'a', weight: 800n }, { id: 'b', weight: 200n }],
 *   total: 10,
 * }); // [8, 2]
 */
export function apportionCountsByWeight(input: {
  sources: readonly ApportionmentSource[];
  total: number;
  maxPerSource?: number;
}): number[] {
  const sourceCount = input.sources.length;
  if (sourceCount === 0) return [];
  if (!Number.isInteger(input.total) || input.total < sourceCount) {
    throw new Error('Apportionment total must be an integer of at least the source count');
  }
  const maxPerSource = input.maxPerSource;
  if (maxPerSource !== undefined) {
    if (!Number.isInteger(maxPerSource) || maxPerSource < 1) {
      throw new Error('Apportionment cap must be a positive integer');
    }
    if (sourceCount * maxPerSource < input.total) {
      throw new Error(`Apportionment cap of ${maxPerSource} cannot absorb ${input.total}`);
    }
  }
  const weights = input.sources.map((source) => source.weight);
  for (const weight of weights) {
    if (weight < 0n) throw new Error('Apportionment weights must be non-negative');
  }

  const counts = largestRemainderShares(weights, input.total);
  if (maxPerSource !== undefined) spillOverflowAboveCap(counts, weights, maxPerSource);
  raiseZeroCountsToOne(counts, weights);
  return counts;
}

/**
 * Apportions launch holder buckets across cleanup source rows by sized token output.
 *
 * Mirrors the cleanup planner's destination mapping so per-wallet cleanup
 * reserves (`holderNative * buckets`) are budgeted for the holders each row will
 * actually feed. Rows are ranked internally by descending weight (then id) so
 * the result does not depend on row order, matching the planner's ranking.
 * Unlike the planner, budgeting must tolerate fewer holders than sources: zero
 * holders yields zero buckets everywhere, and fewer holders than sources falls
 * back to plain largest-remainder shares with no minimum of one per row.
 *
 * @param holderCount - Configured holder wallet count (fractions are floored)
 * @param sources - Cleanup source rows with their sized token output as weight
 * @returns Bucket count keyed by row id (every source row is present)
 *
 * @example
 * apportionHolderBuckets(30, [
 *   { id: 'a', weight: 10n }, { id: 'b', weight: 5n }, { id: 'c', weight: 2n },
 * ]); // Map { a => 18n, b => 9n, c => 3n }
 */
export function apportionHolderBuckets(
  holderCount: number,
  sources: readonly ApportionmentSource[],
): Map<string, bigint> {
  const total = Number.isFinite(holderCount) ? Math.floor(holderCount) : 0;
  if (sources.length === 0 || total <= 0) {
    return new Map(sources.map((source) => [source.id, 0n]));
  }
  const ranked = [...sources].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight > right.weight ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  const counts =
    total >= ranked.length
      ? apportionCountsByWeight({ sources: ranked, total })
      : largestRemainderShares(
          ranked.map((source) => source.weight),
          total,
        );
  return new Map(ranked.map((source, index) => [source.id, BigInt(counts[index] ?? 0)]));
}

/**
 * Splits `total` across `weights` with the largest-remainder method.
 * Falls back to an even floor/ceil split in input order when all weights are zero.
 */
function largestRemainderShares(weights: readonly bigint[], total: number): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) {
    const base = Math.floor(total / weights.length);
    const extra = total % weights.length;
    return weights.map((_weight, index) => base + (index < extra ? 1 : 0));
  }
  const scaledTotal = BigInt(total);
  const shares = weights.map((weight) => Number((scaledTotal * weight) / totalWeight));
  const remainders = weights.map((weight) => (scaledTotal * weight) % totalWeight);
  let leftover = total - shares.reduce((sum, share) => sum + share, 0);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((left, right) => {
      if (left.remainder === right.remainder) return left.index - right.index;
      return left.remainder > right.remainder ? -1 : 1;
    });
  for (const { index } of order) {
    if (leftover === 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    leftover -= 1;
  }
  return shares;
}

/**
 * Clamps sources above the cap and re-apportions the surplus across uncapped
 * sources by weight until nothing overflows. Mutates `counts` in place.
 *
 * Terminates within `counts.length` rounds: every round with surplus caps at
 * least one new index, and capped indices never receive spill.
 */
function spillOverflowAboveCap(
  counts: number[],
  weights: readonly bigint[],
  maxPerSource: number,
): void {
  const capped = new Set<number>();
  for (;;) {
    let surplus = 0;
    for (const [index, count] of counts.entries()) {
      if (count > maxPerSource) {
        surplus += count - maxPerSource;
        counts[index] = maxPerSource;
        capped.add(index);
      }
    }
    if (surplus === 0) return;
    const open = counts.map((_count, index) => index).filter((index) => !capped.has(index));
    // Unreachable behind the upfront `sourceCount * maxPerSource >= total` check:
    // once every index is capped the counts already sum to at least the total.
    if (open.length === 0) {
      throw new Error(`Apportionment cap of ${maxPerSource} cannot absorb the total`);
    }
    const extra = largestRemainderShares(
      open.map((index) => weights[index] ?? 0n),
      surplus,
    );
    for (const [position, index] of open.entries()) {
      counts[index] = (counts[index] ?? 0) + (extra[position] ?? 0);
    }
  }
}

/**
 * Gives every zero-count source one unit taken from the most over-served source.
 *
 * The donor is the source with the highest count-to-weight ratio (compared by
 * cross-multiplication to stay in bigint), ties resolved toward the later
 * index. Taking from the largest count instead would let a bigger holder end
 * up with fewer units than a smaller one. Mutates `counts` in place.
 */
function raiseZeroCountsToOne(counts: number[], weights: readonly bigint[]): void {
  for (const [index, count] of counts.entries()) {
    if (count > 0) continue;
    let donor = -1;
    for (const [candidate, candidateCount] of counts.entries()) {
      if (candidateCount <= 1) continue;
      if (
        donor === -1 ||
        isMoreOverServed(
          candidateCount,
          weights[candidate] ?? 0n,
          counts[donor] ?? 0,
          weights[donor] ?? 0n,
        )
      ) {
        donor = candidate;
      }
    }
    // Unreachable: the counts sum to at least the source count, so while a zero
    // exists some other source holds more than one.
    if (donor === -1) {
      throw new Error('Apportionment total must be an integer of at least the source count');
    }
    counts[donor] = (counts[donor] ?? 0) - 1;
    counts[index] = 1;
  }
}

/** True when `count / weight` is at least `otherCount / otherWeight` (zero weights rank highest). */
function isMoreOverServed(
  count: number,
  weight: bigint,
  otherCount: number,
  otherWeight: bigint,
): boolean {
  if (weight === 0n) return true;
  if (otherWeight === 0n) return false;
  return BigInt(count) * otherWeight >= BigInt(otherCount) * weight;
}
