import { describe, it, expect } from 'vitest';
import { estimateFideRating, type FideEstimateInput } from './fideRatingEngine';

function baseInput(over: Partial<FideEstimateInput> = {}): FideEstimateInput {
  return {
    currentRating: 2000,
    totalScore: 3,
    opponentRatings: [1900, 2000, 2100, 2000, 1950],
    ...over,
  };
}

describe('estimateFideRating: input validation', () => {
  it('rejects a current rating outside [100, 3000]', () => {
    expect(estimateFideRating(baseInput({ currentRating: 50 })).ok).toBe(false);
    expect(estimateFideRating(baseInput({ currentRating: 3100 })).ok).toBe(false);
  });

  it('requires at least one opponent, at most 15', () => {
    expect(estimateFideRating(baseInput({ opponentRatings: [] })).ok).toBe(false);
    expect(estimateFideRating(baseInput({ opponentRatings: Array(16).fill(2000), totalScore: 8 })).ok).toBe(false);
  });

  it('rejects a total score outside [0, gamesCounted]', () => {
    expect(estimateFideRating(baseInput({ totalScore: 6 })).ok).toBe(false);
    expect(estimateFideRating(baseInput({ totalScore: -1 })).ok).toBe(false);
  });
});

describe('estimateFideRating: K-factor tiers', () => {
  it('uses K=20 below 2400', () => {
    const out = estimateFideRating(baseInput({ currentRating: 2000 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.kFactor).toBe(20);
  });

  it('uses K=10 at or above 2400', () => {
    const out = estimateFideRating(baseInput({ currentRating: 2400, opponentRatings: [2300, 2350], totalScore: 1 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.kFactor).toBe(10);
  });
});

describe('estimateFideRating: ±400 rating-difference cap', () => {
  it('caps win expectancy against a much-lower-rated opponent below 2650', () => {
    // A 1000-rated opponent (900 below player rating) should compute the same expectancy as an
    // opponent exactly 400 below, since the cap kicks in.
    const cappedFar = estimateFideRating(baseInput({ currentRating: 2000, opponentRatings: [1000], totalScore: 1 }));
    const cappedAt400 = estimateFideRating(baseInput({ currentRating: 2000, opponentRatings: [1600], totalScore: 1 }));
    expect(cappedFar.ok && cappedAt400.ok).toBe(true);
    if (cappedFar.ok && cappedAt400.ok) {
      expect(cappedFar.result.winExpectancy).toBeCloseTo(cappedAt400.result.winExpectancy, 5);
    }
  });

  it('does not cap the difference for players rated 2650 or above', () => {
    const uncapped = estimateFideRating(baseInput({ currentRating: 2650, opponentRatings: [2000], totalScore: 1 }));
    const cappedEquivalent = estimateFideRating(baseInput({ currentRating: 2650, opponentRatings: [2250], totalScore: 1 }));
    expect(uncapped.ok && cappedEquivalent.ok).toBe(true);
    if (uncapped.ok && cappedEquivalent.ok) {
      // If the cap still applied at 2650+, both would compute an identical (capped) expectancy;
      // uncapped, the much-lower-rated opponent must give a strictly higher expectancy.
      expect(uncapped.result.winExpectancy).toBeGreaterThan(cappedEquivalent.result.winExpectancy);
    }
  });
});

describe('estimateFideRating: outcome direction and clamping', () => {
  it('raises the rating for scoring above 50% against equal opposition', () => {
    const out = estimateFideRating(baseInput({ currentRating: 2000, opponentRatings: [2000, 2000], totalScore: 2 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.ratingChange).toBeGreaterThan(0);
  });

  it('lowers the rating for scoring below 50% against equal opposition', () => {
    const out = estimateFideRating(baseInput({ currentRating: 2000, opponentRatings: [2000, 2000], totalScore: 0 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.ratingChange).toBeLessThan(0);
  });

  it('keeps ratingChange consistent with newRating - currentRating even when clamped', () => {
    const out = estimateFideRating(baseInput({ currentRating: 150, opponentRatings: [2900, 2900], totalScore: 0 }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.newRating).toBeGreaterThanOrEqual(100);
      expect(out.result.newRating - 150).toBe(out.result.ratingChange);
    }
  });

  it('notes when the resulting estimate falls below FIDE\'s 1400 publish floor', () => {
    const out = estimateFideRating(baseInput({ currentRating: 1300, opponentRatings: [1300, 1300], totalScore: 0 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.notes.some((n) => /does not publish Standard ratings below 1400/.test(n))).toBe(true);
  });
});

describe('estimateFideRating: performance rating', () => {
  it('is average opponent + 400 for a perfect score, - 400 for a shutout', () => {
    const perfect = estimateFideRating(baseInput({ opponentRatings: [1900, 2100], totalScore: 2 }));
    const shutout = estimateFideRating(baseInput({ opponentRatings: [1900, 2100], totalScore: 0 }));
    expect(perfect.ok && shutout.ok).toBe(true);
    if (perfect.ok && shutout.ok) {
      expect(perfect.result.performanceRating).toBe(2000 + 400);
      expect(shutout.result.performanceRating).toBe(2000 - 400);
    }
  });
});
