import { describe, expect, it } from 'vitest';
import { averageRiskTone } from './risk';

describe('average risk display color', () => {
  it.each([
    [0, 'low'],
    [0.9999, 'low'],
    [1, 'moderate'],
    [1.9999, 'moderate'],
    [2, 'high'],
    [2.9999, 'high'],
    [3, 'severe'],
    [3.9999, 'severe'],
    [4, 'no_travel'],
    [null, 'unknown'],
    [NaN, 'unknown'],
    [Infinity, 'unknown'],
    [-1, 'unknown'],
    [5, 'unknown'],
  ] as const)('uses the unrounded score %s for %s feedback', (score, tone) => {
    expect(averageRiskTone(score)).toBe(tone);
  });
});
