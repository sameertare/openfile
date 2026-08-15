import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { ENDGAME_POSITIONS } from './endgamePositions';

describe('ENDGAME_POSITIONS', () => {
  it('every entry is a legal, loadable FEN with at most 7 pieces (tablebase-eligible)', () => {
    for (const pos of ENDGAME_POSITIONS) {
      const chess = new Chess();
      expect(() => chess.load(pos.fen)).not.toThrow();
      const pieceCount = chess.board().flat().filter(Boolean).length;
      expect(pieceCount).toBeLessThanOrEqual(7);
    }
  });

  it('every entry has a non-empty label', () => {
    for (const pos of ENDGAME_POSITIONS) {
      expect(pos.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate FENs', () => {
    const fens = ENDGAME_POSITIONS.map((p) => p.fen);
    expect(new Set(fens).size).toBe(fens.length);
  });
});
