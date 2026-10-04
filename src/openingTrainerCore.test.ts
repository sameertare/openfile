import { describe, it, expect } from 'vitest';
import {
  classifyLoss, lossBetween, lineStatus, openingStatus, recordStart, recordCompletion, emptyStats,
  movePoints, addPoints, scoreSummary, arrowVisible, viewingLabel, pickLine, exportStats, parseStats, todayKey,
  MEMORY_STREAK_NEEDED,
} from './openingTrainerCore';

describe('move quality', () => {
  it('grades by centipawn loss', () => {
    expect(classifyLoss(0)).toBe('good');
    expect(classifyLoss(40)).toBe('good');
    expect(classifyLoss(41)).toBe('inaccurate');
    expect(classifyLoss(100)).toBe('inaccurate');
    expect(classifyLoss(101)).toBe('mistake');
    expect(classifyLoss(250)).toBe('mistake');
    expect(classifyLoss(251)).toBe('blunder');
  });
  it('loss is never negative and is capped', () => {
    expect(lossBetween(20, 80)).toBe(0);
    expect(lossBetween(50, -120)).toBe(170);
    expect(lossBetween(10000, -10000)).toBe(2000);
  });
});

describe('progress', () => {
  it('moves new -> learning -> from memory after consecutive clean no-arrow completions', () => {
    const s = emptyStats();
    expect(lineStatus(s.lines['x'])).toBe('new');
    recordStart(s, 'x', '2026-10-01');
    expect(lineStatus(s.lines['x'])).toBe('learning');
    for (let i = 0; i < MEMORY_STREAK_NEEDED; i++) recordCompletion(s, 'x', true, true, '2026-10-01');
    expect(lineStatus(s.lines['x'])).toBe('memory');
  });
  it('a mistake or an arrow-assisted completion resets the memory streak', () => {
    const s = emptyStats();
    recordStart(s, 'x', 'd');
    recordCompletion(s, 'x', true, true, 'd');
    recordCompletion(s, 'x', true, true, 'd');
    recordCompletion(s, 'x', true, false, 'd'); // clean but with an arrow showing
    expect(s.lines['x'].memoryStreak).toBe(0);
    recordCompletion(s, 'x', true, true, 'd');
    recordCompletion(s, 'x', false, true, 'd'); // mistake
    expect(s.lines['x'].memoryStreak).toBe(0);
  });
  it('an opening is from-memory only when every line is, new only when none started', () => {
    const s = emptyStats();
    expect(openingStatus(['a', 'b'], s)).toBe('new');
    recordStart(s, 'a', 'd');
    expect(openingStatus(['a', 'b'], s)).toBe('learning');
    for (const id of ['a', 'b']) {
      recordStart(s, id, 'd');
      for (let i = 0; i < MEMORY_STREAK_NEEDED; i++) recordCompletion(s, id, true, true, 'd');
    }
    expect(openingStatus(['a', 'b'], s)).toBe('memory');
  });
});

describe('scoring', () => {
  it('pays 3 for a recalled move, 1 with an arrow, 0 on a retry', () => {
    expect(movePoints(false, true)).toBe(3);
    expect(movePoints(true, true)).toBe(1);
    expect(movePoints(false, false)).toBe(0);
  });
  it('summarizes today / best day / all time / days practiced', () => {
    const s = emptyStats();
    addPoints(s, '2026-10-01', 10);
    addPoints(s, '2026-10-02', 25);
    addPoints(s, '2026-10-02', 5);
    addPoints(s, '2026-10-03', 0);
    expect(scoreSummary(s, '2026-10-02')).toEqual({ today: 30, bestDay: 30, allTime: 40, daysPracticed: 2 });
    expect(scoreSummary(s, '2026-10-09').today).toBe(0);
  });
});

describe('arrow fade', () => {
  it('shows every arrow for the first `fadeAfter` viewings', () => {
    for (let i = 0; i < 5; i++) expect(arrowVisible(2, 2, i, 5)).toBe(true);
  });
  it('then hides the earliest moves first, more each viewing, until none show', () => {
    const shown = (viewing: number) => [0, 1, 2, 3].map((i) => arrowVisible(viewing, 2, i, 4));
    expect(shown(3)).toEqual([false, true, true, true]);   // 1/4 hidden
    expect(shown(4)).toEqual([false, false, true, true]);  // 2/4
    expect(shown(6)).toEqual([false, false, false, false]); // all gone
  });
  it('labels the viewing', () => {
    expect(viewingLabel(1, 2)).toBe('Viewing 1 of 2: arrows on every move.');
    expect(viewingLabel(3, 2)).toContain('fading');
  });
});

describe('pickLine', () => {
  const cands = [
    { lineId: 'a1', openingId: 'A' },
    { lineId: 'a2', openingId: 'A' },
    { lineId: 'b1', openingId: 'B' },
  ];
  it('returns null with nothing to pick from', () => {
    expect(pickLine([], emptyStats(), { leastStudiedFirst: false })).toBeNull();
  });
  it('skips the excluded line unless it is the only one', () => {
    for (let i = 0; i < 20; i++) expect(pickLine(cands, emptyStats(), { leastStudiedFirst: false, exclude: 'a1' })!.lineId).not.toBe('a1');
    expect(pickLine([cands[0]], emptyStats(), { leastStudiedFirst: false, exclude: 'a1' })!.lineId).toBe('a1');
  });
  it('least-studied-first only offers the lines with the fewest viewings', () => {
    const s = emptyStats();
    recordStart(s, 'a1', 'd'); recordStart(s, 'a1', 'd'); recordStart(s, 'a2', 'd');
    for (let i = 0; i < 20; i++) expect(pickLine(cands, s, { leastStudiedFirst: true })!.lineId).toBe('b1');
  });
  it('a priority opening is picked far more often', () => {
    const s = emptyStats();
    s.priority['B'] = true;
    let b = 0;
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 600; i++) if (pickLine(cands, s, { leastStudiedFirst: false, rng })!.openingId === 'B') b++;
    expect(b).toBeGreaterThan(300); // would be ~200 unweighted
  });
});

describe('stats import/export', () => {
  it('round-trips', () => {
    const s = emptyStats();
    recordStart(s, 'x|y', '2026-10-01');
    addPoints(s, '2026-10-01', 7);
    s.priority['x'] = true;
    expect(parseStats(exportStats(s))).toEqual(s);
  });
  it('rejects the wrong shape rather than corrupting saved progress', () => {
    expect(parseStats('not json')).toBeNull();
    expect(parseStats('{}')).toBeNull();
    expect(parseStats(JSON.stringify({ version: 1, days: { bad: 1 }, lines: {} }))).toBeNull();
    expect(parseStats(JSON.stringify({ version: 1, days: {}, lines: { x: { views: -1, clean: 0, memoryStreak: 0, lastSeen: 'd' } } }))).toBeNull();
    expect(parseStats(JSON.stringify({ version: 2, days: {}, lines: {} }))).toBeNull();
  });
  it('todayKey is a local YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 9, 3))).toBe('2026-10-03');
  });
});
