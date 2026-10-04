import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import data from './data/openings.json';
import { CATALOG } from './openingCatalog';
import { loadBook, nameAt, buildLines, practiceSans } from './openingBook';
import type { RawEntry, TrainerLine } from './openingBook';

const RAW: RawEntry[] = [
  ['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
  ['C50', 'Italian Game: Giuoco Pianissimo', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3'],
  ['C50', 'Italian Game: Giuoco Pianissimo, Normal Variation', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6'],
  ['C53', 'Italian Game: Classical Variation', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3'],
  ['C55', 'Italian Game: Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
  ['B20', 'Sicilian Defense', 'e4 c5'],
];
const book = loadBook(RAW);
const italian = CATALOG.find((o) => o.id === 'italian')!;

describe('nameAt', () => {
  it('returns the deepest named opening along the moves', () => {
    expect(nameAt(book, 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 h6'.split(' '))?.name).toBe('Italian Game: Giuoco Pianissimo');
  });
  it('is null for a position the book has never heard of', () => {
    expect(nameAt(book, ['a3', 'a6'])).toBeNull();
  });
});

describe('buildLines', () => {
  it('only uses entries under the opening root and folds sub-variations into their parent label', () => {
    const lines = buildLines(book, italian);
    expect(lines.map((l) => l.label).sort()).toEqual([
      'Italian Game',
      'Italian Game: Classical Variation',
      'Italian Game: Giuoco Pianissimo',
      'Italian Game: Two Knights Defense',
    ]);
    const pian = lines.find((l) => l.label === 'Italian Game: Giuoco Pianissimo')!;
    expect(pian.sans.join(' ')).toBe('e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6'); // deepest of the group
    expect(pian.theory).toBe(2);
    expect(pian.id).toBe('italian|Italian Game: Giuoco Pianissimo');
  });
  it('falls back to a single line at the root when the book has nothing under it', () => {
    const odd = { id: 'x', name: 'Odd', side: 'w' as const, root: 'a3 a6' };
    const lines = buildLines(book, odd);
    expect(lines).toHaveLength(1);
    expect(lines[0].sans).toEqual(['a3', 'a6']);
  });
});

describe('practiceSans', () => {
  const mk = (sans: string): TrainerLine => ({ id: 'a', openingId: 'o', label: 'a', eco: '', sans: sans.split(' '), theory: 1 });
  it('uses the whole line, capped at 12 full moves', () => {
    expect(practiceSans(mk('e4 e5 Nf3'))).toHaveLength(3);
    const long = Array.from({ length: 30 }, () => 'Nf3').join(' ');
    expect(practiceSans(mk(long))).toHaveLength(24);
  });
  it('buildLines pads short book lines with the stored engine extensions, up to 24 plies', () => {
    const op = { id: 'x', name: 'X', side: 'w' as const, root: 'e4 e5' };
    const b = loadBook([['C20', 'King\'s Pawn Game', 'e4 e5']]);
    const ext = ['Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7', 'Nbd2', 'Bb7', 'Bc2', 'Re8'];
    const [l] = buildLines(b, op, 12, { 'x|King\'s Pawn Game': { keep: 2, ext } });
    expect(l.sans).toHaveLength(24);
    expect(l.sans.slice(0, 3)).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('the real catalog against the real dataset', () => {
  const real = loadBook((data as any).entries as RawEntry[]);
  it('every opening root is a legal move sequence', () => {
    for (const o of CATALOG) {
      const c = new Chess();
      expect(() => o.root.split(' ').forEach((s) => c.move(s)), o.id).not.toThrow();
    }
  });
  it('every opening yields at least one trainable line, all of them legal from move 1', () => {
    for (const o of CATALOG) {
      const lines = buildLines(real, o);
      expect(lines.length, o.id).toBeGreaterThan(0);
      for (const l of lines) {
        const c = new Chess();
        expect(() => l.sans.forEach((s) => c.move(s)), `${o.id} ${l.label}`).not.toThrow();
      }
    }
  });
  it('catalog ids are unique', () => {
    expect(new Set(CATALOG.map((o) => o.id)).size).toBe(CATALOG.length);
  });
});
