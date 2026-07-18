/** Lichess's free public Syzygy tablebase API — exact win/draw/loss + distance-to-zeroing for any
 *  standard-chess position with 7 or fewer pieces on the board. No auth, no rate-limit key needed. */

export type TbCategory = 'win' | 'loss' | 'draw' | 'cursed-win' | 'blessed-loss' | 'maybe-win' | 'maybe-loss' | 'unknown';

export interface TbMove {
  uci: string;
  san: string;
  category: TbCategory;
  dtz: number | null;
}

export interface TbResult {
  category: TbCategory;
  dtz: number | null; // distance to zeroing move (i.e. the 50-move-rule-resetting move), for the side to move
  dtm: number | null; // distance to mate, when known (not all positions have a DTM table)
  checkmate: boolean;
  stalemate: boolean;
  moves: TbMove[]; // every legal move, each with the resulting category/dtz — best (for the mover) first
}

/** Count non-king pieces + kings on the board (i.e. total pieces) from a FEN's board field. */
export function pieceCount(fen: string): number {
  const board = fen.split(' ')[0];
  let n = 0;
  for (const ch of board) if (/[pnbrqkPNBRQK]/.test(ch)) n++;
  return n;
}

/** Syzygy tablebases only cover positions with 7 or fewer total pieces. */
export function tablebaseEligible(fen: string): boolean {
  return pieceCount(fen) <= 7;
}

/** Query the tablebase for `fen`. Returns null if not eligible, not found (e.g. still building for
 *  7-piece positions in rare cases), or the request fails (offline, rate-limited, etc). */
export async function queryTablebase(fen: string, signal?: AbortSignal): Promise<TbResult | null> {
  if (!tablebaseEligible(fen)) return null;
  try {
    const r = await fetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`, { signal });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.category == null) return null; // e.g. insufficient_material-only replies have no category
    return {
      category: d.category,
      dtz: d.dtz ?? null,
      dtm: d.dtm ?? null,
      checkmate: !!d.checkmate,
      stalemate: !!d.stalemate,
      moves: (d.moves ?? []).map((m: any) => ({ uci: m.uci, san: m.san, category: m.category, dtz: m.dtz ?? null })),
    };
  } catch {
    return null; // offline / aborted — silently skip, this is a nice-to-have overlay, not core
  }
}

/** Short, human label for a tablebase category, from the perspective of the side to move. */
export function tbCategoryLabel(cat: TbCategory): string {
  switch (cat) {
    case 'win': return 'Winning';
    case 'loss': return 'Losing';
    case 'draw': return 'Draw';
    case 'cursed-win': return 'Win (50-move draw risk)';
    case 'blessed-loss': return 'Loss (50-move save)';
    case 'maybe-win': return 'Likely winning';
    case 'maybe-loss': return 'Likely losing';
    default: return 'Unknown';
  }
}

export function tbCategoryClass(cat: TbCategory): string {
  if (cat === 'win' || cat === 'cursed-win' || cat === 'maybe-win') return 'pos';
  if (cat === 'loss' || cat === 'blessed-loss' || cat === 'maybe-loss') return 'neg';
  if (cat === 'draw') return 'mid';
  return '';
}
