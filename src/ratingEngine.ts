/**
 * US Chess (USCF) rating estimator — an unofficial approximation of the published rating
 * formula (win expectancy with the 400-point cap, the N+m K-factor, and a bonus provision for
 * large over-performance). US Chess's actual post-event computation is Glickman-based and run
 * centrally; this mirrors the classic public "rating estimator" formula players commonly use to
 * predict their own change, not the exact official algorithm.
 */

export interface RatingEstimateInput {
  currentRating: number;
  totalScore: number;
  priorGames: number;
  age?: number;
  opponentRatings: number[]; // 1-15 entries
  useDualRatedLowerK: boolean;
}

export interface RatingEstimateResult {
  gamesCounted: number;
  winExpectancy: number; // sum of per-game expectancies ("We")
  kFactor: number;
  effectiveN: number;
  established: boolean;
  baseRatingChange: number;
  bonus: number;
  ratingChange: number;
  newRating: number;
  performanceRating: number;
  notes: string[];
}

export type RatingEstimateOutcome =
  | { ok: true; result: RatingEstimateResult }
  | { ok: false; error: string };

const MIN_RATING = 100;
const MAX_RATING = 3200;
const ESTABLISHED_GAMES = 26;
const ESTABLISHED_N = 50;
const MIN_PROVISIONAL_N = 4;
const DUAL_RATED_THRESHOLD = 2200;
const DUAL_RATED_N_BOOST = 50;
const RATING_DIFF_CAP = 400;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Per-game win expectancy from the classic Elo logistic curve, with the ±400 rating-difference cap. */
function winExpectancy(playerRating: number, opponentRating: number): number {
  const diff = clamp(playerRating - opponentRating, -RATING_DIFF_CAP, RATING_DIFF_CAP);
  return 1 / (1 + Math.pow(10, -diff / 400));
}

export function estimateRating(input: RatingEstimateInput): RatingEstimateOutcome {
  const { currentRating, totalScore, priorGames, age, useDualRatedLowerK } = input;
  const opponents = input.opponentRatings.filter((r) => Number.isFinite(r));

  if (!Number.isFinite(currentRating) || currentRating < MIN_RATING || currentRating > MAX_RATING) {
    return { ok: false, error: `Current rating must be between ${MIN_RATING} and ${MAX_RATING}.` };
  }
  if (!Number.isFinite(priorGames) || priorGames < 0) {
    return { ok: false, error: 'Number of prior games must be zero or more.' };
  }
  if (opponents.length === 0) {
    return { ok: false, error: 'Enter at least one opponent rating.' };
  }
  if (opponents.length > 15) {
    return { ok: false, error: 'Enter at most 15 opponent ratings.' };
  }
  if (opponents.some((r) => r < MIN_RATING || r > MAX_RATING)) {
    return { ok: false, error: `Opponent ratings must be between ${MIN_RATING} and ${MAX_RATING}.` };
  }
  const n = opponents.length;
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > n) {
    return { ok: false, error: `Total score must be between 0 and ${n} (the number of opponents entered).` };
  }

  const established = priorGames >= ESTABLISHED_GAMES;
  let effectiveN = established ? ESTABLISHED_N : Math.max(priorGames, MIN_PROVISIONAL_N);

  const notes: string[] = [];
  if (!established) {
    notes.push(
      `With ${priorGames} prior rated game(s), US Chess treats this player as provisional (fewer than ${ESTABLISHED_GAMES}). ` +
      `Provisional ratings are normally set by the initial-rating formula rather than this K-factor estimator — treat this result as a rough approximation.`
    );
  }
  if (useDualRatedLowerK) {
    if (currentRating >= DUAL_RATED_THRESHOLD) {
      effectiveN += DUAL_RATED_N_BOOST;
      notes.push(`Dual-rated adjustment applied: effective games increased by ${DUAL_RATED_N_BOOST} for a lower K (rating ≥ ${DUAL_RATED_THRESHOLD}).`);
    } else {
      notes.push(`Dual-rated lower-K option is checked, but only applies at ${DUAL_RATED_THRESHOLD}+ — not used for this rating.`);
    }
  }
  if (age !== undefined && Number.isFinite(age) && age < 20) {
    notes.push('Junior player (under 20) — US Chess scholastic rating floors and related provisions may apply beyond this estimate.');
  }

  const we = opponents.reduce((sum, opp) => sum + winExpectancy(currentRating, opp), 0);
  const k = 800 / (effectiveN + n);
  const overperformance = totalScore - we;
  const baseChange = k * overperformance;

  // Bonus: when a player scores well above expectation, US Chess adds a bonus so a single great
  // event isn't as capped by an established player's large effective-games denominator. Modeled
  // here as half the gap between the normal-K change and what a much lower N (newer player) K
  // would have produced, applied only once the over-performance clears a threshold.
  let bonus = 0;
  if (overperformance > n / 2) {
    const kBonus = 800 / (MIN_PROVISIONAL_N + n);
    const altChange = kBonus * overperformance;
    bonus = Math.max(0, (altChange - baseChange) / 2);
    if (bonus > 0) notes.push('Bonus applied for scoring well above expectation.');
  }

  const uncappedChange = baseChange + bonus;
  const MAX_EVENT_SWING = 400; // sanity cap on a single event's total swing, incl. bonus
  const ratingChange = clamp(uncappedChange, -MAX_EVENT_SWING, MAX_EVENT_SWING);
  if (ratingChange !== uncappedChange) {
    notes.push(`Rating change capped at ${ratingChange > 0 ? '+' : ''}${Math.round(ratingChange)} for a single event.`);
  }
  const newRating = currentRating + ratingChange;

  const avgOpponent = opponents.reduce((a, b) => a + b, 0) / n;
  const performanceRating = avgOpponent + 400 * (2 * (totalScore / n) - 1);

  return {
    ok: true,
    result: {
      gamesCounted: n,
      winExpectancy: Math.round(we * 100) / 100,
      kFactor: Math.round(k * 10) / 10,
      effectiveN,
      established,
      baseRatingChange: Math.round(baseChange * 10) / 10,
      bonus: Math.round(bonus * 10) / 10,
      ratingChange: Math.round(ratingChange * 10) / 10,
      newRating: Math.round(newRating),
      performanceRating: Math.round(performanceRating),
      notes,
    },
  };
}
