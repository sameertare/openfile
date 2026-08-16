import { describe, it, expect } from 'vitest';
import { winPct, positionsNeeded, analyzeGame, WINNING_WINPCT, type AnalyzeOptions } from './analyze';
import { parseGame } from './pgn';
import { nameKey } from './playerMatch';

function opts(over: Partial<AnalyzeOptions> = {}): AnalyzeOptions {
  return { username: 'Hero', matchKeys: new Set([nameKey('Hero')]), depth: 12, engine: null, ...over };
}

// Every move carries an [%eval] annotation so analyzeGame takes the PGN-eval path (no live
// engine needed) — hasPgnEvals() requires nearly every move to have one.
const CLEAN_GAME = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.01.01"]
[White "Hero"]
[Black "Villain"]
[Result "1-0"]
[TimeControl "300+0"]

1. e4 { [%eval 0.2] [%clk 0:05:00] } e5 { [%eval 0.19] [%clk 0:04:58] } 2. Nf3 { [%eval 0.25] [%clk 0:04:55] } Nc6 { [%eval 0.20] [%clk 0:04:50] } 3. Bb5 { [%eval 0.30] [%clk 0:04:48] } a6 { [%eval 0.35] [%clk 0:04:40] } 1-0
`;

// White's 2nd move (Qh5) is the howler: its own eval comment (attached right after it's played)
// swings from roughly-equal to heavily lost for White — that's what makes Qh5 itself the blunder,
// not Black's reply.
const BLUNDER_GAME = `[Event "Rated Blitz game"]
[Site "https://lichess.org/blunder1"]
[Date "2026.01.02"]
[White "Hero"]
[Black "Villain"]
[Result "0-1"]
[TimeControl "300+0"]

1. e4 { [%eval 0.2] } e5 { [%eval 0.19] } 2. Qh5 { [%eval -6.0] } g6 { [%eval -6.1] } 3. Qf3 { [%eval -6.2] } Nf6 { [%eval -6.3] } 0-1
`;

describe('winPct', () => {
  it('is 50 at cp=0', () => {
    expect(winPct(0)).toBe(50);
  });
  it('is monotonically increasing in cp', () => {
    expect(winPct(100)).toBeGreaterThan(winPct(0));
    expect(winPct(-100)).toBeLessThan(winPct(0));
  });
  it('is symmetric around 0 (winPct(x) + winPct(-x) == 100)', () => {
    expect(winPct(250) + winPct(-250)).toBeCloseTo(100, 5);
  });
  it('saturates toward 100/0 for large advantages, never exceeding the range', () => {
    expect(winPct(5000)).toBeLessThanOrEqual(100);
    expect(winPct(-5000)).toBeGreaterThanOrEqual(0);
  });
});

describe('positionsNeeded', () => {
  it('is 0 when useEngine is false, regardless of PGN evals', () => {
    const g = parseGame(CLEAN_GAME)!;
    expect(positionsNeeded(g, false)).toBe(0);
  });

  it('is 0 when the PGN already carries evals for (almost) every move', () => {
    const g = parseGame(CLEAN_GAME)!;
    expect(positionsNeeded(g, true)).toBe(0);
  });

  it('is moves.length + 1 when engine analysis is actually needed', () => {
    const noEvalPgn = `[Event "e"]\n[Site "s"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
    const g = parseGame(noEvalPgn)!;
    expect(positionsNeeded(g, true)).toBe(g.moves.length + 1);
  });
});

describe('analyzeGame: PGN-eval path (no engine needed)', () => {
  it('extracts headers, opening, and per-move accounting for the matched player', async () => {
    const g = parseGame(CLEAN_GAME)!;
    const record = await analyzeGame(g, opts());
    expect(record.white).toBe('Hero');
    expect(record.userColor).toBe('w');
    expect(record.result).toBe('win');
    expect(record.evalSource).toBe('pgn');
    expect(record.analyzed).toBe(true);
    expect(record.moveCount).toBe(3); // White's 3 moves (e4, Nf3, Bb5)
    expect(record.accuracy.overall).not.toBeNull();
    expect(record.accuracy.overall!).toBeGreaterThanOrEqual(0);
    expect(record.accuracy.overall!).toBeLessThanOrEqual(100);
  });

  it('maps result correctly for the player analyzed as Black', async () => {
    const asBlack = CLEAN_GAME.replace('[White "Hero"]', '[White "Someone"]').replace('[Black "Villain"]', '[Black "Hero"]');
    const g = parseGame(asBlack)!;
    const record = await analyzeGame(g, opts());
    expect(record.userColor).toBe('b');
    expect(record.result).toBe('loss'); // White (Someone) won 1-0, so Black (Hero) lost
  });

  it('maps an unfinished game (Result "*") to result "unknown"', async () => {
    const unfinished = CLEAN_GAME.replace('[Result "1-0"]', '[Result "*"]').replace(/1-0\s*$/, '*');
    const g = parseGame(unfinished)!;
    const record = await analyzeGame(g, opts());
    expect(record.result).toBe('unknown');
  });

  it('reads clock annotations into clockSeries and sets clockDataAvailable', async () => {
    const g = parseGame(CLEAN_GAME)!;
    const record = await analyzeGame(g, opts());
    expect(record.clockDataAvailable).toBe(true);
    expect(record.clockSeries.length).toBeGreaterThan(0);
    expect(record.clockSeries[0]).toMatchObject({ sec: expect.any(Number) });
  });

  it('classifies a large win%-drop move as a blunder and records it in worstMoves/errorSeries', async () => {
    const g = parseGame(BLUNDER_GAME)!;
    const record = await analyzeGame(g, opts());
    const totalBlunders = record.errors.opening.blunders + record.errors.middlegame.blunders + record.errors.endgame.blunders;
    expect(totalBlunders).toBeGreaterThanOrEqual(1);
    expect(record.errorSeries.some((e) => e.kind === 'blunder')).toBe(true);
    expect(record.worstMoves.some((m) => m.san === 'Qh5')).toBe(true);
  });

  it('flags lostFromWinning when the game peaked at a winning win% then was lost', async () => {
    // Hero (White) reaches a big advantage (eval +8.0, well above WINNING_WINPCT) after Qh5, then
    // blunders it away (eval -8.0 after Qf3) and loses the game (0-1).
    const winThenLose = `[Event "e"]\n[Site "https://lichess.org/win-then-lose"]\n[White "Hero"]\n[Black "Villain"]\n[Result "0-1"]\n\n1. e4 { [%eval 0.2] } e5 { [%eval 0.19] } 2. Qh5 { [%eval 8.0] } g6 { [%eval 8.0] } 3. Qf3 { [%eval -8.0] } Nf6 { [%eval -8.0] } 0-1`;
    const g = parseGame(winThenLose)!;
    const record = await analyzeGame(g, opts());
    expect(record.bestWinPct).toBeGreaterThanOrEqual(WINNING_WINPCT);
    expect(record.result).toBe('loss');
    expect(record.lostFromWinning).toBe(true);
  });

  it('produces a stable, deterministic id via gameId', async () => {
    const g = parseGame(CLEAN_GAME)!;
    const record = await analyzeGame(g, opts());
    expect(record.id).toBe('https://lichess.org/abcd1234');
  });
});

describe('analyzeGame: no analysis available', () => {
  it('leaves accuracy null and analyzed=false when there is no PGN eval and no engine', async () => {
    const noEvalPgn = `[Event "e"]\n[Site "s"]\n[White "Hero"]\n[Black "Villain"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
    const g = parseGame(noEvalPgn)!;
    const record = await analyzeGame(g, opts({ depth: 0, engine: null }));
    expect(record.analyzed).toBe(false);
    expect(record.evalSource).toBe('none');
    expect(record.accuracy.overall).toBeNull();
    expect(record.errors.opening).toEqual({ inaccuracies: 0, mistakes: 0, blunders: 0 });
  });
});
