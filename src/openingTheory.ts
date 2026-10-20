/** Opening-book boundary detection for Performance Analysis.
 *
 * "Theory" here means the bundled Lichess opening-name dataset: 3,864 named move sequences.
 * Leaving that reference is not automatically a mistake; Stockfish evaluates the departure
 * separately in analyze.ts. Sequence matching intentionally does not guess at transpositions.
 */
import data from './data/openings.json';
import type { Color } from './types';
import type { RawEntry } from './openingBook';

export interface TheoryTrace {
  bookName: string;
  eco: string;
  status: 'departed' | 'book-to-end' | 'unrecognized';
  knownPlies: number;
  departurePly: number | null;
  departureMoveNo: number | null;
  departureColor: Color | null;
  departureBy: 'player' | 'opponent' | null;
  played: string | null;
}

const entries = (data as unknown as { entries: RawEntry[] }).entries;
const validPrefixes = new Set<string>();
const exactNames = new Map<string, { eco: string; name: string }>();

for (const [eco, name, line] of entries) {
  const sans = line.split(' ');
  for (let i = 1; i <= sans.length; i++) validPrefixes.add(sans.slice(0, i).join(' '));
  exactNames.set(line, { eco, name });
}

function deepestName(sans: string[]): { eco: string; name: string } | null {
  for (let i = sans.length; i >= 1; i--) {
    const hit = exactNames.get(sans.slice(0, i).join(' '));
    if (hit) return hit;
  }
  return null;
}

export function traceOpeningTheory(
  sans: string[],
  userColor: Color,
  fallback: { opening: string; eco: string }
): TheoryTrace {
  let knownPlies = 0;
  let departurePly: number | null = null;
  for (let i = 0; i < sans.length; i++) {
    if (!validPrefixes.has(sans.slice(0, i + 1).join(' '))) {
      departurePly = i;
      break;
    }
    knownPlies = i + 1;
  }

  const named = deepestName(sans.slice(0, knownPlies));
  const departureColor: Color | null = departurePly === null ? null : departurePly % 2 === 0 ? 'w' : 'b';
  return {
    bookName: named?.name ?? fallback.opening,
    eco: named?.eco ?? fallback.eco,
    status: departurePly === null ? 'book-to-end' : knownPlies === 0 ? 'unrecognized' : 'departed',
    knownPlies,
    departurePly,
    departureMoveNo: departurePly === null ? null : Math.floor(departurePly / 2) + 1,
    departureColor,
    departureBy: departureColor === null ? null : departureColor === userColor ? 'player' : 'opponent',
    played: departurePly === null ? null : sans[departurePly],
  };
}

/** Position to ask Stockfish about: before the player's first non-book move; after the opponent's
 *  first non-book move (so the recommendation is the player's reply); or the end of the played
 *  book line when nobody departed. Values are ply counts and therefore index the FEN array. */
export function theoryLineStartPly(trace: TheoryTrace, gamePlies: number): number {
  if (trace.departurePly === null) return Math.min(trace.knownPlies, gamePlies);
  return Math.min(
    trace.departurePly + (trace.departureBy === 'opponent' ? 1 : 0),
    gamePlies
  );
}

export function moveLabel(moveNo: number, color: Color, san: string): string {
  return color === 'w' ? `${moveNo}.${san}` : `${moveNo}...${san}`;
}
