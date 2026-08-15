import { describe, it, expect } from 'vitest';
import { newCard, isDue, review } from './srs';

describe('newCard', () => {
  it('starts at interval 0, ease 2.5, immediately due', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const card = newCard(now);
    expect(card.intervalDays).toBe(0);
    expect(card.easeFactor).toBe(2.5);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(isDue(card, now)).toBe(true);
  });
});

describe('isDue', () => {
  it('is false before dueAt, true at or after it', () => {
    const card = newCard(new Date('2026-01-05T00:00:00Z'));
    expect(isDue(card, new Date('2026-01-04T00:00:00Z'))).toBe(false);
    expect(isDue(card, new Date('2026-01-05T00:00:00Z'))).toBe(true);
    expect(isDue(card, new Date('2026-01-06T00:00:00Z'))).toBe(true);
  });
});

describe('review: correct answers', () => {
  it('schedules 1 day out on the first correct rep, 3 days on the second', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    let card = newCard(now);
    card = review(card, true, now);
    expect(card.intervalDays).toBe(1);
    expect(card.reps).toBe(1);
    card = review(card, true, now);
    expect(card.intervalDays).toBe(3);
    expect(card.reps).toBe(2);
  });

  it('grows the interval by the ease factor from the third correct rep onward', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    let card = newCard(now);
    card = review(card, true, now); // rep1 -> interval 1
    card = review(card, true, now); // rep2 -> interval 3
    card = review(card, true, now); // rep3 -> interval round(3 * ease)
    expect(card.intervalDays).toBe(Math.round(3 * 2.6));
  });

  it('increases the ease factor by 0.1 per correct answer', () => {
    const card = review(newCard(), true);
    expect(card.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('does not mutate the input card', () => {
    const original = newCard();
    const snapshot = { ...original };
    review(original, true);
    expect(original).toEqual(snapshot);
  });
});

describe('review: incorrect answers', () => {
  it('resets reps to 0, sets interval to 1 day, and increments lapses', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    let card = newCard(now);
    card = review(card, true, now); // reps=1
    card = review(card, false, now); // lapse
    expect(card.reps).toBe(0);
    expect(card.intervalDays).toBe(1);
    expect(card.lapses).toBe(1);
  });

  it('decreases the ease factor by 0.2, floored at 1.3', () => {
    let card = newCard(); // ease 2.5
    card = review(card, false); // 2.3
    expect(card.easeFactor).toBeCloseTo(2.3, 5);
    for (let i = 0; i < 20; i++) card = review(card, false);
    expect(card.easeFactor).toBe(1.3);
  });
});

describe('review: malformed stored data', () => {
  it('treats non-finite fields as their defaults instead of propagating NaN', () => {
    const corrupted = { intervalDays: NaN, easeFactor: NaN, reps: NaN, lapses: NaN, dueAt: 'not-a-date' };
    const card = review(corrupted as any, true, new Date('2026-01-01T00:00:00Z'));
    expect(Number.isFinite(card.intervalDays)).toBe(true);
    expect(Number.isFinite(card.easeFactor)).toBe(true);
    expect(Number.isFinite(card.reps)).toBe(true);
    expect(Number.isFinite(card.lapses)).toBe(true);
    expect(isNaN(new Date(card.dueAt).getTime())).toBe(false);
  });
});
