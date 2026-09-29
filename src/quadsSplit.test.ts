import { describe, it, expect } from 'vitest';
import { splitIntoQuads } from './quadsSplit';
import type { RosterEntry } from './swissEngine';

function roster(ratings: (number | null)[]): RosterEntry[] {
  return ratings.map((rating, i) => ({ name: `Player ${i + 1}`, rating }));
}

describe('splitIntoQuads', () => {
  it('returns nothing for an empty roster', () => {
    expect(splitIntoQuads([])).toEqual([]);
  });

  it('keeps an exact multiple of 4 as even groups of 4', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 8 }, (_, i) => 1600 - i * 10)));
    expect(groups.map((g) => g.length)).toEqual([4, 4]);
  });

  it('sorts within and across groups by rating, highest first, so Quad 1 is the top group', () => {
    const groups = splitIntoQuads(roster([1200, 1800, 1000, 1600, 1400, 900, 1100, 1700]));
    const flat = groups.flat().map((p) => p.rating);
    expect(flat).toEqual([...flat].sort((a, b) => (b ?? -1) - (a ?? -1)));
    expect(Math.min(...groups[0].map((p) => p.rating!))).toBeGreaterThanOrEqual(
      Math.max(...groups[groups.length - 1].map((p) => p.rating!))
    );
  });

  it('never produces a group smaller than 3 for a field of 5 or more', () => {
    for (let n = 5; n <= 40; n++) {
      const groups = splitIntoQuads(roster(Array.from({ length: n }, (_, i) => 2000 - i)));
      for (const g of groups) expect(g.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('avoids one oversized group when the field could split into two near-4 groups (n=7 -> 3+4, not one group of 7)', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 7 }, (_, i) => 1500 - i * 10)));
    expect(groups.map((g) => g.length).sort()).toEqual([3, 4]);
  });

  it('puts a single leftover player in the bottom (lowest-rated) group as a quint', () => {
    // n=9 -> round(9/4)=2 groups; leftover goes to the last (lower-rated) group.
    const groups = splitIntoQuads(roster(Array.from({ length: 9 }, (_, i) => 1800 - i * 10)));
    expect(groups.map((g) => g.length)).toEqual([4, 5]);
  });

  it('unrated players sort to the bottom, landing in the lowest-rated group', () => {
    const groups = splitIntoQuads(roster([1500, 1400, null, 1300, 1200, null, 1100, 1000]));
    const last = groups[groups.length - 1];
    expect(last.some((p) => p.rating == null)).toBe(true);
  });

  it('every player appears in exactly one group', () => {
    const r = roster(Array.from({ length: 23 }, (_, i) => 2200 - i * 7));
    const groups = splitIntoQuads(r);
    const names = groups.flat().map((p) => p.name).sort();
    expect(names).toEqual(r.map((p) => p.name).sort());
  });
});
