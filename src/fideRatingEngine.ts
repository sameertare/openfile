/**
 * FIDE (Standard) rating estimator — an unofficial implementation of the published FIDE rating
 * formula (FIDE Handbook B.02, effective 1 March 2024, incl. the 1 Oct 2025 amendment): win
 * expectancy from FIDE's own Table 8.1.2 (rating-difference D -> scoring probability PD, in whole
 * D-point bins to the nearest .01 — verified against handbook.fide.com/chapter/B022024, not the
 * closed-form logistic curve, which is only a rounded approximation of this table), and a
 * K-factor that's a flat tier lookup by rating (rather than USCF's dynamic N+games formula).
 * FIDE's Standard rating has no bonus-points provision.
 *
 * The ±400 rating-difference cap (per the 1 Oct 2025 amendment) only applies for players rated
 * below 2650 — 2650+ uses the actual difference uncapped.
 *
 * Simplified to rating-only K-factor tiers (no prior-games or age input): this assumes an
 * established player. FIDE also uses K=40 for a player's first 30 rated games regardless of
 * rating, and K=40 for players under 18 rated below 2300, neither of which is modeled here since
 * that requires knowing games-played count and birth date. (FIDE's K x n <= 700 cap is likewise
 * not modeled — irrelevant at this tool's 15-opponent max, since even K=40 x 15 = 600 never
 * reaches it.)
 */

export interface FideEstimateInput {
  currentRating: number;
  totalScore: number;
  opponentRatings: number[]; // 1-15 entries
}

export interface FideEstimateResult {
  gamesCounted: number;
  winExpectancy: number;
  kFactor: number;
  kTierLabel: string;
  ratingChange: number;
  newRating: number;
  performanceRating: number;
  notes: string[];
}

export type FideEstimateOutcome =
  | { ok: true; result: FideEstimateResult }
  | { ok: false; error: string };

const MIN_RATING = 100;
const MAX_RATING = 3000;
const HIGH_RATING_THRESHOLD = 2400;
const RATING_DIFF_CAP = 400;
const RATING_DIFF_CAP_EXEMPT_AT = 2650; // players rated 2650+ are not subject to the 400-point cap
const FIDE_PUBLISH_FLOOR = 1400;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// FIDE Handbook Table 8.1.2 — "conversion of difference in rating, D, into scoring probability PD,
// for the higher, H, ... rated player", verbatim (D-range inclusive, PD as hundredths). The lower-
// rated player's probability is 1 - PD(H) at the same |D|, not a separate table row.
const PD_TABLE: readonly [loD: number, hiD: number, pdHundredths: number][] = [
  [0, 3, 50], [4, 10, 51], [11, 17, 52], [18, 25, 53], [26, 32, 54], [33, 39, 55],
  [40, 46, 56], [47, 53, 57], [54, 61, 58], [62, 68, 59], [69, 76, 60], [77, 83, 61],
  [84, 91, 62], [92, 98, 63], [99, 106, 64], [107, 113, 65], [114, 121, 66], [122, 129, 67],
  [130, 137, 68], [138, 145, 69], [146, 153, 70], [154, 162, 71], [163, 170, 72], [171, 179, 73],
  [180, 188, 74], [189, 197, 75], [198, 206, 76], [207, 215, 77], [216, 225, 78], [226, 235, 79],
  [236, 245, 80], [246, 256, 81], [257, 267, 82], [268, 278, 83], [279, 290, 84], [291, 302, 85],
  [303, 315, 86], [316, 328, 87], [329, 344, 88], [345, 357, 89], [358, 374, 90], [375, 391, 91],
  [392, 411, 92], [412, 432, 93], [433, 456, 94], [457, 484, 95], [485, 517, 96], [518, 559, 97],
  [560, 619, 98], [620, 735, 99],
];

function pdForAbsDiff(absDiff: number): number {
  for (const [lo, hi, pd] of PD_TABLE) {
    if (absDiff >= lo && absDiff <= hi) return pd / 100;
  }
  return 1; // beyond the table's last row (>735)
}

function winExpectancy(playerRating: number, opponentRating: number): number {
  const diff = playerRating - opponentRating;
  const capped = playerRating >= RATING_DIFF_CAP_EXEMPT_AT ? diff : clamp(diff, -RATING_DIFF_CAP, RATING_DIFF_CAP);
  const pd = pdForAbsDiff(Math.abs(capped));
  return capped >= 0 ? pd : 1 - pd;
}

function kFactorFor(currentRating: number): { k: number; label: string } {
  if (currentRating >= HIGH_RATING_THRESHOLD) {
    return { k: 10, label: `Rated ${HIGH_RATING_THRESHOLD}+` };
  }
  return { k: 20, label: `Rated below ${HIGH_RATING_THRESHOLD}` };
}

export function estimateFideRating(input: FideEstimateInput): FideEstimateOutcome {
  const { currentRating, totalScore } = input;
  const opponents = input.opponentRatings.filter((r) => Number.isFinite(r));

  if (!Number.isFinite(currentRating) || currentRating < MIN_RATING || currentRating > MAX_RATING) {
    return { ok: false, error: `Current rating must be between ${MIN_RATING} and ${MAX_RATING}.` };
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

  const notes: string[] = [
    'Assumes an established rating. FIDE uses K=40 for a player\'s first 30 rated games regardless of rating, and K=40 for players under 18 rated below 2300 — neither is modeled here.',
    'Once a player\'s published rating has reached 2400, K stays at 10 even if the rating later drops below 2400 — this estimate only looks at the current rating entered.',
  ];
  const { k, label } = kFactorFor(currentRating);

  const we = opponents.reduce((sum, opp) => sum + winExpectancy(currentRating, opp), 0);
  const uncappedRatingChange = k * (totalScore - we);
  // Clamp first, then derive the reported change from the clamped value — otherwise a rating that
  // would land outside [MIN_RATING, MAX_RATING] (e.g. a shutout loss to a much-higher-rated field
  // for a low-rated player, or a perfect score against a high-rated field near MAX_RATING) shows a
  // "new rating" that's been silently pulled back in bounds while the "change" figure next to it
  // still reflects the uncapped math, so the two numbers stop adding up.
  const newRating = clamp(Math.round(currentRating + uncappedRatingChange), MIN_RATING, MAX_RATING);
  const ratingChange = newRating - currentRating;

  if (newRating < FIDE_PUBLISH_FLOOR) {
    notes.push(`FIDE does not publish Standard ratings below ${FIDE_PUBLISH_FLOOR} — this estimate is shown for reference only.`);
  }

  const avgOpponent = opponents.reduce((a, b) => a + b, 0) / n;
  let performanceRating: number;
  if (totalScore === 0) {
    performanceRating = avgOpponent - 400;
  } else if (totalScore === n) {
    performanceRating = avgOpponent + 400;
  } else {
    performanceRating = avgOpponent + 400 * Math.log10(totalScore / (n - totalScore));
  }

  return {
    ok: true,
    result: {
      gamesCounted: n,
      winExpectancy: Math.round(we * 100) / 100,
      kFactor: k,
      kTierLabel: label,
      ratingChange: Math.round(ratingChange * 10) / 10,
      newRating: Math.round(newRating),
      performanceRating: Math.round(performanceRating),
      notes,
    },
  };
}
