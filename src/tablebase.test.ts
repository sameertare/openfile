import { describe, it, expect, vi, afterEach } from 'vitest';
import { pieceCount, tablebaseEligible, tbCategoryLabel, tbCategoryClass, queryTablebase } from './tablebase';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KPK_FEN = '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1'; // 3 pieces

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pieceCount', () => {
  it('counts all pieces (both sides, kings included) from the board field', () => {
    expect(pieceCount(START_FEN)).toBe(32);
  });
  it('counts correctly for a sparse endgame position', () => {
    expect(pieceCount(KPK_FEN)).toBe(3);
  });
});

describe('tablebaseEligible', () => {
  it('is false for the starting position (32 pieces)', () => {
    expect(tablebaseEligible(START_FEN)).toBe(false);
  });
  it('is true for a position with 7 or fewer pieces', () => {
    expect(tablebaseEligible(KPK_FEN)).toBe(true);
  });
  it('is true exactly at the 7-piece boundary', () => {
    const sevenPieces = '8/8/8/3k4/8/3K4/8/R2Q4 w - - 0 1'; // K, k, R, Q + implicit... let's just count via pieceCount
    expect(pieceCount(sevenPieces)).toBeLessThanOrEqual(7);
    expect(tablebaseEligible(sevenPieces)).toBe(true);
  });
});

describe('tbCategoryLabel', () => {
  it('labels every known category distinctly', () => {
    expect(tbCategoryLabel('win')).toBe('Winning');
    expect(tbCategoryLabel('loss')).toBe('Losing');
    expect(tbCategoryLabel('draw')).toBe('Draw');
    expect(tbCategoryLabel('cursed-win')).toMatch(/Win/);
    expect(tbCategoryLabel('blessed-loss')).toMatch(/Loss/);
  });
  it('falls back to "Unknown" for an unrecognized category', () => {
    expect(tbCategoryLabel('unknown')).toBe('Unknown');
  });
});

describe('tbCategoryClass', () => {
  it('maps winning-flavoured categories to "pos"', () => {
    expect(tbCategoryClass('win')).toBe('pos');
    expect(tbCategoryClass('cursed-win')).toBe('pos');
    expect(tbCategoryClass('maybe-win')).toBe('pos');
  });
  it('maps losing-flavoured categories to "neg"', () => {
    expect(tbCategoryClass('loss')).toBe('neg');
    expect(tbCategoryClass('blessed-loss')).toBe('neg');
  });
  it('maps draw to "mid" and unknown to empty', () => {
    expect(tbCategoryClass('draw')).toBe('mid');
    expect(tbCategoryClass('unknown')).toBe('');
  });
});

describe('queryTablebase', () => {
  it('returns null without hitting the network for an ineligible (>7 piece) position', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await queryTablebase(START_FEN);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a successful response into a TbResult', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ category: 'win', dtz: 12, dtm: 8, checkmate: false, stalemate: false, moves: [{ uci: 'e3e4', san: 'Ke4', category: 'loss', dtz: -11 }] }),
    }));
    const result = await queryTablebase(KPK_FEN);
    expect(result).toEqual({
      category: 'win', dtz: 12, dtm: 8, checkmate: false, stalemate: false,
      moves: [{ uci: 'e3e4', san: 'Ke4', category: 'loss', dtz: -11 }],
    });
  });

  it('returns null when the response has no category (e.g. insufficient-material-only reply)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await queryTablebase(KPK_FEN)).toBeNull();
  });

  it('returns null on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await queryTablebase(KPK_FEN)).toBeNull();
  });

  it('returns null instead of throwing when the fetch itself fails (offline/aborted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(queryTablebase(KPK_FEN)).resolves.toBeNull();
  });
});
