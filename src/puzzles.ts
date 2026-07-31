/**
 * Turns the blunders/missed wins/missed mates already flagged in analyzed games into "find the
 * move" puzzles. Pure logic — no DOM, no localStorage (src/main.ts owns the drill UI + SRS
 * persistence, same split as src/srs.ts).
 */
import { Chess } from 'chess.js';
import type { GameRecord, WorstMove } from './types';

export interface Puzzle {
  id: string; // stable across re-analysis of the same game — used as the SRS storage key
  gameId: string;
  date: string;
  opponent: string;
  color: 'w' | 'b';
  fen: string;    // position before the flagged move, side to move === color
  played: string; // SAN actually played (the wrong move)
  best: string;   // SAN the engine suggested instead (the puzzle's answer)
  kind: WorstMove['kind'];
  moveNo: number;
}

/** Every GameRecord.sans ply index for a given full-move number + color, standard chess numbering. */
function plyIndex(moveNo: number, color: 'w' | 'b'): number {
  return (moveNo - 1) * 2 + (color === 'w' ? 0 : 1);
}

/** Derives puzzles from every analyzed game's worstMoves. Only kept when the engine actually ran
 *  locally (evalSource === 'engine') — PGN-only [%eval] analysis never records a best move, so
 *  there'd be no correct answer to quiz. Plain 'mistake's are skipped to keep the set focused on
 *  the moves that actually cost the game (blunders, missed wins, missed mates). */
export function derivePuzzles(records: GameRecord[]): Puzzle[] {
  const out: Puzzle[] = [];
  for (const g of records) {
    if (!g.analyzed || g.evalSource !== 'engine') continue;
    for (const m of g.worstMoves) {
      if (m.kind === 'mistake' || !m.best) continue;
      const idx = plyIndex(m.moveNo, g.userColor);
      if (idx < 0 || idx >= g.sans.length || g.sans[idx] !== m.san) continue; // sanity guard against numbering drift
      const chess = new Chess();
      try {
        for (let i = 0; i < idx; i++) chess.move(g.sans[i]);
      } catch {
        continue; // a corrupt/edited sans list shouldn't crash puzzle derivation for the rest
      }
      out.push({
        id: `${g.id}:${m.moveNo}:${g.userColor}`,
        gameId: g.id,
        date: g.date,
        opponent: (g.userColor === 'w' ? g.black : g.white) || 'Unknown',
        color: g.userColor,
        fen: chess.fen(),
        played: m.san,
        best: m.best,
        kind: m.kind,
        moveNo: m.moveNo,
      });
    }
  }
  return out;
}
