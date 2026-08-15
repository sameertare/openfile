import { describe, it, expect } from 'vitest';
import {
  buildTree,
  childSummaries,
  nodeAtPath,
  positionKey,
  scorePct,
  avgOpponentRating,
  performanceRating,
  MAX_TREE_PLY,
  type TreeGame,
} from './openingTree';

function tg(over: Partial<TreeGame> = {}): TreeGame {
  return {
    sans: ['e4', 'e5', 'Nf3'],
    result: 'win',
    opponent: 'Bob',
    opponentRating: 1500,
    link: null,
    date: '2026-01-01',
    ...over,
  };
}

describe('positionKey', () => {
  it('drops the halfmove clock and fullmove number', () => {
    const a = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const b = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 12';
    expect(positionKey(a)).toBe(positionKey(b));
  });
  it('treats a different side-to-move as a different key', () => {
    const a = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const b = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    expect(positionKey(a)).not.toBe(positionKey(b));
  });
});

describe('buildTree: basic tallying', () => {
  it('tallies root and per-move W/D/L across games', () => {
    const games = [tg({ result: 'win' }), tg({ result: 'loss' }), tg({ result: 'draw' })];
    const tree = buildTree(games);
    expect(tree.root.games).toBe(3);
    expect(tree.root.wins).toBe(1);
    expect(tree.root.losses).toBe(1);
    expect(tree.root.draws).toBe(1);
  });

  it('skips games with an unknown result entirely', () => {
    const games = [tg({ result: 'win' }), tg({ result: 'unknown' as any })];
    const tree = buildTree(games);
    expect(tree.root.games).toBe(1);
  });

  it('builds a child node per move with a SAN edge from its parent', () => {
    const tree = buildTree([tg({ sans: ['e4', 'e5'] })]);
    expect(tree.root.children.get('e4')).toBeDefined();
    const afterE4 = tree.positions.get(tree.root.children.get('e4')!)!;
    expect(afterE4.games).toBe(1);
    expect(afterE4.children.get('e5')).toBeDefined();
  });

  it('caps walked depth at maxPly, ignoring moves beyond it', () => {
    const longGame = tg({ sans: Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 'Nf3' : 'Nf6')) });
    // Not all of these are legal in sequence (repeated knight shuffles are), but to keep it simple
    // just check the tree never exceeds the ply cap in node depth.
    const tree = buildTree([tg({ sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] })], 4);
    let node = tree.root;
    let depth = 0;
    const path = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
    for (const san of path) {
      const key = node.children.get(san);
      if (!key) break;
      node = tree.positions.get(key)!;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(4);
    void longGame; // (kept only to document intent; not used further)
  });
});

describe('buildTree: transposition merging', () => {
  it('merges two games reaching the same position via different move orders into one node', () => {
    // 1.e4 e5 2.Nf3 vs 1.Nf3 e5 2.e4 both reach the same position (Nf3+e4 played, Black e5), just
    // via a different move order.
    const games = [
      tg({ sans: ['e4', 'e5', 'Nf3'], result: 'win' }),
      tg({ sans: ['Nf3', 'e5', 'e4'], result: 'loss' }),
    ];
    const tree = buildTree(games);
    const viaE4First = nodeAtPath(tree, ['e4', 'e5', 'Nf3'])!;
    const viaNf3First = nodeAtPath(tree, ['Nf3', 'e5', 'e4'])!;
    expect(viaE4First).toBe(viaNf3First); // same merged node object
    expect(viaE4First.games).toBe(2);
    expect(viaE4First.wins).toBe(1);
    expect(viaE4First.losses).toBe(1);
  });
});

describe('buildTree: gameRefs and ratings', () => {
  it('attaches a GameRef to every node the game passed through', () => {
    const tree = buildTree([tg({ sans: ['e4', 'e5'], opponent: 'Carol' })]);
    expect(tree.root.gameRefs).toHaveLength(1);
    expect(tree.root.gameRefs[0].opponent).toBe('Carol');
    const afterE4 = nodeAtPath(tree, ['e4'])!;
    expect(afterE4.gameRefs).toHaveLength(1);
  });

  it('computes average opponent rating only from games with a known rating', () => {
    const tree = buildTree([
      tg({ sans: ['e4'], opponentRating: 1600 }),
      tg({ sans: ['e4'], opponentRating: null }),
      tg({ sans: ['e4'], opponentRating: 1400 }),
    ]);
    const afterE4 = nodeAtPath(tree, ['e4'])!;
    expect(avgOpponentRating(afterE4)).toBe(1500);
  });

  it('returns null average/performance rating when no game had a known rating', () => {
    const tree = buildTree([tg({ sans: ['e4'], opponentRating: null })]);
    const afterE4 = nodeAtPath(tree, ['e4'])!;
    expect(avgOpponentRating(afterE4)).toBeNull();
    expect(performanceRating(afterE4)).toBeNull();
  });
});

describe('performanceRating', () => {
  it('is avg opponent + 400 for a perfect score, - 400 for a shutout', () => {
    const perfect = buildTree([tg({ sans: ['e4'], result: 'win', opponentRating: 1500 })]);
    const shutout = buildTree([tg({ sans: ['e4'], result: 'loss', opponentRating: 1500 })]);
    expect(performanceRating(nodeAtPath(perfect, ['e4'])!)).toBe(1900);
    expect(performanceRating(nodeAtPath(shutout, ['e4'])!)).toBe(1100);
  });
});

describe('scorePct', () => {
  it('computes (wins + 0.5*draws)/games as a percentage', () => {
    const tree = buildTree([
      tg({ sans: ['e4'], result: 'win' }),
      tg({ sans: ['e4'], result: 'draw' }),
    ]);
    expect(scorePct(nodeAtPath(tree, ['e4'])!)).toBe(75);
  });
  it('is 0 for a node with no games', () => {
    const tree = buildTree([]);
    expect(scorePct(tree.root)).toBe(0);
  });
});

describe('childSummaries', () => {
  it('sorts by games played, most-common first', () => {
    const games = [
      tg({ sans: ['e4'], result: 'win' }),
      tg({ sans: ['e4'], result: 'win' }),
      tg({ sans: ['d4'], result: 'win' }),
    ];
    const tree = buildTree(games);
    const summaries = childSummaries(tree, tree.root);
    expect(summaries.map((s) => s.san)).toEqual(['e4', 'd4']);
    expect(summaries[0].games).toBe(2);
  });

  it('reflects merged (transposition-aware) stats for a child reached elsewhere too', () => {
    const games = [
      tg({ sans: ['e4', 'e5', 'Nf3'], result: 'win' }),
      tg({ sans: ['Nf3', 'e5', 'e4'], result: 'loss' }),
    ];
    const tree = buildTree(games);
    const afterE4 = nodeAtPath(tree, ['e4'])!;
    const summaries = childSummaries(tree, afterE4);
    const e5Summary = summaries.find((s) => s.san === 'e5')!;
    expect(e5Summary.games).toBe(1); // only the e4-first game passed through "e4 then e5"
  });
});

describe('nodeAtPath', () => {
  it('returns null for a path not present in the tree', () => {
    const tree = buildTree([tg({ sans: ['e4'] })]);
    expect(nodeAtPath(tree, ['d4'])).toBeNull();
  });

  it('returns the root for an empty path', () => {
    const tree = buildTree([tg({ sans: ['e4'] })]);
    expect(nodeAtPath(tree, [])).toBe(tree.root);
  });
});

describe('MAX_TREE_PLY', () => {
  it('is 24 (12 full moves), the opening-phase depth cap', () => {
    expect(MAX_TREE_PLY).toBe(24);
  });
});
