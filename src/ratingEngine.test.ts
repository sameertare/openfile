import { describe, it, expect } from 'vitest';
import { estimateRating, type RatingEstimateInput } from './ratingEngine';

function baseInput(over: Partial<RatingEstimateInput> = {}): RatingEstimateInput {
  return {
    currentRating: 1500,
    totalScore: 3,
    priorGames: 30, // established, standard formula by default
    opponentRatings: [1400, 1500, 1600, 1500, 1450],
    useDualRatedLowerK: false,
    ...over,
  };
}

describe('estimateRating: input validation', () => {
  it('rejects a current rating outside [100, 3200]', () => {
    expect(estimateRating(baseInput({ currentRating: 50 })).ok).toBe(false);
    expect(estimateRating(baseInput({ currentRating: 3300 })).ok).toBe(false);
  });

  it('accepts a current rating up to 3200 — regression guard for the old 2700 hard clamp', () => {
    const out = estimateRating(baseInput({ currentRating: 3100, opponentRatings: [3000, 3050], totalScore: 1 }));
    expect(out.ok).toBe(true);
  });

  it('rejects negative prior games', () => {
    expect(estimateRating(baseInput({ priorGames: -1 })).ok).toBe(false);
  });

  it('requires at least one opponent rating and at most 15', () => {
    expect(estimateRating(baseInput({ opponentRatings: [] })).ok).toBe(false);
    expect(estimateRating(baseInput({ opponentRatings: Array(16).fill(1500), totalScore: 8 })).ok).toBe(false);
  });

  it('rejects an opponent rating outside [100, 3200]', () => {
    expect(estimateRating(baseInput({ opponentRatings: [1500, 3300] })).ok).toBe(false);
  });

  it('rejects a total score outside [0, gamesCounted]', () => {
    expect(estimateRating(baseInput({ totalScore: -1 })).ok).toBe(false);
    expect(estimateRating(baseInput({ totalScore: 6 })).ok).toBe(false); // 5 opponents entered
  });
});

describe('estimateRating: outcome direction', () => {
  it('raises the rating for a positive score against similarly-rated opponents', () => {
    const out = estimateRating(baseInput({ totalScore: 4 })); // 4/5 against ~1500 average
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.ratingChange).toBeGreaterThan(0);
  });

  it('lowers the rating for a poor score against similarly-rated opponents', () => {
    const out = estimateRating(baseInput({ totalScore: 1 })); // 1/5
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.ratingChange).toBeLessThan(0);
  });

  it('leaves the rating roughly flat for an exactly-expected score against equal opposition', () => {
    const out = estimateRating(baseInput({ currentRating: 1500, opponentRatings: [1500, 1500], totalScore: 1 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(Math.abs(out.result.ratingChange)).toBeLessThanOrEqual(1);
  });

  it('clamps the resulting rating within [100, 3200]', () => {
    const out = estimateRating(baseInput({ currentRating: 150, opponentRatings: [1000, 1000, 1000], totalScore: 0, priorGames: 30 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.newRating).toBeGreaterThanOrEqual(100);
  });
});

describe('estimateRating: special (provisional) formula for <= 8 prior games', () => {
  it('uses the special-formula note and produces a result', () => {
    const out = estimateRating(baseInput({ priorGames: 3 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.notes.some((n) => /special.*provisional/i.test(n))).toBe(true);
  });

  it('reports the player as not established under 26 prior games', () => {
    const out = estimateRating(baseInput({ priorGames: 3 }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.established).toBe(false);
      expect(out.result.notes.some((n) => /not yet "established"/.test(n))).toBe(true);
    }
  });
});

describe('estimateRating: standard formula and bonus provision', () => {
  it('reports established=true at 26+ prior games', () => {
    const out = estimateRating(baseInput({ priorGames: 26 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.established).toBe(true);
  });

  it('applies the bonus provision only when scoring well above expectation with >= 3 games', () => {
    const bigOverperformance = estimateRating(
      baseInput({ currentRating: 1200, opponentRatings: [1600, 1650, 1600, 1650], totalScore: 4, priorGames: 30 })
    );
    expect(bigOverperformance.ok).toBe(true);
    if (bigOverperformance.ok) expect(bigOverperformance.result.bonus).toBeGreaterThan(0);
  });

  it('skips the bonus provision below 3 games in the event', () => {
    const out = estimateRating(baseInput({ opponentRatings: [1700, 1750], totalScore: 2, priorGames: 30 }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.bonus).toBe(0);
      expect(out.result.notes.some((n) => /Bonus provision requires/.test(n))).toBe(true);
    }
  });

  it('applies the dual-rated lower-K formula only above 2200', () => {
    const below = estimateRating(baseInput({ currentRating: 2000, useDualRatedLowerK: true, opponentRatings: [1900, 1950], totalScore: 1, priorGames: 30 }));
    expect(below.ok).toBe(true);
    if (below.ok) expect(below.result.notes.some((n) => /only applies above 2200/.test(n))).toBe(true);

    const above = estimateRating(baseInput({ currentRating: 2300, useDualRatedLowerK: true, opponentRatings: [2250, 2280], totalScore: 1, priorGames: 30 }));
    expect(above.ok).toBe(true);
    if (above.ok) expect(above.result.notes.some((n) => /Dual-rated K applied/.test(n))).toBe(true);
  });
});

describe('estimateRating: performance rating', () => {
  it('is average opponent + 400 for a perfect score', () => {
    const out = estimateRating(baseInput({ opponentRatings: [1500, 1600], totalScore: 2 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.performanceRating).toBe(1550 + 400);
  });

  it('is average opponent - 400 for a shutout loss', () => {
    const out = estimateRating(baseInput({ opponentRatings: [1500, 1600], totalScore: 0 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.performanceRating).toBe(1550 - 400);
  });
});
