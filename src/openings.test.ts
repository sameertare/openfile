import { describe, it, expect } from 'vitest';
import { identifyOpening } from './openings';

describe('identifyOpening: header precedence', () => {
  it('prefers the PGN Opening header when present', () => {
    const result = identifyOpening({ Opening: 'My Custom Opening', ECO: 'A00' }, ['e4', 'e5']);
    expect(result.opening).toBe('My Custom Opening');
    expect(result.eco).toBe('A00');
  });

  it('ignores a placeholder "?" Opening header and falls back', () => {
    // Distinct move prefix from the previous test, since identifyOpening's book-lookup cache is
    // keyed only by move sequence — reusing ['e4','e5'] here would read back that test's
    // header-derived name instead of exercising the book fallback (see the cache-isolation test
    // below for the bug that pattern would actually catch).
    const result = identifyOpening({ Opening: '?' }, ['e4', 'e6']);
    expect(result.opening).toBe('French Defense');
  });

  it('falls back to ECOUrl when there is no Opening header', () => {
    const result = identifyOpening({ ECOUrl: 'https://www.chess.com/openings/Italian-Game' }, []);
    expect(result.opening).toBe('Italian Game');
  });

  it('strips a trailing move-sequence suffix from ECOUrl-derived names', () => {
    const result = identifyOpening({ ECOUrl: 'https://www.chess.com/openings/Sicilian-Defense-3.Nc3-dxe4' }, []);
    expect(result.opening).toBe('Sicilian Defense');
  });
});

describe('identifyOpening: book lookup by move prefix', () => {
  it('matches the longest applicable prefix, not a shorter generic one', () => {
    const result = identifyOpening({}, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(result.opening).toBe('Ruy Lopez: Morphy Defense');
  });

  it('falls back to a shorter prefix when the game does not continue into a named variation', () => {
    const result = identifyOpening({}, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(result.opening).toBe('Ruy Lopez');
  });

  it('falls back to "Unknown Opening" when no prefix in the book matches', () => {
    const result = identifyOpening({}, ['h4', 'h5']);
    expect(result.opening).toBe('Unknown Opening');
  });

  it('only looks at the first 12 plies of the game', () => {
    // Even though the prefix list technically fits, adding lots of extra irrelevant moves
    // shouldn't matter — the lookup key is built from sans.slice(0, 12) regardless.
    const long = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6'];
    const result = identifyOpening({}, long);
    expect(result.opening).toBe('Ruy Lopez: Morphy Defense');
  });
});

describe('identifyOpening: cache isolation across games (regression)', () => {
  it('does not let one game\'s header-derived opening name poison the book lookup for another game sharing the same move prefix', () => {
    // A distinct prefix not used by any other test in this file, so this test is order-independent.
    const sans = ['d4', 'd5', 'c4'];
    const bookOnly = identifyOpening({}, sans); // no header -> real book lookup, gets cached
    expect(bookOnly.opening).toBe("Queen's Gambit");

    // A different game reaching the exact same position, but with its own (unrelated) PGN Opening
    // header — must use its own header, not the cache, and must NOT overwrite the cached book
    // result for the next header-less game.
    identifyOpening({ Opening: 'Some Site-Specific Label' }, sans);

    const bookOnlyAgain = identifyOpening({}, sans);
    expect(bookOnlyAgain.opening).toBe("Queen's Gambit");
  });

  it('does not let one game\'s ECO header leak into another game\'s cached book-lookup result', () => {
    const sans = ['d4', 'Nf6', 'c4', 'g6'];
    const withEco = identifyOpening({ ECO: 'E60' }, sans);
    expect(withEco.eco).toBe('E60');
    const withoutEco = identifyOpening({}, sans);
    expect(withoutEco.eco).toBe('');
    expect(withoutEco.opening).toBe(withEco.opening); // book-derived name still consistent
  });
});

describe('identifyOpening: family derivation', () => {
  it('splits family from opening at the first colon', () => {
    const result = identifyOpening({ Opening: 'Sicilian Defense: Najdorf Variation' }, []);
    expect(result.family).toBe('Sicilian Defense');
  });

  it('splits family from opening at the first comma when there is no colon', () => {
    const result = identifyOpening({ Opening: 'Caro-Kann Defense, Advance Variation' }, []);
    expect(result.family).toBe('Caro-Kann Defense');
  });

  it('uses the full opening name as the family when there is no colon or comma', () => {
    const result = identifyOpening({ Opening: 'Bird Opening' }, []);
    expect(result.family).toBe('Bird Opening');
  });
});
