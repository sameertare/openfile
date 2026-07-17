/** Advanced analysis features: move time analysis, blunder clustering, opening prep stats. */

import type { GameRecord } from './types';

export interface TimePhaseStats {
  phase: 'opening' | 'middlegame' | 'endgame';
  avgSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  movesUnderThreshold: number;  // moves with <30s
  totalMoves: number;
}

export interface BlunderCluster {
  moveRange: [number, number];   // move numbers where blunders clustered
  count: number;
  phase: 'opening' | 'middlegame' | 'endgame' | 'mixed';
}

export interface OpeningPrepStats {
  opening: string;
  family: string;
  totalGames: number;
  practiceGames: number;      // games where opening was analyzed/studied
  ratedGames: number;         // games from actual events
  winRate: number;            // score %
}

/** Analyze time distribution across game phases from clock series. */
export function analyzeTimeByPhase(games: GameRecord[]): TimePhaseStats[] {
  const phases: Record<string, { times: number[]; moveCount: number }> = {
    opening: { times: [], moveCount: 0 },
    middlegame: { times: [], moveCount: 0 },
    endgame: { times: [], moveCount: 0 },
  };

  for (const g of games) {
    if (!g.clockDataAvailable || !g.clockSeries.length) continue;
    for (const { moveNo, sec } of g.clockSeries) {
      // Determine phase from error series position.
      let phase: 'opening' | 'middlegame' | 'endgame' = 'middlegame';
      // This is a simple heuristic; ideally would use the actual phase data.
      if (moveNo <= 12) phase = 'opening';
      else if (moveNo > 18) phase = 'endgame';

      phases[phase].times.push(sec);
      phases[phase].moveCount++;
    }
  }

  return Object.entries(phases).map(([phase, data]) => {
    const times = data.times;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const underThreshold = times.filter((t) => t < 30).length;
    return {
      phase: phase as 'opening' | 'middlegame' | 'endgame',
      avgSeconds: Math.round(avg),
      minSeconds: times.length ? Math.min(...times) : 0,
      maxSeconds: times.length ? Math.max(...times) : 0,
      movesUnderThreshold: underThreshold,
      totalMoves: data.moveCount,
    };
  });
}

/** Detect clustering of blunders by move number. */
export function findBlunderClusters(games: GameRecord[]): BlunderCluster[] {
  const blundersByMove = new Map<number, number>();
  for (const g of games) {
    for (const err of g.errorSeries) {
      if (err.kind === 'blunder') {
        blundersByMove.set(err.moveNo, (blundersByMove.get(err.moveNo) ?? 0) + 1);
      }
    }
  }

  if (!blundersByMove.size) return [];

  const moves = Array.from(blundersByMove.keys()).sort((a, b) => a - b);
  const clusters: BlunderCluster[] = [];
  let currentCluster: number[] = [moves[0]];

  for (let i = 1; i < moves.length; i++) {
    // Cluster if within 2 moves of the previous, or if same phase.
    if (moves[i] - moves[i - 1] <= 2) {
      currentCluster.push(moves[i]);
    } else {
      // Finalize current cluster if it has 2+ blunders.
      if (currentCluster.length >= 1) {
        const total = currentCluster.reduce((sum, m) => sum + (blundersByMove.get(m) ?? 0), 0);
        if (total >= 2) {
          const phase = currentCluster[0] <= 12 ? 'opening' : currentCluster[0] <= 18 ? 'middlegame' : 'endgame';
          clusters.push({
            moveRange: [currentCluster[0], currentCluster[currentCluster.length - 1]],
            count: total,
            phase,
          });
        }
      }
      currentCluster = [moves[i]];
    }
  }

  // Finalize the last cluster.
  if (currentCluster.length >= 1) {
    const total = currentCluster.reduce((sum, m) => sum + (blundersByMove.get(m) ?? 0), 0);
    if (total >= 2) {
      const phase = currentCluster[0] <= 12 ? 'opening' : currentCluster[0] <= 18 ? 'middlegame' : 'endgame';
      clusters.push({
        moveRange: [currentCluster[0], currentCluster[currentCluster.length - 1]],
        count: total,
        phase,
      });
    }
  }

  return clusters;
}

/** Analyze which openings have been practiced (studied/analyzed) vs played in rated events. */
export function analyzeOpeningPrep(games: GameRecord[]): OpeningPrepStats[] {
  const openings = new Map<string, { total: number; practice: number; rated: number; scores: number[] }>();

  for (const g of games) {
    const key = `${g.family}|${g.opening}`;
    if (!openings.has(key)) {
      openings.set(key, { total: 0, practice: 0, rated: 0, scores: [] });
    }
    const stat = openings.get(key)!;
    stat.total++;

    // Classify as practice or rated based on event/site heuristics.
    const isPractice = g.event?.toLowerCase().includes('practice') || g.site?.toLowerCase().includes('practice');
    const isRated = g.event?.toLowerCase().includes('tournament') || /\d+/.test(g.event ?? '');
    if (isPractice) stat.practice++;
    if (isRated) stat.rated++;

    // Score: 1 for win, 0.5 for draw, 0 for loss.
    const score = g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
    stat.scores.push(score);
  }

  return Array.from(openings.entries()).map(([key, stat]) => {
    const [family, opening] = key.split('|');
    const winRate = stat.scores.length ? (stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length) * 100 : 0;
    return {
      opening,
      family,
      totalGames: stat.total,
      practiceGames: stat.practice,
      ratedGames: stat.rated,
      winRate: Math.round(winRate),
    };
  });
}
