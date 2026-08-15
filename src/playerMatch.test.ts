import { describe, it, expect } from 'vitest';
import { nameKey, groupPlayerNames, inferOwnerColorFromTitle } from './playerMatch';

describe('nameKey', () => {
  it('is order- and comma-independent', () => {
    expect(nameKey('Tare, Eevie')).toBe(nameKey('Eevie Tare'));
  });
  it('is case-insensitive', () => {
    expect(nameKey('BOB SMITH')).toBe(nameKey('bob smith'));
  });
  it('differs for genuinely different names', () => {
    expect(nameKey('Bob Smith')).not.toBe(nameKey('Bob Jones'));
  });
});

describe('groupPlayerNames', () => {
  it('merges exact-match name variants (case/comma-order) into one group', () => {
    const map = new Map([['Tare, Eevie', 5], ['Eevie Tare', 3]]);
    const groups = groupPlayerNames(map);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(8);
  });

  it('merges an unambiguous short name into the one longer name that contains it', () => {
    const map = new Map([['Eevie Tare', 5], ['Eevie', 2]]);
    const groups = groupPlayerNames(map);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(7);
    expect(groups[0].display).toBe('Eevie Tare');
  });

  it('does not merge a short name when it could belong to more than one longer name', () => {
    const map = new Map([['Eevie Tare', 5], ['Eevie Smith', 4], ['Eevie', 2]]);
    const groups = groupPlayerNames(map);
    // Ambiguous "Eevie" stays its own group rather than guessing which full name it belongs to.
    expect(groups.some((g) => g.display === 'Eevie' && g.count === 2)).toBe(true);
    expect(groups).toHaveLength(3);
  });

  it('prefers the fuller, more frequent, non-comma-formatted variant as the display name', () => {
    const map = new Map([['Tare, Eevie', 1], ['Eevie Tare', 10]]);
    const groups = groupPlayerNames(map);
    expect(groups[0].display).toBe('Eevie Tare');
  });

  it('skips a blank/whitespace-only name', () => {
    const map = new Map([['', 3], ['   ', 2], ['Bob', 5]]);
    const groups = groupPlayerNames(map);
    expect(groups).toHaveLength(1);
    expect(groups[0].display).toBe('Bob');
  });

  it('keeps unrelated players in separate groups', () => {
    const map = new Map([['Alice', 5], ['Bob', 3]]);
    const groups = groupPlayerNames(map);
    expect(groups).toHaveLength(2);
  });
});

describe('inferOwnerColorFromTitle', () => {
  it('extracts White/Black from a "<color> vs <opponent>" chapter title', () => {
    expect(inferOwnerColorFromTitle('Black vs Suhaan Kesavan in Feb G60')).toBe('b');
    expect(inferOwnerColorFromTitle('White vs Someone in a study')).toBe('w');
  });
  it('is case-insensitive', () => {
    expect(inferOwnerColorFromTitle('black vs Bob')).toBe('b');
  });
  it('returns null when the pattern is absent or input is undefined', () => {
    expect(inferOwnerColorFromTitle('Just a regular chapter title')).toBeNull();
    expect(inferOwnerColorFromTitle(undefined)).toBeNull();
  });
});
