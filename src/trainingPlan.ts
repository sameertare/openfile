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

// Bump whenever a change to generateTrainingPlan()'s scheduling/rotation logic would produce
// different task text for the same inputs — e.g. the day-clustering fix that replaced the
// original repeated-copies queue with smoothWeightedSchedule(). A plan already generated and
// persisted to localStorage under the OLD algorithm is not re-run by anything short of the user
// explicitly starting a new plan, so without this a fixed bug stays permanently broken for
// everyone who generated their plan before the fix shipped — the code changing underneath them
// does nothing, since the stored output never gets touched again. main.ts's loadTrainPlan()
// checks this against a stored plan's own algoVersion and discards (with an explanatory message)
// anything that doesn't match, rather than rendering possibly-broken frozen output forever.
export const PLAN_ALGO_VERSION = 2;

export interface TrainingPlan {
  duration: PlanDuration;
  detailLevel: PlanDetail;
  generatedAt: string; // ISO
  algoVersion: number;
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

/** Assigns one recommendation to each of `duration` day-slots, weighted so 'high' severity areas
 *  come up ~3x as often as 'low' ones (2x for 'medium') — but *interleaved*, not clustered.
 *
 *  The previous approach built a queue of repeated-in-place copies (e.g. [A,A,A,B,B,C]) and walked
 *  it with `day % queue.length` — which is exactly what produces the bug this replaced: for a
 *  typical 2-3 recommendation report, that queue is short enough that consecutive days land on the
 *  literal same array slot, so the plan shows the identical focus area (and in detailed mode, the
 *  identical drill text) for several days straight before jumping to the next.
 *
 *  This is the "smooth weighted round-robin" scheduling algorithm instead (the same one load
 *  balancers use to spread weighted backends evenly rather than in bursts): each candidate has a
 *  running "current" score that accumulates its weight every slot; whichever candidate has the
 *  highest current score wins the slot, then has the total weight subtracted back off. Weighted by
 *  long-run frequency exactly like the old version, but spreads repeats out instead of bunching
 *  them — see the tie-break note below for why iteration order still matters even here. */
function smoothWeightedSchedule(recs: Recommendation[], duration: number): Recommendation[] {
  const weights = recs.map((r) => SEVERITY_WEIGHT[r.severity]);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const current = weights.map(() => 0);
  const schedule: Recommendation[] = [];
  for (let day = 0; day < duration; day++) {
    for (let i = 0; i < recs.length; i++) current[i] += weights[i];
    // Ties (equal current score) resolve to the earlier recommendation, which is already
    // severity-sorted (recommend() in aggregate.ts) — so a tie favors the higher-priority area.
    let best = 0;
    for (let i = 1; i < recs.length; i++) if (current[i] > current[best]) best = i;
    schedule.push(recs[best]);
    current[best] -= totalWeight;
  }
  return schedule;
}

export function generateTrainingPlan(
  recommendations: Recommendation[],
  duration: PlanDuration,
  detailLevel: PlanDetail
): TrainingPlan {
  const generatedAt = new Date().toISOString();
  if (!recommendations.length) return { duration, detailLevel, generatedAt, algoVersion: PLAN_ALGO_VERSION, tasks: [] };

  const schedule = smoothWeightedSchedule(recommendations, duration);
  // How many times each area has come up so far — used to rotate which specific drill is featured
  // on a revisit, so a weak area recurring across the plan (by design — that's the point of
  // weighting) shows different concrete work each time instead of literally repeating itself.
  const visitCount = new Map<string, number>();
  const tasks: PlanTask[] = [];
  let resourceCycle = 0;

  for (let day = 1; day <= duration; day++) {
    const rec = schedule[day - 1];
    const visit = visitCount.get(rec.area) ?? 0;
    visitCount.set(rec.area, visit + 1);

    const maxLinks = detailLevel === 'detailed' ? 4 : 2;
    const puzzleLinks = rec.themes.slice(0, maxLinks).map((t) => ({ label: `Puzzles: ${t.label}`, url: themeUrl(t.name) }));
    // A recommendation with no drills (the interface doesn't forbid `drills: []`, even though
    // today's only producer, recommend() in aggregate.ts, always fills it) falls back to a generic
    // task rather than pushing nothing and silently vanishing that day from the plan.
    const drills = rec.drills.length ? rec.drills : [`Targeted practice: ${rec.area}`];
    const drill = drills[visit % drills.length];

    if (detailLevel === 'high-level') {
      tasks.push({
        id: `${day}:0`,
        day,
        area: rec.area,
        severity: rec.severity,
        title: `Focus: ${rec.area} — ${drill}`,
        links: puzzleLinks,
      });
      continue;
    }

    // detailed: the specific drill for this visit (evidence text attached only the first time this
    // area comes up, so it isn't repeated verbatim on every revisit), plus a puzzle-practice task
    // reusing the same puzzle-theme links every visit — drilling the actual puzzle set is a valid
    // thing to do again even when the featured drill sentence has already rotated once — plus
    // (every 4th day) a general-resource task so the plan isn't 100% puzzles.
    tasks.push({
      id: `${day}:0`,
      day,
      area: rec.area,
      severity: rec.severity,
      title: drill,
      detail: visit === 0 ? rec.why : undefined,
      links: [],
    });
    if (puzzleLinks.length) {
      tasks.push({
        id: `${day}:1`,
        day,
        area: rec.area,
        severity: rec.severity,
        title: `Puzzle practice: ${rec.area}`,
        links: puzzleLinks,
      });
    }
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

  return { duration, detailLevel, generatedAt, algoVersion: PLAN_ALGO_VERSION, tasks };
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
