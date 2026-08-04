/** Small formatting/conversion helpers shared by every page that shows Stockfish output on a
 *  board — factored out of live.ts once Opening Explorer needed the identical logic. */
import { Chess } from 'chess.js';

/** Converts a side-to-move-relative centipawn score to white's perspective. */
export function whiteCp(fen: string, cpSideToMove: number): number {
  return fen.split(' ')[1] === 'w' ? cpSideToMove : -cpSideToMove;
}

export function fmtEval(whiteCpVal: number, mate: number | null, stmWhite: boolean): string {
  if (mate !== null) {
    const m = stmWhite ? mate : -mate; // mate is side-to-move perspective → white perspective
    return `#${m}`;
  }
  const pawns = whiteCpVal / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}

export function pvToSans(fen: string, pv: string[], max = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4) : undefined });
      if (!mv) break;
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out;
}
