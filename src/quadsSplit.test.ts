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

  it('keeps an exact multiple of 4 as even groups of 4, no leftover', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 8 }, (_, i) => 1600 - i * 10)));
    expect(groups.map((g) => g.players.length)).toEqual([4, 4]);
    expect(groups.every((g) => !g.isLeftover)).toBe(true);
  });

  it('sorts within and across groups by rating, highest first, so Quad 1 is the top group', () => {
    const groups = splitIntoQuads(roster([1200, 1800, 1000, 1600, 1400, 900, 1100, 1700]));
    const flat = groups.flatMap((g) => g.players).map((p) => p.rating);
    expect(flat).toEqual([...flat].sort((a, b) => (b ?? -1) - (a ?? -1)));
  });

  it('never produces a standalone Swiss-of-2-style group: a remainder of 1 or 2 always merges into the last quad', () => {
    for (let n = 4; n <= 60; n++) {
      const groups = splitIntoQuads(roster(Array.from({ length: n }, (_, i) => 2000 - i)));
      const remainder = n % 4;
      if (remainder === 1 || remainder === 2) {
        expect(groups.every((g) => !g.isLeftover)).toBe(true);
        expect(groups[groups.length - 1].players.length).toBe(4 + remainder);
      }
    }
  });

  it('a remainder of exactly 3 becomes its own standalone leftover round-robin group', () => {
    for (let n = 7; n <= 60; n += 4) { // n % 4 === 3 for every step here
      const groups = splitIntoQuads(roster(Array.from({ length: n }, (_, i) => 2000 - i)));
      const leftovers = groups.filter((g) => g.isLeftover);
      expect(leftovers).toHaveLength(1);
      expect(leftovers[0].players.length).toBe(3);
    }
  });

  it('every non-leftover group is exactly 4, except the last quad when it absorbed a 1-2 remainder', () => {
    for (let n = 4; n <= 60; n++) {
      const groups = splitIntoQuads(roster(Array.from({ length: n }, (_, i) => 2000 - i)));
      const quads = groups.filter((g) => !g.isLeftover);
      quads.slice(0, -1).forEach((q) => expect(q.players.length).toBe(4));
      if (quads.length) expect(quads[quads.length - 1].players.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('matches the reported real-world case: 22 players -> five quads, the last grown to 6, no standalone leftover at all', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 22 }, (_, i) => 2000 - i * 10)));
    expect(groups.map((g) => [g.players.length, g.isLeftover])).toEqual([
      [4, false], [4, false], [4, false], [4, false], [6, false],
    ]);
  });

  it('a roster too small for even one quad is just one leftover group of everyone', () => {
    const groups = splitIntoQuads(roster([1500, 1400, 1300]));
    expect(groups).toHaveLength(1);
    expect(groups[0].players).toHaveLength(3);
    expect(groups[0].isLeftover).toBe(true);
  });

  it('unrated players sort to the bottom, landing in the lowest-rated group', () => {
    const groups = splitIntoQuads(roster([1500, 1400, null, 1300, 1200, null, 1100, 1000]));
    const last = groups[groups.length - 1];
    expect(last.players.some((p) => p.rating == null)).toBe(true);
  });

  it('every player appears in exactly one group', () => {
    const r = roster(Array.from({ length: 23 }, (_, i) => 2200 - i * 7));
    const groups = splitIntoQuads(r);
    const names = groups.flatMap((g) => g.players.map((p) => p.name)).sort();
    expect(names).toEqual(r.map((p) => p.name).sort());
  });
});
