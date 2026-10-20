import { describe, expect, it } from 'vitest';
import { moveLabel, theoryLineStartPly, traceOpeningTheory } from './openingTheory';

const fallback = { opening: 'Fallback Opening', eco: '' };

describe('traceOpeningTheory', () => {
  it('recognizes a game that remains in the named reference to its final move', () => {
    const sans = 'e4 e5 Nf3 Nc6 Bb5 a6'.split(' ');
    const trace = traceOpeningTheory(sans, 'w', fallback);
    expect(trace).toMatchObject({
      status: 'book-to-end',
      knownPlies: 6,
      departurePly: null,
      bookName: 'Ruy Lopez: Morphy Defense',
      eco: 'C70',
    });
    expect(theoryLineStartPly(trace, sans.length)).toBe(6);
  });

  it("reports when the player is first to leave theory and anchors Stockfish before that move", () => {
    const sans = 'e4 e5 h4'.split(' ');
    const trace = traceOpeningTheory(sans, 'w', fallback);
    expect(trace).toMatchObject({
      status: 'departed',
      knownPlies: 2,
      departurePly: 2,
      departureMoveNo: 2,
      departureColor: 'w',
      departureBy: 'player',
      played: 'h4',
      bookName: "King's Pawn Game",
    });
    expect(theoryLineStartPly(trace, sans.length)).toBe(2);
  });

  it("anchors after the opponent's departure so Stockfish recommends the player's reply", () => {
    const sans = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 h5'.split(' ');
    const trace = traceOpeningTheory(sans, 'w', fallback);
    expect(trace).toMatchObject({ departurePly: 7, departureBy: 'opponent', played: 'h5' });
    expect(theoryLineStartPly(trace, sans.length)).toBe(8);
  });

  it('formats White and Black move labels unambiguously', () => {
    expect(moveLabel(5, 'w', 'Bb3')).toBe('5.Bb3');
    expect(moveLabel(5, 'b', 'Nf6')).toBe('5...Nf6');
  });
});
