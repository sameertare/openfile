import { describe, it, expect } from 'vitest';
import { assessGame } from './gameAssessment';
import type { ErrCounts, GameRecord, Phase, WorstMove } from './types';

function errCounts(over: Partial<ErrCounts> = {}): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0, ...over };
}

function baseGame(over: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g1',
    date: '2026-01-01',
    site: 'lichess.org',
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
    moveCount: 40,
    analyzed: true,
    evalSource: 'engine',
    accuracy: { overall: 90, opening: 90, middlegame: 90, endgame: 90 },
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
    reachedEndgame: true,
    endgameType: null,
    clockDataAvailable: false,
    timePressureBlunders: 0,
    clockSeries: [],
    errorSeries: [],
    worstMoves: [],
    evalGraph: null,
    sans: [],
    ...over,
  };
}

function move(over: Partial<WorstMove> = {}): WorstMove {
  return {
    moveNo: 15,
    san: 'Qxh7',
    phase: 'middlegame',
    kind: 'blunder',
    winPctBefore: 70,
    winPctAfter: 20,
    ...over,
  };
}

describe('assessGame: gating', () => {
  it('returns null for an unanalyzed game', () => {
    const g = baseGame({ analyzed: false });
    expect(assessGame(g)).toBeNull();
  });
});

describe('assessGame: per-phase verdicts', () => {
  it('marks a high-accuracy, blunder-free phase as a strength', () => {
    const g = baseGame({ accuracy: { overall: 92, opening: 92, middlegame: 92, endgame: 92 } });
    const result = assessGame(g)!;
    expect(result.phases.every((p) => p.verdict === 'strength')).toBe(true);
    // One strength line per phase, plus the "clean game overall" bonus line since this game is
    // error-free with no weaknesses.
    expect(result.strengths.length).toBe(result.phases.length + 1);
    expect(result.weaknesses).toEqual([]);
  });

  it('marks a low-accuracy phase as a weakness', () => {
    const g = baseGame({ accuracy: { overall: 60, opening: 90, middlegame: 60, endgame: 90 } });
    const result = assessGame(g)!;
    const mg = result.phases.find((p) => p.phase === 'middlegame')!;
    expect(mg.verdict).toBe('weakness');
    expect(result.weaknesses.some((w) => w.startsWith('Middlegame:'))).toBe(true);
  });

  it('marks any phase with a blunder as a weakness even at high accuracy', () => {
    const g = baseGame({
      accuracy: { overall: 91, opening: 91, middlegame: 91, endgame: 91 },
      errors: { opening: errCounts(), middlegame: errCounts({ blunders: 1 }), endgame: errCounts() },
    });
    const result = assessGame(g)!;
    expect(result.phases.find((p) => p.phase === 'middlegame')!.verdict).toBe('weakness');
  });

  it('marks a mid-band, error-free phase as neutral', () => {
    const g = baseGame({ accuracy: { overall: 75, opening: 75, middlegame: 75, endgame: 75 } });
    const result = assessGame(g)!;
    expect(result.phases.every((p) => p.verdict === 'neutral')).toBe(true);
  });

  it('marks the endgame neutral (not reached) when reachedEndgame is false', () => {
    const g = baseGame({ reachedEndgame: false, accuracy: { overall: 80, opening: 80, middlegame: 80, endgame: null } });
    const result = assessGame(g)!;
    const eg = result.phases.find((p) => p.phase === 'endgame')!;
    expect(eg.verdict).toBe('neutral');
    expect(eg.reached).toBe(false);
    expect(eg.summary).toMatch(/Endgame not reached/);
  });

  it('marks a phase neutral when accuracy data is unavailable', () => {
    const g = baseGame({ accuracy: { overall: 80, opening: null, middlegame: 80, endgame: 80 } });
    const result = assessGame(g)!;
    const op = result.phases.find((p) => p.phase === 'opening')!;
    expect(op.verdict).toBe('neutral');
    expect(op.summary).toMatch(/Not enough moves/);
  });

  it('flags the decisive-error phase as a weakness even with a strong accuracy band', () => {
    const g = baseGame({
      accuracy: { overall: 91, opening: 91, middlegame: 91, endgame: 91 },
      decisiveErrorPhase: 'opening',
      decisiveErrorMove: 8,
    });
    const result = assessGame(g)!;
    expect(result.phases.find((p) => p.phase === 'opening')!.verdict).toBe('weakness');
  });
});

describe('assessGame: move citation', () => {
  it("cites a phase's worstMoves in its weakness summary", () => {
    const wm = move({ san: 'Qxh7', moveNo: 20, phase: 'middlegame' });
    const g = baseGame({
      accuracy: { overall: 60, opening: 90, middlegame: 60, endgame: 90 },
      worstMoves: [wm],
    });
    const result = assessGame(g)!;
    const mg = result.phases.find((p) => p.phase === 'middlegame')!;
    expect(mg.summary).toContain('Qxh7');
    expect(mg.summary).toContain('move 20');
  });

  it('appends every errorSeries-flagged move not already covered by worstMoves ("Also flagged in this phase")', () => {
    const g = baseGame({
      accuracy: { overall: 60, opening: 90, middlegame: 60, endgame: 90 },
      sans: Array.from({ length: 60 }, (_, i) => `m${i}`), // ply-indexed
      errorSeries: [
        { moveNo: 12, kind: 'inaccuracy', phase: 'middlegame' },
        { moveNo: 14, kind: 'mistake', phase: 'middlegame' },
      ],
    });
    const result = assessGame(g)!;
    const mg = result.phases.find((p) => p.phase === 'middlegame')!;
    expect(mg.summary).toContain('Also flagged in this phase');
    expect(mg.summary).toContain('move 12');
    expect(mg.summary).toContain('move 14');
  });

  it('does not double-cite a move already covered by worstMoves in the "Also flagged" tail', () => {
    const wm = move({ san: 'Qxh7', moveNo: 20, phase: 'middlegame' });
    const g = baseGame({
      accuracy: { overall: 60, opening: 90, middlegame: 60, endgame: 90 },
      worstMoves: [wm],
      errorSeries: [{ moveNo: 20, kind: 'blunder', phase: 'middlegame' }],
    });
    const result = assessGame(g)!;
    const mg = result.phases.find((p) => p.phase === 'middlegame')!;
    // move 20 already covered by moveDetail; extraErrorDetail must not repeat it
    expect(mg.summary).not.toContain('Also flagged in this phase');
  });

  it('enriches strength verdicts with extraErrorDetail too, not just weakness/neutral', () => {
    const g = baseGame({
      accuracy: { overall: 92, opening: 92, middlegame: 92, endgame: 92 },
      sans: Array.from({ length: 60 }, (_, i) => `m${i}`),
      // A phase can be a "strength" (accuracy band + zero blunders) yet still have inaccuracies
      // flagged in errorSeries — extraErrorDetail must surface them regardless of verdict.
      errorSeries: [{ moveNo: 5, kind: 'inaccuracy', phase: 'opening' }],
    });
    const result = assessGame(g)!;
    const op = result.phases.find((p) => p.phase === 'opening')!;
    expect(op.verdict).toBe('strength');
    expect(op.summary).toContain('Also flagged in this phase');
  });
});

describe('assessGame: conversion / resilience narrative', () => {
  it('adds a resilience strength when savedFromLosing', () => {
    const g = baseGame({ savedFromLosing: true, worstWinPct: 5, result: 'draw' });
    const result = assessGame(g)!;
    expect(result.strengths.some((s) => s.startsWith('Resilience:'))).toBe(true);
  });

  it('adds a conversion weakness when lostFromWinning', () => {
    const g = baseGame({ lostFromWinning: true, bestWinPct: 95, result: 'loss' });
    const result = assessGame(g)!;
    expect(result.weaknesses.some((w) => w.startsWith('Conversion:'))).toBe(true);
    expect(result.overall).toMatch(/conversion/i);
  });

  it('adds a conversion weakness when drewFromWinning', () => {
    const g = baseGame({ drewFromWinning: true, bestWinPct: 95, result: 'draw' });
    const result = assessGame(g)!;
    expect(result.weaknesses.some((w) => w.startsWith('Conversion:'))).toBe(true);
  });
});

describe('assessGame: missed tactics / mates / time pressure', () => {
  it('lists a missed mate not already cited by a phase weakness', () => {
    const wm = move({ kind: 'missed mate', san: 'Qh6', moveNo: 30, phase: 'endgame' });
    const g = baseGame({ worstMoves: [wm], missedMates: 1 });
    const result = assessGame(g)!;
    expect(result.weaknesses.some((w) => w.startsWith('Missed mate:'))).toBe(true);
  });

  it('adds a summary line when more mates were missed than the kept worstMoves show', () => {
    const g = baseGame({ missedMates: 3, worstMoves: [] });
    const result = assessGame(g)!;
    expect(result.weaknesses.some((w) => /3 forced mate\(s\) missed in total/.test(w))).toBe(true);
  });

  it('lists missed tactics count', () => {
    const g = baseGame({ missedTactics: 2 });
    const result = assessGame(g)!;
    expect(result.weaknesses.some((w) => w.includes('Missed 2 tactics'))).toBe(true);
  });

  it('lists time-pressure blunders only when clock data is available', () => {
    const withClock = baseGame({ clockDataAvailable: true, timePressureBlunders: 2 });
    expect(assessGame(withClock)!.weaknesses.some((w) => w.startsWith('Time pressure:'))).toBe(true);

    const withoutClock = baseGame({ clockDataAvailable: false, timePressureBlunders: 2 });
    expect(assessGame(withoutClock)!.weaknesses.some((w) => w.startsWith('Time pressure:'))).toBe(false);
  });
});

describe('assessGame: clean-game / overall summary', () => {
  it('flags an error-free, weakness-free game as clean overall', () => {
    const g = baseGame({ accuracy: { overall: 95, opening: 95, middlegame: 95, endgame: 95 } });
    const result = assessGame(g)!;
    expect(result.strengths.some((s) => s.startsWith('Clean game overall'))).toBe(true);
  });

  it('does not call a game with a weakness "clean"', () => {
    const g = baseGame({ accuracy: { overall: 60, opening: 90, middlegame: 60, endgame: 90 } });
    const result = assessGame(g)!;
    expect(result.strengths.some((s) => s.startsWith('Clean game overall'))).toBe(false);
  });

  it('overall summary states result, colour, opening, and accuracy', () => {
    const g = baseGame({ result: 'loss', userColor: 'b', family: 'Sicilian Defense', accuracy: { overall: 55, opening: 55, middlegame: 55, endgame: 55 } });
    const result = assessGame(g)!;
    expect(result.overall).toMatch(/^Loss as Black, Sicilian Defense\./);
    expect(result.overall).toContain('55% overall accuracy');
  });

  it('overall summary cites the biggest-swing move as the turning point when there is a decisive phase', () => {
    const wm = move({ san: 'Nxe5??', moveNo: 22, phase: 'middlegame', winPctBefore: 80, winPctAfter: 10 });
    const g = baseGame({ worstMoves: [wm], decisiveErrorPhase: 'middlegame', accuracy: { overall: 70, opening: 90, middlegame: 55, endgame: 90 } });
    const result = assessGame(g)!;
    expect(result.overall).toContain('turning point');
    expect(result.overall).toContain('Nxe5??');
  });
});
