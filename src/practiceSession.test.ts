import { describe, it, expect } from 'vitest';
import { PracticeSession } from './practiceSession';

const LINE = 'e4 e5 Nf3 Nc6 Bc4 Bc5'.split(' ');

describe('PracticeSession (playing White)', () => {
  it('starts on your turn expecting the first book move', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    expect(s.isUserTurn()).toBe(true);
    expect(s.expected()).toBe('e4');
    expect(s.userMoveCount).toBe(3);
    expect(s.userMoveIndex).toBe(0);
  });

  it('a correct move advances, scores, and hands over to the book reply', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    const r = s.attempt('e4');
    expect(r.ok).toBe(true);
    expect(s.isUserTurn()).toBe(false);
    const reply = s.opponentReply()!;
    expect(reply.san).toBe('e5');
    expect(reply.by).toBe('book');
    expect(s.isUserTurn()).toBe(true);
    expect(s.expected()).toBe('Nf3');
  });

  it('a wrong move does not advance, counts a mistake, and tells you the book move', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    const r = s.attempt('d4');
    expect(r).toEqual({ ok: false, expected: 'e4' });
    expect(s.ply).toBe(0);
    expect(s.mistakes).toBe(1);
    expect(s.isClean()).toBe(false);
  });

  it('a retry after a miss earns no points, even when correct', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    s.attempt('d4');
    const r = s.attempt('e4');
    expect(r.ok && r.points).toBe(0);
  });

  it('pays 1 with an arrow showing and 3 when recalled with the arrow faded', () => {
    const early = new PracticeSession(LINE, 'w', 1, 2); // viewing 1 of 2 -> arrows on
    expect((early.attempt('e4') as any).points).toBe(1);
    const faded = new PracticeSession(LINE, 'w', 10, 2); // long past the fade window
    expect((faded.attempt('e4') as any).points).toBe(3);
  });

  it('asking for a hint shows the arrow for that move only and forfeits the from-memory credit', () => {
    const s = new PracticeSession(LINE, 'w', 10, 2);
    expect(s.arrowShown()).toBe(false);
    s.requestHint();
    expect(s.arrowShown()).toBe(true);
    expect((s.attempt('e4') as any).points).toBe(1);
    expect(s.fromMemory).toBe(false);
    s.opponentReply();
    expect(s.arrowShown()).toBe(false); // hint doesn't carry over to the next move
  });

  it('stays from-memory only if no arrow was ever visible', () => {
    const s = new PracticeSession(LINE, 'w', 10, 2);
    s.attempt('e4'); s.opponentReply(); s.attempt('Nf3'); s.opponentReply(); s.attempt('Bc4');
    expect(s.fromMemory).toBe(true);
  });

  it('finishing a line, clean, earns the completion bonus; a mistake forfeits it', () => {
    const run = (slip: boolean) => {
      const s = new PracticeSession(LINE, 'w', 1, 2);
      if (slip) s.attempt('d4');
      s.attempt('e4'); s.opponentReply(); s.attempt('Nf3'); s.opponentReply(); s.attempt('Bc4'); s.opponentReply();
      return s;
    };
    expect(run(false).done).toBe(true);
    expect(run(false).completionBonus()).toBe(5);
    expect(run(true).completionBonus()).toBe(0);
  });

  it('rejects moves once the line is complete or when it is not your turn', () => {
    const s = new PracticeSession(['e4', 'e5'], 'w', 1, 2);
    s.attempt('e4');
    expect(s.attempt('Nf3').ok).toBe(false); // opponent's turn
    s.opponentReply();
    expect(s.done).toBe(true);
    expect(s.attempt('Nf3').ok).toBe(false);
    expect(s.opponentReply()).toBeNull();
  });
});

describe('PracticeSession (playing Black)', () => {
  it('opens with the book move for White, then waits for you', () => {
    const s = new PracticeSession(LINE, 'b', 1, 2);
    expect(s.isUserTurn()).toBe(false);
    expect(s.opponentReply()!.san).toBe('e4');
    expect(s.isUserTurn()).toBe(true);
    expect(s.expected()).toBe('e5');
    expect(s.userMoveCount).toBe(3);
  });
});

describe('legalMove / expectedSquares', () => {
  it('maps a from-to click to SAN, null if illegal', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    expect(s.legalMove('e2', 'e4')).toBe('e4');
    expect(s.legalMove('e2', 'e5')).toBeNull();
  });
  it('gives the book move squares for the arrow', () => {
    const s = new PracticeSession(LINE, 'w', 1, 2);
    expect(s.expectedSquares()).toEqual({ from: 'e2', to: 'e4' });
  });
});
