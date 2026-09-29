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

  it('keeps an exact multiple of 4 as even groups of 4, no leftover group', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 8 }, (_, i) => 1600 - i * 10)));
    expect(groups.map((g) => g.players.length)).toEqual([4, 4]);
    expect(groups.every((g) => !g.isLeftover)).toBe(true);
  });

  it('sorts within and across groups by rating, highest first, so Quad 1 is the top group', () => {
    const groups = splitIntoQuads(roster([1200, 1800, 1000, 1600, 1400, 900, 1100, 1700]));
    const flat = groups.flatMap((g) => g.players).map((p) => p.rating);
    expect(flat).toEqual([...flat].sort((a, b) => (b ?? -1) - (a ?? -1)));
    expect(Math.min(...groups[0].players.map((p) => p.rating!))).toBeGreaterThanOrEqual(
      Math.max(...groups[groups.length - 1].players.map((p) => p.rating!))
    );
  });

  it('every real quad is exactly 4 players — never bumped to 5 or shrunk to 3', () => {
    for (let n = 4; n <= 40; n++) {
      const groups = splitIntoQuads(roster(Array.from({ length: n }, (_, i) => 2000 - i)));
      const quads = groups.filter((g) => !g.isLeftover);
      for (const q of quads) expect(q.players.length).toBe(4);
    }
  });

  it('a leftover of 1-3 players becomes one trailing round-robin group, not folded into a quad', () => {
    // n=7 -> one quad of 4, one leftover group of 3.
    const groups = splitIntoQuads(roster(Array.from({ length: 7 }, (_, i) => 1500 - i * 10)));
    expect(groups.map((g) => [g.players.length, g.isLeftover])).toEqual([[4, false], [3, true]]);
  });

  it('a single leftover player becomes its own (degenerate, unplayable) group rather than a quint', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 9 }, (_, i) => 1800 - i * 10)));
    expect(groups.map((g) => [g.players.length, g.isLeftover])).toEqual([[4, false], [4, false], [1, true]]);
  });

  it('matches the reported real-world case: 22 players -> five quads of 4 + a 2-player leftover group', () => {
    const groups = splitIntoQuads(roster(Array.from({ length: 22 }, (_, i) => 2000 - i * 10)));
    expect(groups.map((g) => [g.players.length, g.isLeftover])).toEqual([
      [4, false], [4, false], [4, false], [4, false], [4, false], [2, true],
    ]);
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
