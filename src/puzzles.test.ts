import { describe, it, expect } from 'vitest';
import { derivePuzzles } from './puzzles';
import type { ErrCounts, GameRecord, WorstMove } from './types';

function errCounts(over: Partial<ErrCounts> = {}): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0, ...over };
}

function game(over: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g1',
    date: '2026-01-01',
    site: 'lichess.org',
    event: 'Rated Blitz',
    white: 'Hero',
    black: 'Villain',
    userColor: 'w',
    result: 'loss',
    resultRaw: '0-1',
    termination: 'Normal',
    eco: 'C50',
    opening: 'Italian Game',
    family: 'Italian Game',
    timeControl: '300',
    timeClass: 'Blitz',
    moveCount: 3,
    analyzed: true,
    evalSource: 'engine',
    accuracy: { overall: 60, opening: 60, middlegame: null, endgame: null },
    errors: { opening: errCounts({ blunders: 1 }), middlegame: errCounts(), endgame: errCounts() },
    missedWins: 0,
    missedMates: 0,
    missedTactics: 0,
    bestWinPct: 60,
    worstWinPct: 10,
    lostFromWinning: false,
    drewFromWinning: false,
    savedFromLosing: false,
    decisiveErrorPhase: 'opening',
    decisiveErrorMove: 2,
    firstErrorMove: 2,
    reachedEndgame: false,
    endgameType: null,
    clockDataAvailable: false,
    timePressureBlunders: 0,
    clockSeries: [],
    errorSeries: [],
    worstMoves: [],
    evalGraph: null,
    sans: ['e4', 'e5', 'Qh5'], // White's 2nd move (ply index 2) is the blunder "Qh5"
    ...over,
  };
}

function blunderMove(over: Partial<WorstMove> = {}): WorstMove {
  return { moveNo: 2, san: 'Qh5', phase: 'opening', kind: 'blunder', winPctBefore: 60, winPctAfter: 10, best: 'Nf3', ...over };
}

describe('derivePuzzles', () => {
  it('derives a puzzle from a blunder with a known best move, engine-analyzed game', () => {
    const g = game({ worstMoves: [blunderMove()] });
    const puzzles = derivePuzzles([g]);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toMatchObject({ gameId: 'g1', played: 'Qh5', best: 'Nf3', kind: 'blunder', moveNo: 2, color: 'w' });
    expect(puzzles[0].id).toBe('g1:2:w');
  });

  it('skips games that were not analyzed', () => {
    const g = game({ analyzed: false, worstMoves: [blunderMove()] });
    expect(derivePuzzles([g])).toEqual([]);
  });

  it('skips games analyzed only from PGN evals (no engine best-move data)', () => {
    const g = game({ evalSource: 'pgn', worstMoves: [blunderMove()] });
    expect(derivePuzzles([g])).toEqual([]);
  });

  it('skips a worstMove with no best move recorded', () => {
    const g = game({ worstMoves: [blunderMove({ best: undefined })] });
    expect(derivePuzzles([g])).toEqual([]);
  });

  it('skips plain "mistake" kind moves (keeps blunders, missed wins, missed mates)', () => {
    const g = game({ worstMoves: [blunderMove({ kind: 'mistake' })] });
    expect(derivePuzzles([g])).toEqual([]);
  });

  it('includes missed win and missed mate kinds', () => {
    const missedWin = blunderMove({ kind: 'missed win' });
    const missedMate = blunderMove({ kind: 'missed mate', moveNo: 1, san: 'e4' });
    const g = game({ worstMoves: [missedWin, missedMate] });
    const puzzles = derivePuzzles([g]);
    expect(puzzles.map((p) => p.kind).sort()).toEqual(['missed mate', 'missed win']);
  });

  it('skips a move when the sans list has drifted out of alignment with the recorded moveNo/san', () => {
    const g = game({ worstMoves: [blunderMove({ san: 'Qd1' })] }); // sans[2] is actually 'Qh5'
    expect(derivePuzzles([g])).toEqual([]);
  });

  it('sets the FEN to the position immediately before the flagged move', () => {
    const g = game({ worstMoves: [blunderMove()] });
    const puzzle = derivePuzzles([g])[0];
    // Position after 1. e4 e5 (White to move) — Qh5 hasn't been played yet in the puzzle FEN.
    expect(puzzle.fen).toContain(' w ');
    expect(puzzle.fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3')).toBe(true);
  });

  it('attributes the opponent name from the color the analyzed player was not', () => {
    const g = game({ worstMoves: [blunderMove()], userColor: 'w', white: 'Hero', black: 'Nemesis' });
    expect(derivePuzzles([g])[0].opponent).toBe('Nemesis');
  });

  it('does not crash on a corrupted sans list, and skips that game\'s puzzles', () => {
    const g = game({ worstMoves: [blunderMove()], sans: ['e4', 'illegal-garbage', 'Qh5'] });
    expect(() => derivePuzzles([g])).not.toThrow();
    expect(derivePuzzles([g])).toEqual([]);
  });
});
