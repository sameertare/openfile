import { describe, it, expect } from 'vitest';
import { whiteCp, fmtEval, uciToSan, pvToSans } from './engineFormat';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('whiteCp', () => {
  it('leaves the score unchanged when white is to move', () => {
    expect(whiteCp(START_FEN, 50)).toBe(50);
  });
  it('flips the sign when black is to move', () => {
    expect(whiteCp(BLACK_TO_MOVE_FEN, 50)).toBe(-50);
  });
});

describe('fmtEval', () => {
  it('formats a positive centipawn score with a leading + and 2 decimals', () => {
    expect(fmtEval(123, null, true)).toBe('+1.23');
  });
  it('formats a negative score without a double sign', () => {
    expect(fmtEval(-123, null, true)).toBe('-1.23');
  });
  it('formats zero with a leading +', () => {
    expect(fmtEval(0, null, true)).toBe('+0.00');
  });
  it('formats a mate score as #N, converting side-to-move to white perspective', () => {
    expect(fmtEval(0, 3, true)).toBe('#3'); // white to move, mate in 3 for the mover
    expect(fmtEval(0, 3, false)).toBe('#-3'); // black to move, mate in 3 for black -> bad for white
  });
});

describe('uciToSan', () => {
  it('converts a legal UCI move to SAN from the given position', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4');
  });
  it('returns null for an illegal move', () => {
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
  });
  it('handles promotion moves', () => {
    const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
    expect(uciToSan(fen, 'a7a8q')).toBe('a8=Q+'); // also delivers check from this position
  });
  it('returns null for a malformed FEN rather than throwing', () => {
    expect(uciToSan('not a fen', 'e2e4')).toBeNull();
  });
});

describe('pvToSans', () => {
  it('converts a principal variation of UCI moves into SANs, playing them out in order', () => {
    expect(pvToSans(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
  });
  it('caps the output at `max` moves', () => {
    expect(pvToSans(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2)).toEqual(['e4', 'e5']);
  });
  it('stops at the first illegal move in the sequence rather than throwing', () => {
    expect(pvToSans(START_FEN, ['e2e4', 'e2e5', 'g1f3'])).toEqual(['e4']);
  });
});
