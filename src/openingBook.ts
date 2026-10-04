/**
 * Turns the raw lichess opening list (src/data/openings.json, CC0) into trainable lines for a
 * curated catalog opening, and answers "what is this position called". Pure logic — no DOM, no
 * storage, no chess.js (everything here works on SAN arrays), so it's cheap to unit test.
 */
import type { CatalogOpening } from './openingCatalog';

export type RawEntry = [eco: string, name: string, sans: string];

export interface BookEntry { eco: string; name: string; sans: string[] }

export interface Book {
  entries: BookEntry[];
  /** "e4 e5 Nf3" -> opening name, for longest-prefix name lookups. */
  byKey: Map<string, { eco: string; name: string }>;
}

/** Stockfish's verified completion of a line: keep the first `keep` book plies, then play `ext`. */
export interface LineExtension { keep: number; ext: string[] }

export interface TrainerLine {
  /** Stable across sessions (progress is keyed on it): `${openingId}|${label}`. */
  id: string;
  openingId: string;
  /** e.g. "Italian Game: Giuoco Pianissimo". */
  label: string;
  eco: string;
  /** The full line — the deepest named variation under this label. */
  sans: string[];
  /** How many named lichess variations sit under this label — a rough theory-depth/popularity proxy. */
  theory: number;
}

export function loadBook(raw: RawEntry[]): Book {
  const entries: BookEntry[] = [];
  const byKey = new Map<string, { eco: string; name: string }>();
  for (const [eco, name, sans] of raw) {
    const arr = sans.split(' ');
    entries.push({ eco, name, sans: arr });
    byKey.set(sans, { eco, name });
  }
  return { entries, byKey };
}

/** The name of the deepest named opening that the given moves pass through (transpositions that
 *  reach a named position by a different move order aren't recognized — same limit as any
 *  move-sequence book). */
export function nameAt(book: Book, sans: string[]): { eco: string; name: string } | null {
  for (let k = sans.length; k >= 1; k--) {
    const hit = book.byKey.get(sans.slice(0, k).join(' '));
    if (hit) return hit;
  }
  return null;
}

function startsWith(arr: string[], prefix: string[]): boolean {
  if (arr.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (arr[i] !== prefix[i]) return false;
  return true;
}

const MAX_LINES = 12;

/** Every line is trained 12 full moves deep. */
export const LINE_PLIES = 24;

/** Lines for one catalog opening: every named variation under its root, one line per distinct
 *  "Family: Variation" label (the label is the name up to the first comma, so sub-sub-variations fold
 *  into their parent), represented by its deepest sequence. Most-developed variations first. */
export function buildLines(book: Book, opening: CatalogOpening, maxLines = MAX_LINES, extensions: Record<string, LineExtension> = {}): TrainerLine[] {
  const root = opening.root.split(' ');
  const under = book.entries.filter((e) => startsWith(e.sans, root));
  // Group by name up to the first comma; if that leaves an opening with only a couple of lines
  // (e.g. everything under "Sicilian Defense: Dragon Variation, ..."), keep one more comma-level
  // of the name so its sub-variations (Yugoslav Attack, Classical…) become separate lines.
  const labelAt = (name: string, depth: number) => name.split(',').slice(0, depth).join(',').trim();
  let depth = 1;
  let groups = groupBy(under, depth);
  while (groups.size < 4 && depth < 3) {
    const deeper = groupBy(under, depth + 1);
    if (deeper.size <= groups.size) break;
    depth++;
    groups = deeper;
  }
  function groupBy(entries: BookEntry[], d: number) {
    const m = new Map<string, { eco: string; best: string[]; count: number }>();
    for (const e of entries) {
      const label = labelAt(e.name, d);
      const g = m.get(label);
      if (!g) m.set(label, { eco: e.eco, best: e.sans, count: 1 });
      else {
        g.count++;
        if (e.sans.length > g.best.length) g.best = e.sans;
      }
    }
    return m;
  }
  const lines: TrainerLine[] = [...groups.entries()].map(([label, g]) => ({
    id: `${opening.id}|${label}`,
    openingId: opening.id,
    label,
    eco: g.eco,
    sans: g.best,
    theory: g.count,
  }));
  lines.sort((a, b) => b.theory - a.theory || b.sans.length - a.sans.length || a.label.localeCompare(b.label));
  const top = lines.slice(0, maxLines);
  // Lines are completed to 12 moves (and any unsound book move on the trained side replaced) with engine moves (scripts/extend-lines.ts).
  for (const l of top) {
    const ext = extensions[l.id];
    if (ext) l.sans = [...l.sans.slice(0, ext.keep), ...ext.ext].slice(0, LINE_PLIES);
  }
  // An opening whose root isn't a named position in the data still needs one trainable line.
  if (!top.length) top.push({ id: `${opening.id}|${opening.name}`, openingId: opening.id, label: opening.name, eco: '', sans: root, theory: 0 });
  return top;
}

/** How much of a line to practice: all of it, capped at 12 full moves. */
export function practiceSans(line: TrainerLine): string[] {
  return line.sans.slice(0, LINE_PLIES);
}
