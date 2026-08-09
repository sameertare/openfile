import type { ErrCounts, GameRecord, Phase, WorstMove } from './types';
import { LOSING_WINPCT, WINNING_WINPCT } from './analyze';
import { analyzeTimeByPhase, findBlunderClusters } from './advancedAnalysis';
import type { TimePhaseStats, BlunderCluster } from './advancedAnalysis';

export interface WDL {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export function scorePct(w: WDL): number {
  return w.games ? Math.round(((w.wins + 0.5 * w.draws) / w.games) * 1000) / 10 : 0;
}

export interface OpeningRow extends WDL {
  family: string;
  eco: string;
  asWhite: number;
  asBlack: number;
  avgAccuracy: number | null;
  avgOpeningAccuracy: number | null;
}

export interface PhaseStats {
  phase: Phase;
  avgAccuracy: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  blundersPerGame: number;
  decisiveErrorsInLosses: number; // losses whose decisive error fell in this phase
}

export interface Patterns {
  lostFromWinning: GameRecord[];
  drewFromWinning: GameRecord[];
  savedFromLosing: GameRecord[];
  conversionRate: number | null;  // of games where user hit >= WINNING_WINPCT, % won
  gamesReachedWinning: number;
  decisivePhaseInLosses: Record<Phase, number>;
  avgFirstErrorMove: number | null;
  timePressureBlunders: number;
  clockGames: number;
  endgameTypeCounts: Record<string, WDL>;
  errorsInWins: ErrCounts;
  errorsInLosses: ErrCounts;
  analyzedWins: number;
  analyzedLosses: number;
  narrative: string[];
}

export interface Recommendation {
  area: string;
  severity: 'high' | 'medium' | 'low';
  why: string;
  themes: { name: string; label: string }[]; // lichess puzzle theme keys
  drills: string[];
}

export interface Aggregates {
  total: WDL;
  byColor: { white: WDL; black: WDL };
  openings: OpeningRow[];
  strongest: OpeningRow[];
  weakest: OpeningRow[];
  byTimeClass: { timeClass: string; wdl: WDL; avgAccuracy: number | null }[];
  openingsByTimeClass: { timeClass: string; openings: OpeningRow[] }[];
  timeUsage: { moveNo: number; avgSec: number; games: number }[];
  errorsByMove: { moveNo: number; inaccuracies: number; mistakes: number; blunders: number }[];
  repertoireCoverage: { preparedGames: number; improvisedGames: number; coveragePct: number | null };
  phases: PhaseStats[];
  overallAccuracy: number | null;
  tactics: {
    missedWins: number;
    missedMates: number;
    missedTactics: number;
    blundersTotal: number;
    worstMoments: { game: GameRecord; move: GameRecord['worstMoves'][0] }[];
  };
  patterns: Patterns;
  recommendations: Recommendation[];
  analyzedCount: number;
  timeByPhase?: TimePhaseStats[];
  blunderClusters?: BlunderCluster[];
}

function emptyWDL(): WDL {
  return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function addResult(w: WDL, r: GameRecord) {
  if (r.result === 'unknown') return; // no decided outcome — don't count it as a win/draw/loss
  w.games++;
  if (r.result === 'win') w.wins++;
  else if (r.result === 'loss') w.losses++;
  else w.draws++;
}

function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
}

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

/** Builds the per-opening-family W/D/L + accuracy table for a set of games — shared between the
 *  overall breakdown and each per-time-class breakdown so the two stay consistent. */
function computeOpenings(games: GameRecord[]): OpeningRow[] {
  const openingMap = new Map<string, OpeningRow>();
  const analyzed = games.filter((g) => g.analyzed);
  for (const g of games) {
    let row = openingMap.get(g.family);
    if (!row) {
      row = {
        family: g.family, eco: g.eco, ...emptyWDL(),
        asWhite: 0, asBlack: 0, avgAccuracy: null, avgOpeningAccuracy: null,
      };
      openingMap.set(g.family, row);
    }
    addResult(row, g);
    if (g.userColor === 'w') row.asWhite++;
    else row.asBlack++;
    if (g.eco && !row.eco) row.eco = g.eco;
  }
  for (const row of openingMap.values()) {
    const inFam = analyzed.filter((g) => g.family === row.family);
    row.avgAccuracy = avg(inFam.map((g) => g.accuracy.overall).filter((x): x is number => x !== null));
    row.avgOpeningAccuracy = avg(inFam.map((g) => g.accuracy.opening).filter((x): x is number => x !== null));
  }
  return [...openingMap.values()].sort((a, b) => b.games - a.games);
}

export interface OpponentSummary {
  opponent: string; // as it appears in the games (first-seen casing)
  games: number;
}

/** Every opponent the loaded games' main player has faced, most-played first — case-insensitive
 *  dedupe so "bob" and "Bob" count as one opponent. Feeds the head-to-head opponent picker. */
export function opponentList(games: GameRecord[]): OpponentSummary[] {
  const map = new Map<string, OpponentSummary>();
  for (const g of games) {
    const opp = (g.userColor === 'w' ? g.black : g.white).trim();
    if (!opp) continue;
    const key = opp.toLowerCase();
    const existing = map.get(key);
    if (existing) existing.games++;
    else map.set(key, { opponent: opp, games: 1 });
  }
  return [...map.values()].sort((a, b) => b.games - a.games);
}

export interface HeadToHeadOpponent {
  opponent: string;
  wdl: WDL;
  openings: OpeningRow[];
  games: GameRecord[];
}

/** All games played against one specific opponent (by name, case-insensitive) — W/D/L, an
 *  opening breakdown for just that match-up, and the underlying game list, most recent first. */
export function headToHeadWithOpponent(games: GameRecord[], opponent: string): HeadToHeadOpponent {
  const key = opponent.trim().toLowerCase();
  const matched = games
    .filter((g) => (g.userColor === 'w' ? g.black : g.white).trim().toLowerCase() === key)
    .sort((a, b) => b.date.localeCompare(a.date));
  const wdl = emptyWDL();
  for (const g of matched) addResult(wdl, g);
  return { opponent, wdl, openings: computeOpenings(matched), games: matched };
}

export function aggregate(games: GameRecord[]): Aggregates {
  const total = emptyWDL();
  const byColor = { white: emptyWDL(), black: emptyWDL() };
  const tcMap = new Map<string, { wdl: WDL; accs: number[]; games: GameRecord[] }>();
  const analyzed = games.filter((g) => g.analyzed);

  for (const g of games) {
    addResult(total, g);
    addResult(g.userColor === 'w' ? byColor.white : byColor.black, g);

    let tc = tcMap.get(g.timeClass);
    if (!tc) {
      tc = { wdl: emptyWDL(), accs: [], games: [] };
      tcMap.set(g.timeClass, tc);
    }
    addResult(tc.wdl, g);
    if (g.accuracy.overall !== null) tc.accs.push(g.accuracy.overall);
    tc.games.push(g);
  }

  const openings = computeOpenings(games);
  const ranked = openings.filter((o) => o.games >= 2);
  const byScore = [...ranked].sort((a, b) => scorePct(b) - scorePct(a) || b.games - a.games);
  const strongest = byScore.filter((o) => scorePct(o) >= 50).slice(0, 5);
  const weakest = [...byScore].reverse().filter((o) => scorePct(o) < 50).slice(0, 5);

  // "Prepared" = an opening family played 2+ times (you've seen it before, presumably studied
  // it); everything else is a one-off/improvised line. A rough read on how much of your results
  // come from known prep vs. over-the-board improvisation.
  const preparedGames = ranked.reduce((s, o) => s + o.games, 0);
  const improvisedGames = games.length - preparedGames;
  const repertoireCoverage = {
    preparedGames,
    improvisedGames,
    coveragePct: games.length ? Math.round((preparedGames / games.length) * 1000) / 10 : null,
  };

  const openingsByTimeClass = [...tcMap.entries()]
    .map(([timeClass, v]) => ({ timeClass, openings: computeOpenings(v.games) }))
    .filter((t) => t.openings.length > 0);

  // Average seconds left on the clock by move number, across every game with clock data —
  // surfaces whether time trouble tends to hit at a particular stage of the game rather than
  // being spread evenly. `?? []` guards report.md files saved before this field existed.
  const timeUsageMap = new Map<number, { sum: number; count: number }>();
  for (const g of games) {
    for (const entry of g.clockSeries ?? []) {
      let bucket = timeUsageMap.get(entry.moveNo);
      if (!bucket) {
        bucket = { sum: 0, count: 0 };
        timeUsageMap.set(entry.moveNo, bucket);
      }
      bucket.sum += entry.sec;
      bucket.count++;
    }
  }
  const timeUsage = [...timeUsageMap.entries()]
    .map(([moveNo, v]) => ({ moveNo, avgSec: Math.round((v.sum / v.count) * 10) / 10, games: v.count }))
    .sort((a, b) => a.moveNo - b.moveNo);

  // Where in the game (by move number) errors actually happen — more granular than the
  // opening/middlegame/endgame phase split, useful for spotting e.g. "most blunders land around
  // move 20" regardless of which phase that fell in for a given game.
  const errorsByMoveMap = new Map<number, { inaccuracies: number; mistakes: number; blunders: number }>();
  for (const g of games) {
    for (const entry of g.errorSeries ?? []) {
      let bucket = errorsByMoveMap.get(entry.moveNo);
      if (!bucket) {
        bucket = { inaccuracies: 0, mistakes: 0, blunders: 0 };
        errorsByMoveMap.set(entry.moveNo, bucket);
      }
      bucket[entry.kind === 'blunder' ? 'blunders' : entry.kind === 'mistake' ? 'mistakes' : 'inaccuracies']++;
    }
  }
  const errorsByMove = [...errorsByMoveMap.entries()]
    .map(([moveNo, v]) => ({ moveNo, ...v }))
    .sort((a, b) => a.moveNo - b.moveNo);

  // Phase stats
  const phases: PhaseStats[] = PHASES.map((phase) => {
    const accs = analyzed
      .map((g) => g.accuracy[phase])
      .filter((x): x is number => x !== null);
    let inacc = 0, mist = 0, blund = 0, decisive = 0;
    for (const g of analyzed) {
      inacc += g.errors[phase].inaccuracies;
      mist += g.errors[phase].mistakes;
      blund += g.errors[phase].blunders;
      if (g.result === 'loss' && g.decisiveErrorPhase === phase) decisive++;
    }
    return {
      phase,
      avgAccuracy: avg(accs),
      inaccuracies: inacc,
      mistakes: mist,
      blunders: blund,
      blundersPerGame: analyzed.length ? Math.round((blund / analyzed.length) * 100) / 100 : 0,
      decisiveErrorsInLosses: decisive,
    };
  });

  const overallAccuracy = avg(
    analyzed.map((g) => g.accuracy.overall).filter((x): x is number => x !== null)
  );

  // Tactics
  const worstMoments = analyzed
    .flatMap((g) => g.worstMoves.map((m) => ({ game: g, move: m })))
    .sort((a, b) => (b.move.winPctBefore - b.move.winPctAfter) - (a.move.winPctBefore - a.move.winPctAfter))
    .slice(0, 10);
  const tactics = {
    missedWins: analyzed.reduce((s, g) => s + g.missedWins, 0),
    missedMates: analyzed.reduce((s, g) => s + g.missedMates, 0),
    missedTactics: analyzed.reduce((s, g) => s + g.missedTactics, 0),
    blundersTotal: phases.reduce((s, p) => s + p.blunders, 0),
    worstMoments,
  };

  // Patterns
  const lostFromWinning = analyzed.filter((g) => g.lostFromWinning);
  const drewFromWinning = analyzed.filter((g) => g.drewFromWinning);
  const savedFromLosing = analyzed.filter((g) => g.savedFromLosing);
  const reachedWinning = analyzed.filter((g) => g.bestWinPct >= WINNING_WINPCT);
  const conversionRate = reachedWinning.length
    ? Math.round((reachedWinning.filter((g) => g.result === 'win').length / reachedWinning.length) * 100)
    : null;
  const decisivePhaseInLosses: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  for (const g of analyzed) {
    if (g.result === 'loss' && g.decisiveErrorPhase) decisivePhaseInLosses[g.decisiveErrorPhase]++;
  }
  const firstErrs = analyzed.map((g) => g.firstErrorMove).filter((x): x is number => x !== null);
  const clockGames = games.filter((g) => g.clockDataAvailable).length;
  const timePressureBlunders = games.reduce((s, g) => s + g.timePressureBlunders, 0);

  const endgameTypeCounts: Record<string, WDL> = {};
  for (const g of games) {
    if (g.reachedEndgame && g.endgameType) {
      endgameTypeCounts[g.endgameType] ??= emptyWDL();
      addResult(endgameTypeCounts[g.endgameType], g);
    }
  }

  const errorsInWins: ErrCounts = { inaccuracies: 0, mistakes: 0, blunders: 0 };
  const errorsInLosses: ErrCounts = { inaccuracies: 0, mistakes: 0, blunders: 0 };
  let analyzedWins = 0, analyzedLosses = 0;
  for (const g of analyzed) {
    const bucket = g.result === 'win' ? errorsInWins : g.result === 'loss' ? errorsInLosses : null;
    if (g.result === 'win') analyzedWins++;
    if (g.result === 'loss') analyzedLosses++;
    if (!bucket) continue;
    for (const p of PHASES) {
      bucket.inaccuracies += g.errors[p].inaccuracies;
      bucket.mistakes += g.errors[p].mistakes;
      bucket.blunders += g.errors[p].blunders;
    }
  }

  const narrative = buildNarrative({
    analyzed, lostFromWinning, savedFromLosing, conversionRate,
    reachedWinning: reachedWinning.length, decisivePhaseInLosses,
    phases, timePressureBlunders, clockGames, total,
  });

  const patterns: Patterns = {
    lostFromWinning, drewFromWinning, savedFromLosing, conversionRate,
    gamesReachedWinning: reachedWinning.length,
    decisivePhaseInLosses,
    avgFirstErrorMove: avg(firstErrs),
    timePressureBlunders, clockGames, endgameTypeCounts,
    errorsInWins, errorsInLosses, analyzedWins, analyzedLosses,
    narrative,
  };

  const recommendations = recommend(phases, tactics, patterns, weakest, analyzed);

  // Advanced analysis: time pressure, blunder clustering.
  const timeByPhase = analyzeTimeByPhase(games);
  const blunderClusters = findBlunderClusters(games);

  return {
    total, byColor, openings, strongest, weakest,
    byTimeClass: [...tcMap.entries()]
      .map(([timeClass, v]) => ({ timeClass, wdl: v.wdl, avgAccuracy: avg(v.accs) }))
      .sort((a, b) => b.wdl.games - a.wdl.games),
    openingsByTimeClass: openingsByTimeClass.sort(
      (a, b) => b.openings.reduce((s, o) => s + o.games, 0) - a.openings.reduce((s, o) => s + o.games, 0)
    ),
    timeUsage,
    errorsByMove,
    repertoireCoverage,
    phases, overallAccuracy, tactics, patterns, recommendations,
    analyzedCount: analyzed.length,
    timeByPhase,
    blunderClusters,
  };
}

function buildNarrative(ctx: {
  analyzed: GameRecord[];
  lostFromWinning: GameRecord[];
  savedFromLosing: GameRecord[];
  conversionRate: number | null;
  reachedWinning: number;
  decisivePhaseInLosses: Record<Phase, number>;
  phases: PhaseStats[];
  timePressureBlunders: number;
  clockGames: number;
  total: WDL;
}): string[] {
  const out: string[] = [];
  const losses = ctx.analyzed.filter((g) => g.result === 'loss');
  const decisiveTotal = PHASES.reduce((s, p) => s + ctx.decisivePhaseInLosses[p], 0);

  if (decisiveTotal > 0) {
    const worstPhase = PHASES.reduce((a, b) =>
      ctx.decisivePhaseInLosses[a] >= ctx.decisivePhaseInLosses[b] ? a : b
    );
    const n = ctx.decisivePhaseInLosses[worstPhase];
    if (n / decisiveTotal >= 0.5 && n >= 2) {
      out.push(
        `**Loss pattern:** in ${n} of ${decisiveTotal} losses with an identifiable turning point, the decisive mistake came in the **${worstPhase}**. Positions were equal or better before that point — this phase is where games are being given away.`
      );
    } else {
      const parts = PHASES.filter((p) => ctx.decisivePhaseInLosses[p] > 0)
        .map((p) => `${ctx.decisivePhaseInLosses[p]} in the ${p}`);
      out.push(`**Where losses originate:** ${parts.join(', ')} (out of ${losses.length} analyzed losses).`);
    }
  }

  if (ctx.lostFromWinning.length > 0) {
    out.push(
      `**Thrown wins:** ${ctx.lostFromWinning.length} game(s) were lost after reaching a winning position (≥${WINNING_WINPCT}% win chance). Conversion of winning positions is currently ${ctx.conversionRate ?? '—'}% (${ctx.reachedWinning} games reached winning positions).`
    );
  } else if (ctx.conversionRate !== null && ctx.reachedWinning >= 3) {
    out.push(
      `**Conversion:** of ${ctx.reachedWinning} games that reached a winning position, ${ctx.conversionRate}% were won.` +
      (ctx.conversionRate >= 80 ? ' Converting well — keep it up.' : ' There is room to convert more of these.')
    );
  }

  if (ctx.savedFromLosing.length > 0) {
    out.push(
      `**Resilience:** ${ctx.savedFromLosing.length} game(s) were saved (draw or win) from losing positions (≤${LOSING_WINPCT}% win chance) — good fighting spirit.`
    );
  }

  const withAcc = ctx.phases.filter((p) => p.avgAccuracy !== null);
  if (withAcc.length >= 2) {
    const weakest = withAcc.reduce((a, b) => (a.avgAccuracy! <= b.avgAccuracy! ? a : b));
    const strongest = withAcc.reduce((a, b) => (a.avgAccuracy! >= b.avgAccuracy! ? a : b));
    if (strongest.avgAccuracy! - weakest.avgAccuracy! >= 5) {
      out.push(
        `**Phase gap:** strongest phase is the **${strongest.phase}** (${strongest.avgAccuracy}% accuracy), weakest is the **${weakest.phase}** (${weakest.avgAccuracy}%). A ${Math.round(strongest.avgAccuracy! - weakest.avgAccuracy!)}-point gap is worth targeted training.`
      );
    }
  }

  if (ctx.clockGames > 0 && ctx.timePressureBlunders >= 2) {
    out.push(
      `**Time trouble:** ${ctx.timePressureBlunders} serious errors were played with under 30 seconds on the clock. Consider faster decisions in the opening/middlegame to bank time, or longer time controls for training.`
    );
  }
  return out;
}

const THEME_LABELS: Record<string, string> = {
  hangingPiece: 'Hanging pieces',
  fork: 'Forks',
  pin: 'Pins',
  skewer: 'Skewers',
  discoveredAttack: 'Discovered attacks',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mate: 'Checkmate patterns',
  backRankMate: 'Back-rank mates',
  advantage: 'Convert an advantage',
  crushing: 'Crushing (winning material)',
  defensiveMove: 'Defensive moves',
  endgame: 'Endgames (all)',
  rookEndgame: 'Rook endgames',
  pawnEndgame: 'Pawn endgames',
  queenEndgame: 'Queen endgames',
  knightEndgame: 'Knight endgames',
  bishopEndgame: 'Bishop endgames',
  middlegame: 'Middlegame positions',
  opening: 'Opening-phase puzzles',
  quietMove: 'Quiet moves',
  zugzwang: 'Zugzwang',
};

export function themeUrl(theme: string): string {
  return `https://lichess.org/training/${theme}`;
}
export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme;
}

/** Finds the single most damaging recorded moment (biggest win% swing), optionally filtered to a
 *  phase and/or a subset of WorstMove kinds — used to ground a recommendation in one of the
 *  player's own games (opponent, date, exact move) instead of interchangeable generic advice. */
function worstMoment(
  analyzed: GameRecord[],
  opts: { phase?: Phase; kinds?: WorstMove['kind'][] } = {}
): { game: GameRecord; move: WorstMove } | null {
  let best: { game: GameRecord; move: WorstMove } | null = null;
  let bestSwing = -Infinity;
  for (const g of analyzed) {
    for (const m of g.worstMoves) {
      if (opts.phase && m.phase !== opts.phase) continue;
      if (opts.kinds && !opts.kinds.includes(m.kind)) continue;
      const swing = m.winPctBefore - m.winPctAfter;
      if (swing > bestSwing) { bestSwing = swing; best = { game: g, move: m }; }
    }
  }
  return best;
}

function describeMoment(m: { game: GameRecord; move: WorstMove }): string {
  const opp = (m.game.userColor === 'w' ? m.game.black : m.game.white) || 'your opponent';
  const when = m.game.date || 'an undated game';
  const bestNote = m.move.best ? `, ${m.move.best} was correct` : '';
  return `vs ${opp} (${when}), move ${m.move.moveNo} ${m.move.san}${bestNote}`;
}

/** Absolute badness — deliberately NOT relative to the other two phases. A phase can be someone's
 *  numerically weakest of the three while still costing them nothing (no blunders, no losses
 *  decided there); comparing phases only against each other used to mark that "high priority"
 *  just for being the least-good of three otherwise-fine numbers. */
function phaseSeverity(p: PhaseStats): Recommendation['severity'] {
  if (p.decisiveErrorsInLosses >= 2 || p.blundersPerGame >= 1) return 'high';
  if (p.decisiveErrorsInLosses >= 1 || p.blunders >= 1 || (p.avgAccuracy !== null && p.avgAccuracy < 75)) return 'medium';
  return 'low';
}

function recommend(
  phases: PhaseStats[],
  tactics: Aggregates['tactics'],
  patterns: Patterns,
  weakest: OpeningRow[],
  analyzed: GameRecord[]
): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!analyzed.length) return recs;
  const t = (names: string[]) => names.map((n) => ({ name: n, label: themeLabel(n) }));
  const swingPct = (m: WorstMove) => Math.round(m.winPctBefore - m.winPctAfter);

  const withAcc = phases.filter((p) => p.avgAccuracy !== null);
  const weakestPhase = withAcc.length
    ? withAcc.reduce((a, b) => (a.avgAccuracy! <= b.avgAccuracy! ? a : b))
    : null;

  if (weakestPhase?.phase === 'endgame' || phases[2].blunders >= 3) {
    const p = phases[2];
    const sev = phaseSeverity(p);
    const totalErr = p.inaccuracies + p.mistakes + p.blunders;
    const egTypes = Object.entries(patterns.endgameTypeCounts).sort((a, b) => b[1].games - a[1].games);
    const commonType = egTypes[0]?.[0];
    const themes = ['endgame'];
    for (const [type] of egTypes.slice(0, 2)) {
      if (type.startsWith('Rook')) themes.push('rookEndgame');
      else if (type.startsWith('Pawn')) themes.push('pawnEndgame');
      else if (type.startsWith('Queen')) themes.push('queenEndgame');
      else if (type.startsWith('Minor')) themes.push('bishopEndgame', 'knightEndgame');
    }
    let why: string, drills: string[];
    if (sev === 'low') {
      why = `Endgame accuracy is ${p.avgAccuracy ?? '—'}% with no blunders and no losses decided here` +
        (totalErr > 0 ? `, just ${totalErr} minor error(s) across ${analyzed.length} analyzed game(s)` : '') +
        `. This phase isn't where your points are going.`;
      drills = [
        'A light monthly review is enough here — no dedicated drilling needed right now.',
        commonType ? `Your most common endgame is ${commonType}; a quick refresh of its key technique keeps it sharp.` : 'Keep an eye on whichever endgame type comes up most in your games.',
      ];
    } else {
      why = `Endgame accuracy is ${p.avgAccuracy ?? '—'}%, with ${p.blunders} blunder(s), ${p.mistakes} mistake(s) and ${p.inaccuracies} inaccuracy(ies) across ${analyzed.length} analyzed game(s). ${p.decisiveErrorsInLosses} loss(es) were decided here` +
        (commonType ? `; the endgame type you reach most is ${commonType}.` : '.');
      const worst = worstMoment(analyzed, { phase: 'endgame' });
      drills = [
        'Practice K+P vs K opposition and the "square of the pawn" until automatic.',
        'Learn the Lucena and Philidor rook-endgame positions.',
      ];
      drills.push(worst
        ? `Start with your own worst moment: ${describeMoment(worst)} — cost ${swingPct(worst.move)}% win probability.`
        : 'Play out won endgames vs an engine from your own games.');
    }
    recs.push({ area: 'Endgame technique', severity: sev, why, themes: t([...new Set(themes)]), drills });
  }

  if (weakestPhase?.phase === 'middlegame' || phases[1].blunders >= 3) {
    const p = phases[1];
    const sev = phaseSeverity(p);
    const totalErr = p.inaccuracies + p.mistakes + p.blunders;
    let why: string, drills: string[];
    if (sev === 'low') {
      why = `Middlegame accuracy is ${p.avgAccuracy ?? '—'}% with no blunders and no losses decided here` +
        (totalErr > 0 ? `, just ${totalErr} minor error(s) across ${analyzed.length} analyzed game(s)` : '') +
        `. Despite being your relatively weakest phase, it isn't actually costing you games.`;
      drills = [
        'No dedicated drilling needed — this is already solid; revisit only if accuracy drops.',
        'If you want to sharpen further anyway, 5–10 minutes of mixed tactics a week is plenty.',
      ];
    } else {
      why = `Middlegame accuracy is ${p.avgAccuracy ?? '—'}%, with ${p.blunders} blunder(s), ${p.mistakes} mistake(s) and ${p.inaccuracies} inaccuracy(ies) across ${analyzed.length} analyzed game(s). ${p.decisiveErrorsInLosses} loss(es) were decided here` +
        (p.blundersPerGame > 0 ? `, roughly 1 blunder every ${Math.round(1 / p.blundersPerGame)} game(s) in this phase.` : '.');
      const worst = worstMoment(analyzed, { phase: 'middlegame' });
      drills = ['Before every move, run a blunder check: "What are ALL checks, captures, and threats against me?"'];
      drills.push(worst
        ? `Start by annotating your worst middlegame moment: ${describeMoment(worst)} — a ${swingPct(worst.move)}% swing.`
        : 'Annotate one of your middlegame losses per week without an engine first.');
      drills.push('Do 15 minutes of mixed tactics daily at slow pace — accuracy over speed.');
    }
    recs.push({ area: 'Middlegame calculation', severity: sev, why, themes: t(['middlegame', 'fork', 'pin', 'discoveredAttack', 'hangingPiece']), drills });
  }

  if (weakestPhase?.phase === 'opening' || phases[0].blunders + phases[0].mistakes >= 3 || weakest.length > 0) {
    const p = phases[0];
    const sev = phaseSeverity(p);
    const openingList = weakest.slice(0, 3).map((o) => `${o.family} (${o.wins}W-${o.draws}D-${o.losses}L)`).join(', ');
    let why = `Opening accuracy is ${p.avgAccuracy ?? '—'}%` +
      (p.blunders || p.mistakes ? `, with ${p.blunders} blunder(s) and ${p.mistakes} mistake(s) in this phase` : '') +
      '.' + (openingList ? ` Worst-scoring openings: ${openingList}.` : '');
    const drills: string[] = [];
    if (openingList) {
      drills.push(`Start with your worst-scoring opening: ${weakest[0].family} (${weakest[0].wins}W-${weakest[0].draws}D-${weakest[0].losses}L) — review those losses before anything else.`);
    }
    if (sev === 'low' && !openingList) {
      why += ' No real weak spot here — opening prep is not the priority right now.';
      drills.push('No dedicated opening work needed — keep playing what you know.');
    } else {
      drills.push('Pick ONE reply to 1.e4 and ONE to 1.d4 and build a 6–8 move repertoire file.');
      drills.push('After every loss, check where the game left your known theory and learn one move deeper.');
    }
    recs.push({ area: 'Opening preparation', severity: sev, why, themes: t(['opening']), drills });
  }

  if (tactics.missedMates >= 1) {
    const worst = worstMoment(analyzed, { kinds: ['missed mate'] });
    const drills = ['Do 10 mate-in-1 and 10 mate-in-2 puzzles daily for two weeks — pattern recognition compounds fast.'];
    if (worst) drills.unshift(`You missed one ${describeMoment(worst)} — worth re-solving until the pattern is instant.`);
    recs.push({
      area: 'Checkmate patterns',
      severity: tactics.missedMates >= 3 ? 'high' : 'medium',
      why: `${tactics.missedMates} forced mate(s) were missed in analyzed games` + (worst ? ` — the clearest was ${describeMoment(worst)}.` : '.'),
      themes: t(['mateIn1', 'mateIn2', 'backRankMate', 'mate']),
      drills,
    });
  }

  if (tactics.missedTactics >= 2 || tactics.blundersTotal >= 3) {
    const worst = worstMoment(analyzed, { kinds: ['blunder'] });
    recs.push({
      area: 'Tactical awareness & board vision',
      severity: 'high',
      why: `${tactics.blundersTotal} blunder(s) and ${tactics.missedTactics} missed tactic(s) (engine's best move was a capture/check that went unplayed)` +
        (worst ? ` — the costliest was ${describeMoment(worst)}, a ${swingPct(worst.move)}% swing.` : '.'),
      themes: t(['hangingPiece', 'fork', 'skewer', 'crushing']),
      drills: [
        'Adopt a pre-move checklist: checks, captures, threats — for BOTH sides.',
        'Puzzle Streak / Puzzle Rush 5 minutes daily.',
      ],
    });
  }

  if (patterns.lostFromWinning.length >= 1 || (patterns.conversionRate !== null && patterns.conversionRate < 70 && patterns.gamesReachedWinning >= 3)) {
    const example = patterns.lostFromWinning[0];
    const exampleNote = example
      ? ` Worst case: your game vs ${(example.userColor === 'w' ? example.black : example.white) || 'your opponent'} (${example.date || 'undated'}) reached ${example.bestWinPct}% before slipping away.`
      : '';
    recs.push({
      area: 'Converting winning positions',
      severity: patterns.lostFromWinning.length >= 2 ? 'high' : 'medium',
      why: `${patterns.lostFromWinning.length} win(s) thrown away; conversion rate from winning positions is ${patterns.conversionRate ?? '—'}%.` + exampleNote,
      themes: t(['advantage', 'crushing', 'defensiveMove', 'quietMove']),
      drills: [
        'When winning: trade pieces, not pawns; keep asking "what is my opponent\'s only hope?"',
        'Play out +2 positions from your games vs an engine until you win 5 in a row.',
      ],
    });
  }

  if (patterns.timePressureBlunders >= 2) {
    recs.push({
      area: 'Time management',
      severity: 'medium',
      why: `${patterns.timePressureBlunders} serious error(s) came with under 30s on the clock` + (patterns.clockGames ? ` across ${patterns.clockGames} game(s) with clock data.` : '.'),
      themes: t(['middlegame']),
      drills: [
        'Set a personal rule: never below 50% of the opponent\'s clock before move 20.',
        'Train at one time control slower than your usual (e.g. 15+10 instead of 10+0).',
      ],
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
