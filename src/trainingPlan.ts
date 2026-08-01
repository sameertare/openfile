/**
 * Turns the existing, already-computed Training recommendations (src/aggregate.ts's `recommend()`
 * output — real evidence from the analyzed games, not invented) into a day-by-day plan. Pure logic,
 * no DOM/localStorage — src/main.ts owns rendering and persistence, same split as puzzles.ts/srs.ts.
 *
 * Every link here is either themeUrl() (already shipped, used by the report itself) or one of the
 * four general-resource URLs below, which were checked by hand before being hardcoded — no
 * generated/guessed URLs (e.g. no per-opening Wikipedia links, no article search results).
 */
import type { Recommendation } from './aggregate';
import { themeUrl } from './aggregate';

export type PlanDuration = 7 | 14 | 21;
export type PlanDetail = 'high-level' | 'detailed';

export interface PlanLink {
  label: string;
  url: string;
}

export interface PlanTask {
  id: string; // `${day}:${index}` — stable across re-renders, used as the checkbox persistence key
  day: number; // 1-indexed
  area: string;
  severity: Recommendation['severity'];
  title: string;
  detail?: string; // the recommendation's evidence text ("why") — detailed mode only
  links: PlanLink[];
}

export interface TrainingPlan {
  duration: PlanDuration;
  detailLevel: PlanDetail;
  generatedAt: string; // ISO
  tasks: PlanTask[];
}

// Verified by hand (fetched each one) before hardcoding — stable lichess/chess.com hub pages, not
// per-topic guesses. Only used in detailed mode, rotated in periodically alongside the puzzle work.
const GENERAL_RESOURCES: PlanLink[] = [
  { label: 'Lichess Practice (structured lessons)', url: 'https://lichess.org/practice' },
  { label: 'Lichess Study (community study material, searchable by opening/topic)', url: 'https://lichess.org/study' },
  { label: 'Lichess Learn (fundamentals)', url: 'https://lichess.org/learn' },
  { label: 'Chess.com Lessons', url: 'https://www.chess.com/lessons' },
];

const SEVERITY_WEIGHT: Record<Recommendation['severity'], number> = { high: 3, medium: 2, low: 1 };

/** A repeating rotation of the recommendations, weighted so a 'high' severity area comes up 3x as
 *  often as a 'low' one across the plan, 'medium' 2x — higher-priority weaknesses get more days. */
function weightedRotation(recs: Recommendation[]): Recommendation[] {
  const queue: Recommendation[] = [];
  for (const r of recs) {
    for (let i = 0; i < SEVERITY_WEIGHT[r.severity]; i++) queue.push(r);
  }
  return queue;
}

export function generateTrainingPlan(
  recommendations: Recommendation[],
  duration: PlanDuration,
  detailLevel: PlanDetail
): TrainingPlan {
  const generatedAt = new Date().toISOString();
  if (!recommendations.length) return { duration, detailLevel, generatedAt, tasks: [] };

  const rotation = weightedRotation(recommendations);
  const tasks: PlanTask[] = [];
  let resourceCycle = 0;

  for (let day = 1; day <= duration; day++) {
    const rec = rotation[(day - 1) % rotation.length];
    const maxLinks = detailLevel === 'detailed' ? 4 : 2;
    const puzzleLinks = rec.themes.slice(0, maxLinks).map((t) => ({ label: `Puzzles: ${t.label}`, url: themeUrl(t.name) }));

    if (detailLevel === 'high-level') {
      tasks.push({
        id: `${day}:0`,
        day,
        area: rec.area,
        severity: rec.severity,
        title: `Focus: ${rec.area} — ${rec.drills[0] ?? 'targeted practice'}`,
        links: puzzleLinks,
      });
      continue;
    }

    // detailed: one task per drill (evidence text attached to the first), plus a puzzle-practice
    // task, plus (every 4th day) a general-resource task so the plan isn't 100% puzzles.
    rec.drills.forEach((drill, i) => {
      tasks.push({
        id: `${day}:${i}`,
        day,
        area: rec.area,
        severity: rec.severity,
        title: drill,
        detail: i === 0 ? rec.why : undefined,
        links: i === 0 ? puzzleLinks : [],
      });
    });
    if (day % 4 === 0) {
      const resource = GENERAL_RESOURCES[resourceCycle % GENERAL_RESOURCES.length];
      resourceCycle++;
      tasks.push({
        id: `${day}:resource`,
        day,
        area: 'General study',
        severity: 'low',
        title: `Browse ${resource.label} for 15–20 minutes`,
        links: [resource],
      });
    }
  }

  return { duration, detailLevel, generatedAt, tasks };
}

/** Groups a flat task list back into day buckets, in day order, for rendering. */
export function tasksByDay(plan: TrainingPlan): { day: number; tasks: PlanTask[] }[] {
  const byDay = new Map<number, PlanTask[]>();
  for (const t of plan.tasks) {
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day)!.push(t);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, tasks]) => ({ day, tasks }));
}
