/** Pure logic for splitting a roster into round-robin quad groups by rating — no DOM, no
 *  localStorage I/O. src/quadsPairings.ts owns persistence and UI. */
import type { RosterEntry } from './swissEngine';

/** One resulting group from splitIntoQuads. Every quad is always exactly 4 players — never grown
 *  to a quint or shrunk to a triple to absorb a remainder. `isLeftover` marks the one trailing
 *  group (0-3 players) that didn't fit into a full quad; it plays Swiss instead of round-robin
 *  (src/quadsPairings.ts), since it isn't a quad either. */
export interface QuadGroup {
  players: RosterEntry[];
  isLeftover: boolean;
}

/**
 * Splits a roster into groups of exactly 4, sorted by rating (unrated last) so "Quad 1" is always
 * the top group. A quad is always exactly 4 players — floor(n/4) of them, taken from the top of
 * the field — and whatever doesn't divide evenly (0-3 players) rolls over into one separate
 * leftover group instead of stretching an existing quad to 5 or shrinking one to 3.
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
