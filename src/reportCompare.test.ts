import { describe, it, expect } from 'vitest';
import { deltaRow, betterSide, compareOpenings, compareReports, headToHead } from './reportCompare';
import type { Aggregates, OpeningRow, WDL } from './aggregate';

function wdl(over: Partial<WDL> = {}): WDL {
  return { games: 0, wins: 0, draws: 0, losses: 0, ...over };
}

function opening(over: Partial<OpeningRow> = {}): OpeningRow {
  return { family: 'Italian Game', eco: 'C50', games: 0, wins: 0, draws: 0, losses: 0, asWhite: 0, asBlack: 0, avgAccuracy: null, avgOpeningAccuracy: null, ...over };
}

function aggregates(over: Partial<Aggregates> = {}): Aggregates {
  return {
    total: wdl(),
    byColor: { white: wdl(), black: wdl() },
    openings: [],
    strongest: [],
    weakest: [],
    byTimeClass: [],
    openingsByTimeClass: [],
    timeUsage: [],
    errorsByMove: [],
    repertoireCoverage: { preparedGames: 0, improvisedGames: 0, coveragePct: null },
    phases: [
      { phase: 'opening', avgAccuracy: null, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
      { phase: 'middlegame', avgAccuracy: null, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
      { phase: 'endgame', avgAccuracy: null, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
    ],
    overallAccuracy: null,
    tactics: { missedWins: 0, missedMates: 0, missedTactics: 0, blundersTotal: 0, worstMoments: [] },
    patterns: {
      lostFromWinning: [], drewFromWinning: [], savedFromLosing: [], conversionRate: null,
      gamesReachedWinning: 0, decisivePhaseInLosses: { opening: 0, middlegame: 0, endgame: 0 },
      avgFirstErrorMove: null, timePressureBlunders: 0, clockGames: 0, endgameTypeCounts: {},
      errorsInWins: { inaccuracies: 0, mistakes: 0, blunders: 0 }, errorsInLosses: { inaccuracies: 0, mistakes: 0, blunders: 0 },
      analyzedWins: 0, analyzedLosses: 0, narrative: [],
    },
    recommendations: [],
    analyzedCount: 0,
    ...over,
  };
}

describe('deltaRow', () => {
  it('computes delta as b - a, rounded to 1 decimal', () => {
    const row = deltaRow('Score', 50, 62.34, 'higher-better', '%');
    expect(row.delta).toBe(12.3);
  });
  it('leaves delta null when either side is null', () => {
    expect(deltaRow('X', null, 5, 'higher-better').delta).toBeNull();
    expect(deltaRow('X', 5, null, 'higher-better').delta).toBeNull();
  });
});

describe('betterSide', () => {
  it('picks the higher value as better for higher-better metrics', () => {
    expect(betterSide(deltaRow('Score', 50, 60, 'higher-better'))).toBe('b');
    expect(betterSide(deltaRow('Score', 60, 50, 'higher-better'))).toBe('a');
  });
  it('picks the lower value as better for lower-better metrics', () => {
    expect(betterSide(deltaRow('Blunders', 5, 2, 'lower-better'))).toBe('b');
    expect(betterSide(deltaRow('Blunders', 2, 5, 'lower-better'))).toBe('a');
  });
  it('returns "tie" for equal values, null for neutral metrics or missing data', () => {
    expect(betterSide(deltaRow('X', 3, 3, 'higher-better'))).toBe('tie');
    expect(betterSide(deltaRow('Games', 3, 5, 'neutral'))).toBeNull();
    expect(betterSide(deltaRow('X', null, 5, 'higher-better'))).toBeNull();
  });
});

describe('compareOpenings', () => {
  it('matches openings present in both reports by family and computes a score delta', () => {
    const a = [opening({ family: 'Italian Game', games: 4, wins: 2, draws: 0, losses: 2 })]; // 50%
    const b = [opening({ family: 'Italian Game', games: 4, wins: 4, draws: 0, losses: 0 })]; // 100%
    const [row] = compareOpenings(a, b);
    expect(row.scoreDelta).toBe(50);
  });

  it('includes an opening present in only one report, with the other side null and no score delta', () => {
    const a = [opening({ family: 'Only In A' })];
    const b: OpeningRow[] = [];
    const rows = compareOpenings(a, b);
    expect(rows).toHaveLength(1);
    expect(rows[0].b).toBeNull();
    expect(rows[0].scoreDelta).toBeNull();
  });
});

describe('compareReports', () => {
  it('builds an overview section with overall score/accuracy deltas', () => {
    const a = aggregates({ total: wdl({ games: 10, wins: 5, draws: 0, losses: 5 }), overallAccuracy: 70 });
    const b = aggregates({ total: wdl({ games: 10, wins: 7, draws: 0, losses: 3 }), overallAccuracy: 80 });
    const sections = compareReports(a, b);
    const scoreRow = sections.overview.find((r) => r.label === 'Overall score')!;
    expect(scoreRow.a).toBe(50);
    expect(scoreRow.b).toBe(70);
    const accRow = sections.overview.find((r) => r.label === 'Overall accuracy')!;
    expect(accRow.delta).toBe(10);
  });

  it('produces one phase section per phase name with accuracy and blunder deltas', () => {
    const a = aggregates({
      phases: [
        { phase: 'opening', avgAccuracy: 80, inaccuracies: 0, mistakes: 0, blunders: 1, blundersPerGame: 0.5, decisiveErrorsInLosses: 0 },
        { phase: 'middlegame', avgAccuracy: 70, inaccuracies: 0, mistakes: 0, blunders: 2, blundersPerGame: 1, decisiveErrorsInLosses: 1 },
        { phase: 'endgame', avgAccuracy: 90, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
      ],
    });
    const b = aggregates({
      phases: [
        { phase: 'opening', avgAccuracy: 90, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
        { phase: 'middlegame', avgAccuracy: 85, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
        { phase: 'endgame', avgAccuracy: 90, inaccuracies: 0, mistakes: 0, blunders: 0, blundersPerGame: 0, decisiveErrorsInLosses: 0 },
      ],
    });
    const sections = compareReports(a, b);
    const mg = sections.phases.find((p) => p.phase === 'middlegame')!;
    const accRow = mg.rows.find((r) => r.label === 'Accuracy')!;
    expect(accRow.delta).toBe(15);
  });

  it('normalizes tactics counts to per-game rates so different sample sizes are comparable', () => {
    const a = aggregates({ analyzedCount: 10, tactics: { missedWins: 0, missedMates: 0, missedTactics: 0, blundersTotal: 10, worstMoments: [] } });
    const b = aggregates({ analyzedCount: 100, tactics: { missedWins: 0, missedMates: 0, missedTactics: 0, blundersTotal: 10, worstMoments: [] } });
    const sections = compareReports(a, b);
    const row = sections.tactics.find((r) => r.label === 'Blunders total / game')!;
    expect(row.a).toBe(1); // 10/10
    expect(row.b).toBe(0.1); // 10/100
  });

  it('merges time-class breakdowns present in only one of the two reports', () => {
    const a = aggregates({ byTimeClass: [{ timeClass: 'Blitz', wdl: wdl({ games: 5, wins: 3, draws: 0, losses: 2 }), avgAccuracy: 75 }] });
    const b = aggregates({ byTimeClass: [{ timeClass: 'Rapid', wdl: wdl({ games: 5, wins: 4, draws: 0, losses: 1 }), avgAccuracy: 80 }] });
    const sections = compareReports(a, b);
    expect(sections.byTimeClass.map((t) => t.timeClass).sort()).toEqual(['Blitz', 'Rapid']);
    const blitz = sections.byTimeClass.find((t) => t.timeClass === 'Blitz')!;
    expect(blitz.rows.find((r) => r.label === 'Games')!.b).toBeNull(); // absent from report B
  });
});

describe('headToHead', () => {
  it('declares the side that wins more directional metrics the leader', () => {
    const a = aggregates({ total: wdl({ games: 10, wins: 8, draws: 0, losses: 2 }), overallAccuracy: 90 });
    const b = aggregates({ total: wdl({ games: 10, wins: 2, draws: 0, losses: 8 }), overallAccuracy: 50 });
    const sections = compareReports(a, b);
    const result = headToHead(sections);
    expect(result.leader).toBe('a');
    expect(result.aWins).toBeGreaterThan(result.bWins);
  });

  it('declares a tie when neither side wins more metrics', () => {
    const a = aggregates();
    const b = aggregates();
    const sections = compareReports(a, b);
    const result = headToHead(sections);
    expect(result.leader).toBe('tie');
  });
});
