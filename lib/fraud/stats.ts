// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The statistics behind the anomaly detectors. Pure functions over plain numbers: these judge
 * how unusual a weight or a payout spread is, they never move money, so floats are fine here
 * (exact kilogram sums live in `kg.ts`).
 */

/** Scales the MAD so it estimates a standard deviation for roughly normal data. */
const MAD_SCALE = 1.4826;

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? Number.NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? Number.NaN) + upper) / 2;
}

export type OutlierVerdict = {
  readonly outlier: boolean;
  readonly median: number;
  /** `1.4826 × median(|x − median|)` of the history. */
  readonly scaledMad: number;
};

/**
 * Is `candidate` further than `k × scaledMAD` from the median of `history`? Robust: a few
 * wild past weights do not move the median or the MAD. A history whose MAD is 0 (the
 * overwhelming majority of weights identical) has no spread to measure against, so nothing is
 * called an outlier — that case is `identical_weight_repeat`'s job. The comparison is strict:
 * a weight exactly `k` scaled-MADs out is not flagged.
 */
export function weightOutlier(
  history: readonly number[],
  candidate: number,
  k: number,
): OutlierVerdict {
  const centre = median(history);
  const scaledMad = MAD_SCALE * median(history.map((w) => Math.abs(w - centre)));
  const outlier = scaledMad > 0 && Math.abs(candidate - centre) > k * scaledMad;
  return { outlier, median: centre, scaledMad };
}

/**
 * Gini coefficient of non-negative values: 0 = perfectly even, → 1 = one holder has it all.
 * `G = 2·Σ(i·xᵢ) / (n·Σx) − (n + 1)/n` over the ascending sort, 1-indexed. Empty or all-zero
 * input is 0 (nothing to be concentrated).
 */
export function gini(values: readonly number[]): number {
  const n = values.length;
  const total = values.reduce((sum, v) => sum + v, 0);
  if (n === 0 || total <= 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const weighted = sorted.reduce((sum, v, i) => sum + (i + 1) * v, 0);
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/**
 * In `weights` (already in capture order), the index at which each window of `n` consecutive
 * equal values ENDS. Equal means the same `numeric` text (`"2.500"`), so there is no float
 * comparison. A run of exactly `n` yields one index; a longer run yields one per extra repeat.
 */
export function identicalRunEnds(weights: readonly string[], n: number): number[] {
  const ends: number[] = [];
  for (let end = n - 1; end < weights.length; end += 1) {
    const window = weights.slice(end - n + 1, end + 1);
    if (window.every((w) => w === window[0])) {
      ends.push(end);
    }
  }
  return ends;
}
