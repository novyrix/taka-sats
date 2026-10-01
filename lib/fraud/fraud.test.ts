// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { satsBucket } from '@/lib/stats';
import { pointInRing, type Ring } from './geo';
import { exceedsTolerance, floorToBucket, fromMilli, percentOf, toMilli } from './kg';
import { gini, identicalRunEnds, median, weightOutlier } from './stats';

describe('kg — exact milli-kilogram arithmetic', () => {
  it('parses numeric text and numbers without float drift', () => {
    expect(toMilli('12.500')).toBe(12_500n);
    expect(toMilli('0')).toBe(0n);
    expect(toMilli('-0.250')).toBe(-250n);
    expect(toMilli(0.1) + toMilli(0.2)).toBe(toMilli(0.3)); // 0.1 + 0.2 !== 0.3 in floats
    expect(fromMilli(toMilli(0.1) + toMilli(0.2))).toBe('0.300');
  });

  it('rejects a 4th decimal and non-numbers', () => {
    expect(() => toMilli('1.2345')).toThrow(RangeError);
    expect(() => toMilli('abc')).toThrow(RangeError);
  });

  it('formats back to 3 decimals, negatives included', () => {
    expect(fromMilli(5n)).toBe('0.005');
    expect(fromMilli(-2_800n)).toBe('-2.800');
  });

  it('computes percentages in integers, rounding half away from zero, 0 for a zero base', () => {
    expect(percentOf(5_000n, 100_000n)).toBe('5.000');
    expect(percentOf(1n, 3n)).toBe('33.333');
    expect(percentOf(-2_000n, 3_000n)).toBe('-66.667');
    expect(percentOf(7n, 0n)).toBe('0.000');
  });

  it('treats a variance exactly at the tolerance as within it, one gram more as over', () => {
    expect(exceedsTolerance(5_000n, 100_000n, 5)).toBe(false);
    expect(exceedsTolerance(5_001n, 100_000n, 5)).toBe(true);
    expect(exceedsTolerance(-5_001n, 100_000n, 5)).toBe(true); // over-delivery counts too
    expect(exceedsTolerance(2_500n, 100_000n, 2.5)).toBe(false);
  });

  it('floors to a bucket', () => {
    expect(floorToBucket(12_345n, 0.5)).toBe(12_000n);
    expect(floorToBucket(499n, 0.5)).toBe(0n);
  });
});

describe('weightOutlier — median ± k × scaled MAD', () => {
  const history = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // median 5, MAD 2 → scaled 2.9652

  it('is robust: a wild past value does not move the verdict', () => {
    expect(median([1, 2, 3, 4, 1000])).toBe(3);
    expect(weightOutlier([...history, 1000], 6, 6).outlier).toBe(false);
  });

  it('flags just beyond k scaled MADs and not just inside', () => {
    const { scaledMad } = weightOutlier(history, 5, 6);
    expect(weightOutlier(history, 5 + 6 * scaledMad - 0.01, 6).outlier).toBe(false);
    expect(weightOutlier(history, 5 + 6 * scaledMad + 0.01, 6).outlier).toBe(true);
    expect(weightOutlier(history, 5 - 6 * scaledMad - 0.01, 6).outlier).toBe(true); // low side too
  });

  it('never flags against a history with no spread', () => {
    expect(weightOutlier([5, 5, 5, 5, 5, 5], 500, 6).outlier).toBe(false);
  });
});

describe('gini', () => {
  it('is 0 for an even spread and for nothing', () => {
    expect(gini([4, 4, 4, 4])).toBe(0);
    expect(gini([])).toBe(0);
    expect(gini([0, 0, 0])).toBe(0);
  });

  it('is high when one holder has almost everything', () => {
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 10);
    expect(gini([400, 400, 400, 400, 40_000])).toBeCloseTo(0.7615, 3);
  });
});

describe('identicalRunEnds', () => {
  it('needs a full window of N: N−1 equal weights is not a run, the Nth is', () => {
    expect(identicalRunEnds(['2.500', '2.500', '2.500'], 4)).toEqual([]);
    expect(identicalRunEnds(['2.500', '2.500', '2.500', '2.500'], 4)).toEqual([3]);
  });

  it('flags every further repeat and ignores a broken run', () => {
    expect(identicalRunEnds(['1', '1', '1', '1', '1'], 4)).toEqual([3, 4]);
    expect(identicalRunEnds(['1', '1', '2', '1', '1'], 4)).toEqual([]);
  });
});

describe('pointInRing — boundary counts as inside', () => {
  // A unit square, GeoJSON [lng, lat].
  const square: Ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  it('inside and outside', () => {
    expect(pointInRing(0.5, 0.5, square)).toBe(true);
    expect(pointInRing(1.5, 0.5, square)).toBe(false);
    expect(pointInRing(0.5, -0.0001, square)).toBe(false);
  });

  it('on an edge or a vertex is inside', () => {
    expect(pointInRing(0.5, 0, square)).toBe(true); // lng 0: the west edge
    expect(pointInRing(0, 0.5, square)).toBe(true); // lat 0: the south edge
    expect(pointInRing(1, 1, square)).toBe(true); // vertex
  });

  it('handles a concave polygon', () => {
    const l: Ring = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [0, 0],
    ];
    expect(pointInRing(1.5, 0.5, l)).toBe(true);
    expect(pointInRing(1.5, 1.5, l)).toBe(false); // in the notch
  });
});

describe('satsBucket', () => {
  it('reports the power-of-ten range', () => {
    expect(satsBucket(0)).toEqual({ min: 0, max: 1 });
    expect(satsBucket(4_200)).toEqual({ min: 1_000, max: 10_000 });
    expect(satsBucket(10_000)).toEqual({ min: 10_000, max: 100_000 });
  });
});
