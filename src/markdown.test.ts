import { describe, it, expect } from 'vitest';
import { renderMarkdown, parseMarkdownReport, mergeGames } from './markdown';
import type { Aggregates, WDL } from './aggregate';
import type { ErrCounts, GameRecord, ReportMeta } from './types';

function wdl(over: Partial<WDL> = {}): WDL {
  return { games: 0, wins: 0, draws: 0, losses: 0, ...over };
}

function errCounts(over: Partial<ErrCounts> = {}): ErrCounts {
  return { inaccuracies: 0, mistakes: 0, blunders: 0, ...over };
}

function minimalAggregates(over: Partial<Aggregates> = {}): Aggregates {
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
      errorsInWins: errCounts(), errorsInLosses: errCounts(),
      analyzedWins: 0, analyzedLosses: 0, narrative: [],
    },
    recommendations: [],
    analyzedCount: 0,
    ...over,
  };
}

let idCounter = 0;
function game(over: Partial<GameRecord> = {}): GameRecord {
  idCounter++;
  return {
    id: `g${idCounter}`,
    date: '2026-01-01',
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
    moveCount: 40,
    analyzed: false,
    evalSource: 'none',
    accuracy: { overall: null, opening: null, middlegame: null, endgame: null },
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

function meta(over: Partial<ReportMeta> = {}): ReportMeta {
  return {
    username: 'Hero',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessions: [{ date: '2026-01-01', gamesAdded: 2, source: 'lichess' }],
    ...over,
  };
}

describe('renderMarkdown + parseMarkdownReport: round trip', () => {
  it('embeds a data block that parses back to the same games and meta', () => {
    const games = [game({ id: 'g1' }), game({ id: 'g2', analyzed: true })];
    const md = renderMarkdown(minimalAggregates({ total: wdl({ games: 2, wins: 2 }) }), games, meta());
    const parsed = parseMarkdownReport(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.games.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(parsed!.meta.username).toBe('Hero');
  });

  it('includes the username in the report title and games-total count', () => {
    const md = renderMarkdown(minimalAggregates(), [game(), game()], meta({ username: 'ChessFan' }));
    expect(md).toContain('# Chess Performance Report — ChessFan');
    expect(md).toContain('2 games total');
  });

  it('renders a per-game assessment section only for analyzed games', () => {
    const unanalyzed = game({ analyzed: false });
    const md = renderMarkdown(minimalAggregates(), [unanalyzed], meta());
    expect(md).toContain('_No analyzed games yet._');
  });

  it('renders training recommendations when present', () => {
    const agg = minimalAggregates({
      recommendations: [{ area: 'Tactics', severity: 'high', why: 'Too many blunders.', themes: [{ name: 'fork', label: 'Forks' }], drills: ['Do puzzles'] }],
    });
    const md = renderMarkdown(agg, [], meta());
    expect(md).toContain('### Tactics — priority: HIGH');
    expect(md).toContain('Do puzzles');
  });
});

describe('parseMarkdownReport: malformed input', () => {
  it('returns null when the data markers are absent', () => {
    expect(parseMarkdownReport('# Just a regular markdown file\n\nNo embedded data here.')).toBeNull();
  });

  it('returns null when the embedded JSON is corrupted', () => {
    const bad = '<!-- chess-insight:data:v1\n{not valid json\nchess-insight:end -->';
    expect(parseMarkdownReport(bad)).toBeNull();
  });

  it('returns null when the version does not match', () => {
    const bad = `<!-- chess-insight:data:v1\n${JSON.stringify({ version: 2, meta: meta(), games: [] })}\nchess-insight:end -->`;
    expect(parseMarkdownReport(bad)).toBeNull();
  });
});

describe('mergeGames', () => {
  it('keeps games unique to each side', () => {
    const merged = mergeGames([game({ id: 'a' })], [game({ id: 'b' })]);
    expect(merged.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });

  it('prefers the analyzed version on an id collision', () => {
    const old = game({ id: 'a', analyzed: false, date: '2026-01-01' });
    const fresh = game({ id: 'a', analyzed: true, date: '2026-01-01' });
    const merged = mergeGames([old], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].analyzed).toBe(true);
  });

  it('does not overwrite an already-analyzed game with an unanalyzed duplicate', () => {
    const old = game({ id: 'a', analyzed: true, moveCount: 40 });
    const staleDup = game({ id: 'a', analyzed: false, moveCount: 999 });
    const merged = mergeGames([old], [staleDup]);
    expect(merged[0].analyzed).toBe(true);
    expect(merged[0].moveCount).toBe(40);
  });

  it('sorts the merged result by date', () => {
    const merged = mergeGames([game({ id: 'a', date: '2026-03-01' })], [game({ id: 'b', date: '2026-01-01' })]);
    expect(merged.map((g) => g.id)).toEqual(['b', 'a']);
  });
});
