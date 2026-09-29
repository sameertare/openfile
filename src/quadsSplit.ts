/** Pure logic for splitting a roster into round-robin quad groups by rating — no DOM, no
 *  localStorage I/O. src/quadsPairings.ts owns persistence and UI. */
import type { RosterEntry } from './swissEngine';

/**
 * Splits a roster into round-robin groups of (ideally) 4, sorted by rating (unrated last) so
 * "Quad 1" is always the top section. Uses round(n/4) rather than floor(n/4) as the group count —
 * floor keeps small remainders (n=7, n=14) bunched into one oversized group that needs far more
 * rounds than a normal 3-round quad event (a lone group of 7 needs 7 rounds); rounding to the
 * nearest multiple of 4 instead spreads the field into more, smaller groups (e.g. 7 -> a 3 and a 4,
 * both done in 3 rounds) that stay close to the standard quad size. Any leftover beyond an even
 * split lands on the last (lowest-rated) groups first, so a leftover single player makes the bottom
 * quad a quint (5) rather than a group of its own.
 */
export function splitIntoQuads(roster: RosterEntry[]): RosterEntry[][] {
  if (!roster.length) return [];
  const sorted = [...roster].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  const n = sorted.length;
  const numGroups = Math.max(1, Math.round(n / 4));
  const base = Math.floor(n / numGroups);
  let remainder = n - base * numGroups;
  const sizes = Array(numGroups).fill(base);
  for (let i = numGroups - 1; remainder > 0; i--, remainder--) sizes[i]++;
  const groups: RosterEntry[][] = [];
  let idx = 0;
  for (const size of sizes) {
    groups.push(sorted.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}
