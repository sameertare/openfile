/** Pure logic for splitting a roster into round-robin quad groups by rating — no DOM, no
 *  localStorage I/O. src/quadsPairings.ts owns persistence and UI. */
import type { RosterEntry } from './swissEngine';

/** One resulting group from splitIntoQuads. `isLeftover` marks a group that isn't a real quad:
 *  either a standalone remainder of exactly 3 (a legitimate 3-round round-robin on its own — no
 *  real quad to merge it into cleanly) or, in the degenerate case, the whole roster when there
 *  aren't even 4 players to begin with. Every group plays round-robin; there's no Swiss section
 *  anywhere in Quads Pairings — a "Swiss section" of 1-2 players isn't a real tournament format
 *  (Swiss needs a real field to make pairing decisions over), so a remainder that small is merged
 *  into the last quad instead of ever standing alone. */
export interface QuadGroup {
  players: RosterEntry[];
  isLeftover: boolean;
}

/**
 * Splits a roster into round-robin groups, sorted by rating (unrated last) so "Quad 1" is always
 * the top group. floor(n/4) groups of 4 are formed from the top of the field; how the remainder
 * (n % 4) is handled depends on its size:
 *   - 0: nothing left over.
 *   - 3: a real mini round-robin in its own right — kept as one standalone trailing group.
 *   - 1 or 2: too small to be any kind of standalone section (a "Swiss section" of 2 isn't a real
 *     tournament format), so it's merged into the last (lowest-rated) quad instead, growing that
 *     one quad to 5 or 6.
 * The only time a resulting group has fewer than 4 players is the degenerate case where the whole
 * roster is under 4 to begin with — there's no quad at all to merge into.
 */
export function splitIntoQuads(roster: RosterEntry[]): QuadGroup[] {
  if (!roster.length) return [];
  const sorted = [...roster].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  const n = sorted.length;
  const numQuads = Math.floor(n / 4);
  if (numQuads === 0) return [{ players: sorted, isLeftover: true }];

  const remainder = n - numQuads * 4;
  const sizes = Array(numQuads).fill(4);
  if (remainder === 1 || remainder === 2) sizes[numQuads - 1] += remainder; // merge into the last quad

  const groups: QuadGroup[] = [];
  let idx = 0;
  for (const size of sizes) {
    groups.push({ players: sorted.slice(idx, idx + size), isLeftover: false });
    idx += size;
  }
  if (remainder === 3) groups.push({ players: sorted.slice(idx), isLeftover: true }); // standalone leftover of 3
  return groups;
}
