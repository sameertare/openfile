/** Pure logic for splitting a roster into round-robin quad groups by rating — no DOM, no
 *  localStorage I/O. src/quadsPairings.ts owns persistence and UI. */
import type { RosterEntry } from './swissEngine';

/** One resulting group from splitIntoQuads — always exactly 4 players, except possibly the very
 *  last group when the roster doesn't divide evenly by 4 (that one is 1-3). Both are round-robin:
 *  a leftover of 1-3 is too small for Swiss to make sense (with only 2 players, Swiss has no one
 *  else to pair against and would force the same rematch every round; round-robin just has them
 *  play once, or has 3 players play a natural 3-round no-repeat schedule with a bye each round). */
export interface QuadGroup {
  players: RosterEntry[];
  isLeftover: boolean;
}

/**
 * Splits a roster into groups of exactly 4, sorted by rating (unrated last) so "Quad 1" is always
 * the top group. A quad is a fixed, named format — exactly 4 players — so a group is never bumped
 * up to 5 or down to 3 to absorb a remainder: floor(n/4) groups of 4 are formed from the top of
 * the field, and whatever's left over (0-3 players) becomes one final round-robin group of its
 * own instead of being folded into an adjacent quad (which would make that quad not actually 4
 * players either).
 */
export function splitIntoQuads(roster: RosterEntry[]): QuadGroup[] {
  if (!roster.length) return [];
  const sorted = [...roster].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  const n = sorted.length;
  const numQuads = Math.floor(n / 4);
  const groups: QuadGroup[] = [];
  for (let i = 0; i < numQuads; i++) {
    groups.push({ players: sorted.slice(i * 4, i * 4 + 4), isLeftover: false });
  }
  const leftover = sorted.slice(numQuads * 4);
  if (leftover.length) groups.push({ players: leftover, isLeftover: true });
  return groups;
}
