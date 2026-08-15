import { describe, it, expect } from 'vitest';
import { buildRepertoireTree, compareGameToRepertoire, plyLabel } from './repertoire';
import { parseGame } from './pgn';

function movesFor(pgn: string) {
  return parseGame(pgn)!.moves;
}

describe('buildRepertoireTree: basic line', () => {
  it('builds a linear chain of nodes for a single line', () => {
    const tree = buildRepertoireTree('1. e4 e5 2. Nf3 Nc6');
    expect(tree.lineCount).toBe(1);
    expect(tree.nodeCount).toBe(4);
    expect(tree.leafCount).toBe(1);
    expect(tree.maxDepthPly).toBe(4);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0].san).toBe('e4');
  });

  it('merges two lines that share a prefix into one branch', () => {
    // Each line needs its own [Event] header — with no headers at all, the whole input is kept
    // as a single chunk (see splitRepertoireChunks's doc comment), which would concatenate these
    // into one illegal continuation instead of two separate lines.
    const pgn = '[Event "L1"]\n\n1. e4 e5 2. Nf3 Nc6\n\n[Event "L2"]\n\n1. e4 e5 2. Nf3 Nf6';
    const tree = buildRepertoireTree(pgn);
    expect(tree.lineCount).toBe(2);
    // e4, e5, Nf3 shared (3 nodes) + Nc6 + Nf6 (2 leaves) = 5 distinct nodes
    expect(tree.nodeCount).toBe(5);
    expect(tree.leafCount).toBe(2);
    const e4 = tree.root.children[0];
    const e5 = e4.children[0];
    const nf3 = e5.children[0];
    expect(nf3.children.map((c) => c.san).sort()).toEqual(['Nc6', 'Nf6']);
  });
});

describe('buildRepertoireTree: recursive variations (RAV)', () => {
  it('parses a bracketed variation as a sibling branch off the move it interrupts', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3) 2. Nf3';
    const tree = buildRepertoireTree(pgn);
    const e4 = tree.root.children[0];
    expect(e4.children.map((c) => c.san).sort()).toEqual(['c5', 'e5']);
    const mainE5 = e4.children.find((c) => c.san === 'e5')!;
    expect(mainE5.children[0].san).toBe('Nf3');
    const sicilianC5 = e4.children.find((c) => c.san === 'c5')!;
    expect(sicilianC5.children[0].san).toBe('Nf3');
  });

  it('handles nested (multi-level) variations', () => {
    // "(" branches an alternative to the move just played, off *that move's parent* — so
    // "(2... Nf6 3. Nxe5 (3. d4) d6)" branches Nf6 off Nf3 (Nc6's parent), and the inner "(3. d4)"
    // branches d4 off Nxe5's own parent (Nf6) too — d4 is an alternative to Nxe5 itself, i.e. a
    // sibling of Nxe5, not a child of it.
    const pgn = '1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5 (3. d4) d6)';
    const tree = buildRepertoireTree(pgn);
    expect(tree.warnings).toEqual([]);
    const e4 = tree.root.children[0];
    const e5 = e4.children[0];
    const nf3 = e5.children[0];
    expect(nf3.children.map((c) => c.san).sort()).toEqual(['Nc6', 'Nf6']);
    const nf6 = nf3.children.find((c) => c.san === 'Nf6')!;
    expect(nf6.children.map((c) => c.san).sort()).toEqual(['Nxe5', 'd4']);
    const nxe5 = nf6.children.find((c) => c.san === 'Nxe5')!;
    expect(nxe5.children.map((c) => c.san)).toEqual(['d6']);
  });
});

describe('buildRepertoireTree: multiple PGN-header games merged', () => {
  it('treats each [Event-delimited chunk as its own line, merging shared prefixes', () => {
    const pgn = [
      '[Event "Line 1"]\n\n1. e4 e5 2. Nf3',
      '[Event "Line 2"]\n\n1. e4 c5 2. Nf3',
    ].join('\n\n');
    const tree = buildRepertoireTree(pgn);
    expect(tree.lineCount).toBe(2);
    expect(tree.root.children[0].children.map((c) => c.san).sort()).toEqual(['c5', 'e5']);
  });
});

describe('buildRepertoireTree: malformed input', () => {
  it('skips an empty chunk without throwing', () => {
    const tree = buildRepertoireTree('');
    expect(tree.lineCount).toBe(0);
    expect(tree.nodeCount).toBe(0);
  });

  it('counts a chunk whose first move is illegal as skipped, with a warning', () => {
    const tree = buildRepertoireTree('1. e9 e5');
    expect(tree.skippedChunks).toBe(1);
    expect(tree.lineCount).toBe(0);
    expect(tree.warnings.length).toBeGreaterThan(0);
  });

  it('truncates a line at the first unrecognized move but keeps what parsed before it', () => {
    const tree = buildRepertoireTree('1. e4 e5 2. Zz9 Nc6');
    expect(tree.lineCount).toBe(1);
    expect(tree.truncatedLines).toBe(1);
    expect(tree.nodeCount).toBe(2); // e4, e5 only
    expect(tree.warnings.length).toBeGreaterThan(0);
  });
});

describe('compareGameToRepertoire', () => {
  it('marks every ply as "book" while the game follows a known line', () => {
    const tree = buildRepertoireTree('1. e4 e5 2. Nf3 Nc6');
    const moves = movesFor('[Event "e"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    const result = compareGameToRepertoire(moves, tree);
    expect(result.plies.every((p) => p.status === 'book')).toBe(true);
    expect(result.inRepertoireCount).toBe(4);
    expect(result.deviation).toBeNull();
  });

  it('flags the first move that contradicts a covered branch as a deviation', () => {
    const tree = buildRepertoireTree('1. e4 e5 (1... c5) 2. Nf3');
    const moves = movesFor('[Event "e"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 d5 *');
    const result = compareGameToRepertoire(moves, tree);
    expect(result.plies[0].status).toBe('book'); // e4 matches
    expect(result.plies[1].status).toBe('deviation'); // d5 isn't e5 or c5
    expect(result.deviation).toMatchObject({ ply: 2, san: 'd5', reason: 'deviation' });
  });

  it('flags continuing past the end of prepared theory as end-of-book, not a deviation', () => {
    const tree = buildRepertoireTree('1. e4 e5');
    const moves = movesFor('[Event "e"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *');
    const result = compareGameToRepertoire(moves, tree);
    expect(result.plies[2].status).toBe('end-of-book');
    expect(result.deviation?.reason).toBe('end-of-book');
  });

  it('marks everything after the first deviation as out-of-repertoire', () => {
    const tree = buildRepertoireTree('1. e4 e5 2. Nf3 Nc6');
    const moves = movesFor('[Event "e"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 c5 2. Nf3 Nc6 *');
    const result = compareGameToRepertoire(moves, tree);
    expect(result.outOfRepertoireCount).toBe(3); // c5, Nf3, Nc6 all after the c5 deviation
  });
});

describe('plyLabel', () => {
  it('formats White moves with a single dot, Black moves with an ellipsis', () => {
    expect(plyLabel(1, 'w', 'e4')).toBe('1.e4');
    expect(plyLabel(8, 'b', 'Nf6')).toBe('8...Nf6');
  });
});
