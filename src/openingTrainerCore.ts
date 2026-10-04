/**
 * Pure logic behind the Opening Trainer — scoring, per-line progress/status, the arrow-fade
 * schedule, move-quality grading, picking the next line, and stats import/export validation.
 * No DOM, no localStorage I/O (src/openingTrainer.ts owns persistence and UI).
 */

// ---------- move quality ----------
export type Quality = 'good' | 'inaccurate' | 'mistake' | 'blunder';

/** Centipawns lost versus the best move, from the mover's point of view. */
export function classifyLoss(lossCp: number): Quality {
  if (lossCp <= 40) return 'good';
  if (lossCp <= 100) return 'inaccurate';
  if (lossCp <= 250) return 'mistake';
  return 'blunder';
}

/** `bestCp` = eval (mover's POV) after the engine's best move; `playedCp` = eval (mover's POV)
 *  after the move actually played. Never negative — a move better than "best" just rates good. */
export function lossBetween(bestCp: number, playedCp: number): number {
  return Math.min(2000, Math.max(0, bestCp - playedCp));
}

// ---------- progress ----------
export interface LineProgress {
  /** Times the line has been started (each start is one "viewing"). */
  views: number;
  /** Times completed with no mistakes. */
  clean: number;
  /** Consecutive clean completions made with the arrows hidden for every one of your moves — i.e. from memory. */
  memoryStreak: number;
  lastSeen: string; // YYYY-MM-DD
}

export interface Stats {
  /** Points earned per local day. */
  days: Record<string, number>;
  lines: Record<string, LineProgress>;
  priority: Record<string, boolean>;
}

export function emptyStats(): Stats {
  return { days: {}, lines: {}, priority: {} };
}

export const MEMORY_STREAK_NEEDED = 3;

export type LineStatus = 'new' | 'learning' | 'memory';
export const STATUS_TAG: Record<LineStatus, string> = { new: '☆', learning: '◐', memory: '★' };
export const STATUS_LABEL: Record<LineStatus, string> = { new: 'new', learning: 'learning', memory: 'from memory' };

export function lineStatus(p: LineProgress | undefined): LineStatus {
  if (!p || p.views === 0) return 'new';
  return p.memoryStreak >= MEMORY_STREAK_NEEDED ? 'memory' : 'learning';
}

/** An opening is "from memory" only when every one of its lines is; "new" only when none has been started. */
export function openingStatus(lineIds: string[], stats: Stats): LineStatus {
  const statuses = lineIds.map((id) => lineStatus(stats.lines[id]));
  if (statuses.length && statuses.every((s) => s === 'memory')) return 'memory';
  if (statuses.every((s) => s === 'new')) return 'new';
  return 'learning';
}

export function recordStart(stats: Stats, lineId: string, today: string): void {
  const p = (stats.lines[lineId] ??= { views: 0, clean: 0, memoryStreak: 0, lastSeen: today });
  p.views++;
  p.lastSeen = today;
}

/** `clean` = no mistakes; `fromMemory` = no arrow was visible for any of your moves. */
export function recordCompletion(stats: Stats, lineId: string, clean: boolean, fromMemory: boolean, today: string): void {
  const p = (stats.lines[lineId] ??= { views: 1, clean: 0, memoryStreak: 0, lastSeen: today });
  p.lastSeen = today;
  if (clean) {
    p.clean++;
    p.memoryStreak = fromMemory ? p.memoryStreak + 1 : 0;
  } else {
    p.memoryStreak = 0;
  }
}

// ---------- scoring ----------
/** 3 points for a first-try book move with no arrow showing (recalled), 1 with an arrow, 0 on a retry. */
export function movePoints(arrowVisible: boolean, firstTry: boolean): number {
  if (!firstTry) return 0;
  return arrowVisible ? 1 : 3;
}
export const CLEAN_COMPLETION_BONUS = 5;

export function addPoints(stats: Stats, today: string, pts: number): void {
  if (pts <= 0) return;
  stats.days[today] = (stats.days[today] ?? 0) + pts;
}

export interface ScoreSummary { today: number; bestDay: number; allTime: number; daysPracticed: number }
export function scoreSummary(stats: Stats, today: string): ScoreSummary {
  const vals = Object.values(stats.days);
  return {
    today: stats.days[today] ?? 0,
    bestDay: vals.length ? Math.max(...vals) : 0,
    allTime: vals.reduce((a, b) => a + b, 0),
    daysPracticed: vals.filter((v) => v > 0).length,
  };
}

// ---------- arrow fade ----------
export const FADE_STEPS = 4; // viewings (after the full ones) until every arrow is gone

/**
 * Whether the blue book-move arrow shows on your `userMoveIndex`-th move (0-based) of
 * `userMoveCount`. The first `fadeAfter` viewings show an arrow on every move; after that the
 * earliest moves lose their arrow first, a quarter of the line more each viewing, until none show.
 */
export function arrowVisible(viewing: number, fadeAfter: number, userMoveIndex: number, userMoveCount: number): boolean {
  if (viewing <= fadeAfter) return true;
  const hiddenFraction = Math.min(1, (viewing - fadeAfter) / FADE_STEPS);
  return userMoveIndex >= Math.ceil(hiddenFraction * userMoveCount);
}

export function viewingLabel(viewing: number, fadeAfter: number): string {
  return viewing <= fadeAfter
    ? `Viewing ${viewing} of ${fadeAfter}: arrows on every move.`
    : `Viewing ${viewing}: arrows are fading — recall the rest from memory.`;
}

// ---------- picking the next line ----------
export interface Candidate { lineId: string; openingId: string }

/**
 * Picks the next line to practice. Lines from a flagged-Priority opening are 4x as likely, never-
 * started lines 3x; with `leastStudiedFirst` the candidates are narrowed to those with the fewest
 * viewings first. `exclude` (the line just finished) is skipped unless it's the only choice.
 */
export function pickLine(
  candidates: Candidate[],
  stats: Stats,
  opts: { leastStudiedFirst: boolean; exclude?: string; rng?: () => number }
): Candidate | null {
  const rng = opts.rng ?? Math.random;
  let pool = candidates.filter((c) => c.lineId !== opts.exclude);
  if (!pool.length) pool = candidates;
  if (!pool.length) return null;
  if (opts.leastStudiedFirst) {
    const fewest = Math.min(...pool.map((c) => stats.lines[c.lineId]?.views ?? 0));
    pool = pool.filter((c) => (stats.lines[c.lineId]?.views ?? 0) === fewest);
  }
  const weights = pool.map((c) => (stats.priority[c.openingId] ? 4 : 1) * ((stats.lines[c.lineId]?.views ?? 0) === 0 ? 3 : 1));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ---------- import / export ----------
export const STATS_VERSION = 1;

export function exportStats(stats: Stats): string {
  return JSON.stringify({ version: STATS_VERSION, ...stats }, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Parses an exported stats file, rejecting anything that isn't the exact shape (so a hand-edited or
 *  wrong file can't corrupt saved progress). Returns null on any problem. */
export function parseStats(text: string): Stats | null {
  let data: any;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || data.version !== STATS_VERSION) return null;
  const out = emptyStats();
  if (!data.days || typeof data.days !== 'object') return null;
  for (const [k, v] of Object.entries(data.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isNum(v)) return null;
    out.days[k] = v;
  }
  if (!data.lines || typeof data.lines !== 'object') return null;
  for (const [k, v] of Object.entries<any>(data.lines)) {
    if (!v || !isNum(v.views) || !isNum(v.clean) || !isNum(v.memoryStreak) || typeof v.lastSeen !== 'string') return null;
    out.lines[k] = { views: v.views, clean: v.clean, memoryStreak: v.memoryStreak, lastSeen: v.lastSeen };
  }
  if (data.priority && typeof data.priority === 'object') {
    for (const [k, v] of Object.entries(data.priority)) if (v === true) out.priority[k] = true;
  }
  return out;
}

export function todayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
