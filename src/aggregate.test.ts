import { describe, it, expect } from 'vitest';
import { aggregate, opponentList, headToHeadWithOpponent, scorePct, themeUrl, themeLabel, type WDL } from './aggregate';
import type { ErrCounts, GameRecord, Phase, Result, WorstMove } from './types';

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

describe('scorePct', () => {
  it('is 100 * (wins + 0.5*draws) / games, rounded to 1 decimal', () => {
    expect(scorePct({ games: 4, wins: 2, draws: 1, losses: 1 } as WDL)).toBe(62.5);
  });
  it('is 0 for an empty WDL rather than NaN', () => {
    expect(scorePct({ games: 0, wins: 0, draws: 0, losses: 0 } as WDL)).toBe(0);
  });
});

describe('themeUrl / themeLabel', () => {
  it('builds a lichess puzzle-training URL', () => {
    expect(themeUrl('fork')).toBe('https://lichess.org/training/fork');
  });
  it('maps a known theme to its human label, falls back to the raw key', () => {
    expect(themeLabel('fork')).toBe('Forks');
    expect(themeLabel('someUnknownTheme')).toBe('someUnknownTheme');
  });
});

describe('aggregate: total / byColor', () => {
  it('tallies wins/draws/losses and excludes unknown-result games', () => {
    const games = [
      game({ result: 'win', userColor: 'w' }),
      game({ result: 'loss', userColor: 'b' }),
      game({ result: 'draw', userColor: 'w' }),
      game({ result: 'unknown' as Result }),
    ];
    const agg = aggregate(games);
    expect(agg.total).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(agg.byColor.white.games).toBe(2);
    expect(agg.byColor.black.games).toBe(1);
  });
});

describe('aggregate: openings', () => {
  it('groups games by opening family and computes W/D/L + average accuracy', () => {
    const games = [
      game({ family: 'Italian Game', result: 'win', accuracy: { overall: 90, opening: 90, middlegame: 90, endgame: 90 } }),
      game({ family: 'Italian Game', result: 'loss', accuracy: { overall: 70, opening: 70, middlegame: 70, endgame: 70 } }),
      game({ family: 'Sicilian Defense', result: 'win' }),
    ];
    const agg = aggregate(games);
    const italian = agg.openings.find((o) => o.family === 'Italian Game')!;
    expect(italian.games).toBe(2);
    expect(italian.wins).toBe(1);
    expect(italian.losses).toBe(1);
    expect(italian.avgAccuracy).toBe(80);
  });

  it('lists openings scoring >= 50% (with 2+ games) as strongest, < 50% as weakest', () => {
    const games = [
      game({ family: 'Winning Line', result: 'win' }),
      game({ family: 'Winning Line', result: 'win' }),
      game({ family: 'Losing Line', result: 'loss' }),
      game({ family: 'Losing Line', result: 'loss' }),
      game({ family: 'One-off Line', result: 'win' }), // only 1 game -> excluded from ranked lists
    ];
    const agg = aggregate(games);
    expect(agg.strongest.some((o) => o.family === 'Winning Line')).toBe(true);
    expect(agg.weakest.some((o) => o.family === 'Losing Line')).toBe(true);
    expect(agg.strongest.some((o) => o.family === 'One-off Line')).toBe(false);
    expect(agg.weakest.some((o) => o.family === 'One-off Line')).toBe(false);
  });

  it('computes repertoire coverage from games in openings played 2+ times', () => {
    const games = [
      game({ family: 'Repeated', result: 'win' }),
      game({ family: 'Repeated', result: 'loss' }),
      game({ family: 'OneOff', result: 'win' }),
    ];
    const agg = aggregate(games);
    expect(agg.repertoireCoverage.preparedGames).toBe(2);
    expect(agg.repertoireCoverage.improvisedGames).toBe(1);
    expect(agg.repertoireCoverage.coveragePct).toBeCloseTo((2 / 3) * 100, 1);
  });
});

describe('aggregate: phases', () => {
  it('averages accuracy and sums error counts per phase across analyzed games only', () => {
    const games = [
      game({ analyzed: true, accuracy: { overall: 80, opening: 80, middlegame: 60, endgame: 90 }, errors: { opening: errCounts(), middlegame: errCounts({ blunders: 1 }), endgame: errCounts() } }),
      game({ analyzed: false, accuracy: { overall: null, opening: null, middlegame: null, endgame: null } }),
    ];
    const agg = aggregate(games);
    const mg = agg.phases.find((p) => p.phase === 'middlegame')!;
    expect(mg.avgAccuracy).toBe(60);
    expect(mg.blunders).toBe(1);
  });

  it('counts a loss decided in a phase toward decisiveErrorsInLosses only for that phase', () => {
    const games = [game({ result: 'loss', decisiveErrorPhase: 'endgame' })];
    const agg = aggregate(games);
    expect(agg.phases.find((p) => p.phase === 'endgame')!.decisiveErrorsInLosses).toBe(1);
    expect(agg.phases.find((p) => p.phase === 'opening')!.decisiveErrorsInLosses).toBe(0);
  });
});

describe('aggregate: tactics', () => {
  it('sums missed wins/mates/tactics across analyzed games', () => {
    const games = [game({ missedWins: 2, missedMates: 1, missedTactics: 3 }), game({ missedWins: 1, missedMates: 0, missedTactics: 0 })];
    const agg = aggregate(games);
    expect(agg.tactics.missedWins).toBe(3);
    expect(agg.tactics.missedMates).toBe(1);
    expect(agg.tactics.missedTactics).toBe(3);
  });

  it('ranks worstMoments by biggest win% swing, capped at 10', () => {
    const moves = (n: number): WorstMove[] => [{ moveNo: 10, san: 'x', phase: 'middlegame', kind: 'blunder', winPctBefore: 100, winPctAfter: 100 - n }];
    const games = Array.from({ length: 12 }, (_, i) => game({ worstMoves: moves(i + 1) }));
    const agg = aggregate(games);
    expect(agg.tactics.worstMoments).toHaveLength(10);
    expect(agg.tactics.worstMoments[0].move.winPctAfter).toBe(88); // biggest swing (n=12) first
  });
});

describe('aggregate: patterns', () => {
  it('collects lostFromWinning / drewFromWinning / savedFromLosing games', () => {
    const games = [
      game({ lostFromWinning: true }),
      game({ drewFromWinning: true }),
      game({ savedFromLosing: true }),
    ];
    const agg = aggregate(games);
    expect(agg.patterns.lostFromWinning).toHaveLength(1);
    expect(agg.patterns.drewFromWinning).toHaveLength(1);
    expect(agg.patterns.savedFromLosing).toHaveLength(1);
  });

  it('computes conversionRate as % of games reaching a winning position that were won', () => {
    const games = [
      game({ bestWinPct: 80, result: 'win' }),
      game({ bestWinPct: 80, result: 'loss' }),
      game({ bestWinPct: 40, result: 'win' }), // never reached winning -> excluded
    ];
    const agg = aggregate(games);
    expect(agg.patterns.gamesReachedWinning).toBe(2);
    expect(agg.patterns.conversionRate).toBe(50);
  });

  it('returns null conversionRate when no game ever reached a winning position', () => {
    const games = [game({ bestWinPct: 40 })];
    const agg = aggregate(games);
    expect(agg.patterns.conversionRate).toBeNull();
  });

  it('tallies endgame type W/D/L only for games that reached the endgame with a known type', () => {
    const games = [
      game({ reachedEndgame: true, endgameType: 'Rook endgame', result: 'win' }),
      game({ reachedEndgame: true, endgameType: 'Rook endgame', result: 'loss' }),
      game({ reachedEndgame: false, endgameType: null }),
    ];
    const agg = aggregate(games);
    expect(agg.patterns.endgameTypeCounts['Rook endgame']).toEqual({ games: 2, wins: 1, draws: 0, losses: 1 });
  });
});

describe('aggregate: recommendations', () => {
  it('produces no recommendations for zero analyzed games', () => {
    const games = [game({ analyzed: false })];
    const agg = aggregate(games);
    expect(agg.recommendations).toEqual([]);
  });

  it('flags heavy middlegame blundering as a high-severity recommendation', () => {
    const games = Array.from({ length: 3 }, () =>
      game({
        accuracy: { overall: 60, opening: 90, middlegame: 55, endgame: 90 },
        errors: { opening: errCounts(), middlegame: errCounts({ blunders: 2 }), endgame: errCounts() },
        result: 'loss',
        decisiveErrorPhase: 'middlegame',
      })
    );
    const agg = aggregate(games);
    const mg = agg.recommendations.find((r) => r.area === 'Middlegame calculation');
    expect(mg).toBeDefined();
    expect(mg!.severity).toBe('high');
  });

  it('sorts recommendations high severity first', () => {
    const games = [
      game({
        accuracy: { overall: 55, opening: 90, middlegame: 55, endgame: 90 },
        errors: { opening: errCounts(), middlegame: errCounts({ blunders: 3 }), endgame: errCounts() },
        result: 'loss',
        decisiveErrorPhase: 'middlegame',
      }),
      game({ timePressureBlunders: 3, clockDataAvailable: true }),
    ];
    const agg = aggregate(games);
    const severities = agg.recommendations.map((r) => r.severity);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i - 1]]).toBeLessThanOrEqual(order[severities[i]]);
    }
  });

  it('recommends checkmate-pattern work when mates were missed', () => {
    const wm: WorstMove = { moveNo: 20, san: 'Qh6', phase: 'endgame', kind: 'missed mate', winPctBefore: 90, winPctAfter: 60 };
    const games = [game({ missedMates: 1, worstMoves: [wm] })];
    const agg = aggregate(games);
    expect(agg.recommendations.some((r) => r.area === 'Checkmate patterns')).toBe(true);
  });

  it('recommends time management when time-pressure blunders are frequent', () => {
    const games = [game({ timePressureBlunders: 3, clockDataAvailable: true })];
    const agg = aggregate(games);
    expect(agg.recommendations.some((r) => r.area === 'Time management')).toBe(true);
  });

  it('every recommendation carries at least one drill', () => {
    const games = [
      game({
        accuracy: { overall: 55, opening: 55, middlegame: 55, endgame: 55 },
        errors: { opening: errCounts({ blunders: 1 }), middlegame: errCounts({ blunders: 1 }), endgame: errCounts({ blunders: 1 }) },
        result: 'loss',
      }),
    ];
    const agg = aggregate(games);
    expect(agg.recommendations.length).toBeGreaterThan(0);
    for (const r of agg.recommendations) expect(r.drills.length).toBeGreaterThan(0);
  });
});

describe('opponentList', () => {
  it('counts games per opponent, case-insensitively, most-played first', () => {
    const games = [
      game({ userColor: 'w', black: 'Bob' }),
      game({ userColor: 'w', black: 'bob' }),
      game({ userColor: 'b', white: 'Alice' }),
    ];
    const list = opponentList(games);
    expect(list[0]).toEqual({ opponent: 'Bob', games: 2 });
    expect(list.find((o) => o.opponent === 'Alice')?.games).toBe(1);
  });

  it('skips games with a blank opponent name', () => {
    const games = [game({ userColor: 'w', black: '' })];
    expect(opponentList(games)).toEqual([]);
  });
});

describe('headToHeadWithOpponent', () => {
  it('filters to games against the named opponent (case-insensitive) and computes W/D/L', () => {
    const games = [
      game({ userColor: 'w', black: 'Bob', result: 'win', date: '2026-01-01' }),
      game({ userColor: 'w', black: 'BOB', result: 'loss', date: '2026-01-02' }),
      game({ userColor: 'w', black: 'Someone Else', result: 'win' }),
    ];
    const h2h = headToHeadWithOpponent(games, 'bob');
    expect(h2h.games).toHaveLength(2);
    expect(h2h.wdl).toEqual({ games: 2, wins: 1, draws: 0, losses: 1 });
  });

  it('sorts matched games most-recent first', () => {
    const games = [
      game({ userColor: 'w', black: 'Bob', date: '2026-01-01' }),
      game({ userColor: 'w', black: 'Bob', date: '2026-03-01' }),
    ];
    const h2h = headToHeadWithOpponent(games, 'Bob');
    expect(h2h.games[0].date).toBe('2026-03-01');
  });
});
