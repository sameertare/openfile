import { describe, it, expect } from 'vitest';
import { buildAnnotatedPgn, buildPgnFromLine } from './pgnExport';
import type { ErrCounts, GameRecord, WorstMove } from './types';

function errCounts(over: Partial<ErrCounts> = {}): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0, ...over };
}

function game(over: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g1',
    date: '2026.01.01',
    site: 'https://lichess.org/abcd1234',
    event: 'Rated Blitz',
    white: 'Hero',
    black: 'Villain',
    userColor: 'w',
    result: 'win',
    resultRaw: '1-0',
    termination: 'Normal',
    eco: 'C50',
    opening: 'Italian Game',
    family: 'Italian Game',
    timeControl: '300',
    timeClass: 'Blitz',
    moveCount: 3,
    analyzed: true,
    evalSource: 'engine',
    engineDepth: 12,
    accuracy: { overall: 85, opening: 85, middlegame: null, endgame: null },
    errors: { opening: errCounts(), middlegame: errCounts(), endgame: errCounts() },
    missedWins: 0,
    missedMates: 0,
    missedTactics: 0,
    bestWinPct: 60,
    worstWinPct: 40,
    lostFromWinning: false,
    drewFromWinning: false,
    savedFromLosing: false,
    decisiveErrorPhase: null,
    decisiveErrorMove: null,
    firstErrorMove: null,
    reachedEndgame: false,
    endgameType: null,
    clockDataAvailable: false,
    timePressureBlunders: 0,
    clockSeries: [],
    errorSeries: [],
    worstMoves: [],
    evalGraph: [20, 25, 15, 30],
    sans: ['e4', 'e5', 'Nf3'],
    ...over,
  };
}

describe('buildAnnotatedPgn', () => {
  it('includes standard headers with the right tag names', () => {
    const pgn = buildAnnotatedPgn(game());
    expect(pgn).toContain('[Event "Rated Blitz"]');
    expect(pgn).toContain('[White "Hero"]');
    expect(pgn).toContain('[Black "Villain"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[ECO "C50"]');
    expect(pgn).toContain('[Annotator "OpenFile (Stockfish 18, depth 12)"]');
  });

  it('escapes double quotes in header values', () => {
    const pgn = buildAnnotatedPgn(game({ white: 'Bob "The Bishop" Smith' }));
    expect(pgn).toContain(`[White "Bob 'The Bishop' Smith"]`);
  });

  it('falls back to a header-only PGN when there is no sans list (pre-sans saved reports)', () => {
    const pgn = buildAnnotatedPgn(game({ sans: [] }));
    expect(pgn).not.toContain('1. e4'); // the date header ("2026.01.01") legitimately contains "1."
    expect(pgn.trim().endsWith('1-0')).toBe(true);
  });

  it('numbers moves with "N." only before White\'s move', () => {
    const pgn = buildAnnotatedPgn(game());
    expect(pgn).toContain('1. e4');
    expect(pgn).not.toContain('1. e5');
    expect(pgn).not.toContain('2. e5');
  });

  it('embeds an [%eval] comment reconstructed from the eval graph', () => {
    const pgn = buildAnnotatedPgn(game());
    // evalGraph[1] = 25 -> 0.25 for the first move (e4)
    expect(pgn).toContain('e4 { [%eval 0.25] }');
  });

  it('annotates a move flagged in worstMoves with its kind and the engine best move', () => {
    const wm: WorstMove = { moveNo: 1, san: 'e4', phase: 'opening', kind: 'blunder', winPctBefore: 60, winPctAfter: 20, best: 'd4' };
    const pgn = buildAnnotatedPgn(game({ worstMoves: [wm] }));
    expect(pgn).toContain("blunder — engine's best was d4");
  });

  it('ends with the result token', () => {
    const pgn = buildAnnotatedPgn(game());
    expect(pgn.trim().endsWith('1-0')).toBe(true);
  });
});

describe('buildPgnFromLine', () => {
  it('renders headers with sensible defaults for missing fields', () => {
    const pgn = buildPgnFromLine({ line: [], evalsW: [], bestU: [] });
    expect(pgn).toContain('[White "?"]');
    expect(pgn).toContain('[Result "*"]');
  });

  it('renders a move line with move numbers and eval comments from a position line', () => {
    const line = [
      { fen: 'start', san: null, lm: null },
      { fen: 'after-e4', san: 'e4', lm: 'e2e4' },
      { fen: 'after-e5', san: 'e5', lm: 'e7e5' },
    ];
    const pgn = buildPgnFromLine({ white: 'A', black: 'B', result: '*', line, evalsW: [null, 20, 15], bestU: [null, null] });
    expect(pgn).toContain('1. e4 { [%eval 0.20] } e5 { [%eval 0.15] }');
  });

  it('notes the engine\'s best move (in SAN) when it differs from what was played', () => {
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const line = [
      { fen: START_FEN, san: null, lm: null },
      { fen: 'irrelevant-after-fen', san: 'e4', lm: 'e2e4' },
    ];
    const pgn = buildPgnFromLine({ line, evalsW: [null, 20], bestU: ['d2d4'] });
    expect(pgn).toContain("engine's best: d4");
  });

  it('omits the best-move comment when the engine agreed with the move played', () => {
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const line = [
      { fen: START_FEN, san: null, lm: null },
      { fen: 'irrelevant', san: 'e4', lm: 'e2e4' },
    ];
    const pgn = buildPgnFromLine({ line, evalsW: [null, 20], bestU: ['e2e4'] });
    expect(pgn).not.toContain("engine's best");
  });

  it('falls back to a header-only PGN when the line has fewer than 2 positions', () => {
    const pgn = buildPgnFromLine({ line: [{ fen: 'start', san: null, lm: null }], evalsW: [], bestU: [], result: '1/2-1/2' });
    expect(pgn.trim().endsWith('1/2-1/2')).toBe(true);
    expect(pgn).not.toContain('1.');
  });
});
