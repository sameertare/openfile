import { describe, it, expect } from 'vitest';
import { analyzeTimeByPhase, findBlunderClusters } from './advancedAnalysis';
import type { ErrCounts, GameRecord } from './types';

function errCounts(over: Partial<ErrCounts> = {}): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0, ...over };
}

let idCounter = 0;
function game(over: Partial<GameRecord> = {}): GameRecord {
  idCounter++;
  return {
    id: `g${idCounter}`,
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
    accuracy: { overall: 85, opening: 85, middlegame: 85, endgame: 85 },
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

describe('analyzeTimeByPhase', () => {
  it('skips games with no clock data available', () => {
    const g = game({ clockDataAvailable: false, clockSeries: [{ moveNo: 5, sec: 20, phase: 'opening' }] });
    const stats = analyzeTimeByPhase([g]);
    expect(stats.find((s) => s.phase === 'opening')!.totalMoves).toBe(0);
  });

  it('buckets clock entries by their recorded phase and computes avg/min/max', () => {
    const g = game({
      clockDataAvailable: true,
      clockSeries: [
        { moveNo: 5, sec: 20, phase: 'opening' },
        { moveNo: 6, sec: 40, phase: 'opening' },
      ],
    });
    const stats = analyzeTimeByPhase([g]);
    const opening = stats.find((s) => s.phase === 'opening')!;
    expect(opening.totalMoves).toBe(2);
    expect(opening.avgSeconds).toBe(30);
    expect(opening.minSeconds).toBe(20);
    expect(opening.maxSeconds).toBe(40);
  });

  it('counts moves under the 30s threshold', () => {
    const g = game({
      clockDataAvailable: true,
      clockSeries: [{ moveNo: 5, sec: 10, phase: 'middlegame' }, { moveNo: 6, sec: 50, phase: 'middlegame' }],
    });
    const stats = analyzeTimeByPhase([g]);
    expect(stats.find((s) => s.phase === 'middlegame')!.movesUnderThreshold).toBe(1);
  });

  it('falls back to a move-number-based phase when an entry has no recorded phase', () => {
    const g = game({ clockDataAvailable: true, clockSeries: [{ moveNo: 5, sec: 20 }] }); // no phase field
    const stats = analyzeTimeByPhase([g]);
    expect(stats.find((s) => s.phase === 'opening')!.totalMoves).toBe(1); // move 5 <= 12 -> opening
  });

  it('always returns all three phases, even with zero data', () => {
    const stats = analyzeTimeByPhase([]);
    expect(stats.map((s) => s.phase).sort()).toEqual(['endgame', 'middlegame', 'opening']);
  });
});

describe('findBlunderClusters', () => {
  it('returns no clusters when there are fewer than 2 blunders total', () => {
    const g = game({ errorSeries: [{ moveNo: 10, kind: 'blunder', phase: 'middlegame' }] });
    expect(findBlunderClusters([g])).toEqual([]);
  });

  it('groups blunders within 2 moves of each other into one cluster', () => {
    const g = game({
      errorSeries: [
        { moveNo: 10, kind: 'blunder', phase: 'middlegame' },
        { moveNo: 11, kind: 'blunder', phase: 'middlegame' },
      ],
    });
    const clusters = findBlunderClusters([g]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ moveRange: [10, 11], count: 2, phase: 'middlegame' });
  });

  it('splits blunders more than 2 moves apart into separate clusters', () => {
    const g = game({
      errorSeries: [
        { moveNo: 10, kind: 'blunder', phase: 'opening' },
        { moveNo: 11, kind: 'blunder', phase: 'opening' },
        { moveNo: 30, kind: 'blunder', phase: 'endgame' },
        { moveNo: 31, kind: 'blunder', phase: 'endgame' },
      ],
    });
    const clusters = findBlunderClusters([g]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].moveRange).toEqual([10, 11]);
    expect(clusters[1].moveRange).toEqual([30, 31]);
  });

  it('marks a cluster "mixed" when it spans more than one phase', () => {
    const g = game({
      errorSeries: [
        { moveNo: 12, kind: 'blunder', phase: 'opening' },
        { moveNo: 13, kind: 'blunder', phase: 'middlegame' },
      ],
    });
    const clusters = findBlunderClusters([g]);
    expect(clusters[0].phase).toBe('mixed');
  });

  it('ignores non-blunder error kinds', () => {
    const g = game({
      errorSeries: [
        { moveNo: 10, kind: 'inaccuracy', phase: 'middlegame' },
        { moveNo: 11, kind: 'mistake', phase: 'middlegame' },
      ],
    });
    expect(findBlunderClusters([g])).toEqual([]);
  });

  it('aggregates blunder counts at the same move across multiple games', () => {
    const g1 = game({ errorSeries: [{ moveNo: 10, kind: 'blunder', phase: 'middlegame' }] });
    const g2 = game({ errorSeries: [{ moveNo: 10, kind: 'blunder', phase: 'middlegame' }] });
    const clusters = findBlunderClusters([g1, g2]);
    expect(clusters[0].count).toBe(2);
  });
});
