/** A curated pool of tablebase-eligible (≤7 piece) endgame positions for the Endgame Drill quiz.
 *  Each is just a legal starting point — the quiz doesn't hand-verify win/draw/loss itself; that
 *  comes from a live queryTablebase() call at drill time, same as the rest of the tablebase
 *  overlay. The label is only a rough category for variety, not a claimed verdict. */
export interface EndgamePosition {
  fen: string;
  label: string;
}

export const ENDGAME_POSITIONS: EndgamePosition[] = [
  { fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1', label: 'King and pawn — opposition' },
  { fen: '8/8/8/8/4k3/8/4KP2/8 b - - 0 1', label: 'King and pawn — defender to move' },
  { fen: '8/8/8/4k3/8/8/3PK3/8 w - - 0 1', label: 'King and pawn — rook pawn' },
  { fen: '8/8/8/8/8/4k3/4P3/4K3 b - - 0 1', label: 'King and pawn — pawn on 2nd rank' },
  { fen: '8/8/8/3k4/8/3K4/8/R7 w - - 0 1', label: 'King and rook vs king — box technique' },
  { fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', label: 'King and rook vs king — driving back' },
  { fen: '8/8/8/3k4/8/3K4/8/Q7 w - - 0 1', label: 'King and queen vs king — mating technique' },
  { fen: '6k1/8/8/8/8/8/8/Q3K3 w - - 0 1', label: 'King and queen vs king — cornering' },
  { fen: '8/8/8/3k4/8/3KR3/8/8 b - - 0 1', label: 'King and rook vs king — defender to move' },
  { fen: '8/8/8/8/3k4/8/3P4/3K4 b - - 0 1', label: 'King and pawn — direct opposition' },
  { fen: '4k3/4p3/4K3/8/8/8/8/8 w - - 0 1', label: 'King vs king and pawn — stopping it' },
  { fen: '8/8/4k3/8/8/4K3/4R3/8 b - - 0 1', label: 'King and rook vs king — cutting off' },
  { fen: '3k4/8/3K4/8/8/8/4R3/8 b - - 0 1', label: 'King and rook vs king — near the edge' },
  { fen: '8/8/8/4k3/8/8/3PK3/3R4 b - - 0 1', label: 'King, rook and pawn vs king' },
  { fen: '4k3/8/4K3/8/8/8/3B4/3N4 w - - 0 1', label: 'King, bishop and knight vs king — mating technique' },
  { fen: '8/8/8/4k3/8/4K3/8/2B2B2 w - - 0 1', label: 'King and two bishops vs king — mating technique' },
  { fen: '8/8/3k4/8/8/3K4/3P4/3R4 w - - 0 1', label: 'King, rook and pawn vs king — Lucena-like' },
  { fen: '6k1/6P1/6K1/8/8/8/8/8 w - - 0 1', label: 'King and pawn — near promotion' },
  { fen: '8/8/8/8/1k6/8/1KP5/8 w - - 0 1', label: 'King and pawn — flank pawn' },
];
