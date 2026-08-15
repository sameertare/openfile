import { describe, it, expect } from 'vitest';
import { generateTrainingPlan, tasksByDay, PLAN_ALGO_VERSION } from './trainingPlan';
import type { Recommendation } from './aggregate';

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    area: 'Middlegame tactics',
    severity: 'high',
    why: 'Blundered material in 4 of your last 10 games.',
    themes: [{ name: 'fork', label: 'Forks' }, { name: 'pin', label: 'Pins' }],
    drills: ['Solve 10 tactics puzzles', 'Review your last blunder'],
    ...over,
  };
}

describe('generateTrainingPlan: empty input', () => {
  it('returns an empty task list with no recommendations', () => {
    const plan = generateTrainingPlan([], 7, 'high-level');
    expect(plan.tasks).toEqual([]);
    expect(plan.algoVersion).toBe(PLAN_ALGO_VERSION);
  });
});

describe('generateTrainingPlan: scheduling', () => {
  it('produces exactly one focus task per day in high-level mode', () => {
    const recs = [rec({ area: 'A', severity: 'high' }), rec({ area: 'B', severity: 'low' })];
    const plan = generateTrainingPlan(recs, 7, 'high-level');
    const days = tasksByDay(plan);
    expect(days).toHaveLength(7);
    for (const d of days) expect(d.tasks).toHaveLength(1);
  });

  it('alternates perfectly between two equally-weighted areas instead of clustering', () => {
    // Regression guard for the exact bug that prompted PLAN_ALGO_VERSION bump: the old
    // repeated-copies queue could show the identical area many days in a row for a short
    // recommendation list. With equal weights, smooth weighted round-robin must strictly
    // alternate rather than cluster.
    const recs = [rec({ area: 'A', severity: 'medium' }), rec({ area: 'B', severity: 'medium' })];
    const plan = generateTrainingPlan(recs, 14, 'high-level');
    const areaSeq = tasksByDay(plan).map((d) => d.tasks[0].area);
    expect(areaSeq).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
  });

  it('keeps even a 3:1 severity-weighted area from dominating the whole plan (no unbroken run anywhere near the plan length)', () => {
    const recs = [rec({ area: 'A', severity: 'high' }), rec({ area: 'B', severity: 'low' })];
    const plan = generateTrainingPlan(recs, 14, 'high-level');
    const areaSeq = tasksByDay(plan).map((d) => d.tasks[0].area);
    let streak = 1;
    let maxStreak = 1;
    for (let i = 1; i < areaSeq.length; i++) {
      streak = areaSeq[i] === areaSeq[i - 1] ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    // The old bug could produce a run as long as the entire plan; smooth weighted round-robin
    // caps any run at roughly the weight ratio (3:1 here), far short of that.
    expect(maxStreak).toBeLessThan(recs.length === 2 ? 14 : Infinity);
    expect(maxStreak).toBeLessThanOrEqual(4);
    expect(areaSeq).toContain('B');
  });

  it('weights higher-severity areas to appear more often over a long plan', () => {
    const recs = [rec({ area: 'High', severity: 'high' }), rec({ area: 'Low', severity: 'low' })];
    const plan = generateTrainingPlan(recs, 21, 'high-level');
    const days = tasksByDay(plan);
    const counts = { High: 0, Low: 0 };
    for (const d of days) counts[d.tasks[0].area as 'High' | 'Low']++;
    expect(counts.High).toBeGreaterThan(counts.Low);
  });

  it('gives every area at least one appearance across a plan long enough to fit them all', () => {
    const recs = [rec({ area: 'A', severity: 'high' }), rec({ area: 'B', severity: 'medium' }), rec({ area: 'C', severity: 'low' })];
    const plan = generateTrainingPlan(recs, 21, 'high-level');
    const areasShown = new Set(plan.tasks.map((t) => t.area));
    expect(areasShown).toEqual(new Set(['A', 'B', 'C']));
  });

  it('is deterministic for the same inputs (no randomness)', () => {
    const recs = [rec({ area: 'A', severity: 'high' }), rec({ area: 'B', severity: 'medium' }), rec({ area: 'C', severity: 'low' })];
    const p1 = generateTrainingPlan(recs, 14, 'high-level');
    const p2 = generateTrainingPlan(recs, 14, 'high-level');
    expect(p1.tasks.map((t) => t.area)).toEqual(p2.tasks.map((t) => t.area));
  });
});

describe('generateTrainingPlan: detail levels', () => {
  it('high-level mode uses a single combined task with a title that names the drill', () => {
    const plan = generateTrainingPlan([rec()], 7, 'high-level');
    for (const t of plan.tasks) {
      expect(t.title).toContain('Focus:');
      expect(t.detail).toBeUndefined();
    }
  });

  it('detailed mode splits the drill and puzzle-practice into separate tasks, with evidence text only on first visit', () => {
    const plan = generateTrainingPlan([rec()], 7, 'detailed');
    const days = tasksByDay(plan);
    // Day 1: drill task (with detail) + puzzle task.
    const day1 = days[0].tasks;
    expect(day1[0].detail).toBe('Blundered material in 4 of your last 10 games.');
    expect(day1.some((t) => t.title.startsWith('Puzzle practice:'))).toBe(true);

    // A later day revisiting the same (only) area must not repeat the evidence text.
    const laterVisit = days.slice(1).find((d) => d.tasks.some((t) => t.area === 'Middlegame tactics' && t.detail !== undefined));
    expect(laterVisit).toBeUndefined();
  });

  it('rotates through multiple drills on repeat visits instead of repeating the same one verbatim', () => {
    const recs = [rec({ area: 'Solo', severity: 'high', drills: ['Drill 1', 'Drill 2'] })];
    const plan = generateTrainingPlan(recs, 7, 'detailed'); // single area -> every day revisits it
    const drillTitles = plan.tasks.filter((t) => t.id.endsWith(':0')).map((t) => t.title);
    expect(new Set(drillTitles).size).toBeGreaterThan(1);
  });

  it('falls back to a generic task when a recommendation has no drills', () => {
    const recs = [rec({ area: 'Empty', drills: [] })];
    const plan = generateTrainingPlan(recs, 7, 'detailed');
    expect(plan.tasks[0].title).toBe('Targeted practice: Empty');
  });

  it('inserts a general-resource task every 4th day in detailed mode', () => {
    const plan = generateTrainingPlan([rec()], 14, 'detailed');
    const days = tasksByDay(plan);
    expect(days[3].tasks.some((t) => t.id === '4:resource')).toBe(true);
    expect(days[7].tasks.some((t) => t.id === '8:resource')).toBe(true);
    expect(days[0].tasks.some((t) => t.id.endsWith(':resource'))).toBe(false);
  });

  it('caps puzzle links at 2 in high-level mode and 4 in detailed mode', () => {
    const manyThemes = rec({ themes: Array.from({ length: 6 }, (_, i) => ({ name: `t${i}`, label: `T${i}` })) });
    const highLevel = generateTrainingPlan([manyThemes], 7, 'high-level');
    expect(highLevel.tasks[0].links.length).toBeLessThanOrEqual(2);
    const detailed = generateTrainingPlan([manyThemes], 7, 'detailed');
    const puzzleTask = detailed.tasks.find((t) => t.title.startsWith('Puzzle practice:'))!;
    expect(puzzleTask.links.length).toBeLessThanOrEqual(4);
  });
});

describe('generateTrainingPlan: task ids', () => {
  it('gives every task a stable, unique id keyed by day and index', () => {
    const plan = generateTrainingPlan([rec(), rec({ area: 'Other', severity: 'low' })], 7, 'detailed');
    const ids = plan.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('tasksByDay', () => {
  it('groups tasks by day in ascending day order', () => {
    const plan = generateTrainingPlan([rec()], 7, 'detailed');
    const days = tasksByDay(plan);
    expect(days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns an empty array for an empty plan', () => {
    const plan = generateTrainingPlan([], 7, 'high-level');
    expect(tasksByDay(plan)).toEqual([]);
  });
});
