/**
 * Curated opening-theory repertoires (hand-authored main lines + key sidelines, not derived from
 * played games — that's src/openingTree.ts's job for the Opening Explorer's "My Repertoire" tab).
 * This is the data + tree-building logic behind the Opening Trainer: pure, no DOM, no localStorage
 * — src/openingTrainer.ts owns persistence and UI.
 *
 * A RepertoireDef is a flat list of full lines (PGN move text, White's first move first). Lines are
 * merged into a tree the same transposition-aware way openingTree.ts merges games: nodes are keyed
 * by position (positionKey, reused from there), so two lines that transpose into the same position
 * share one node instead of branching separately.
 *
 * This is a starting set, not exhaustive theory — deep enough to play confidently through the
 * opening and into a known middlegame plan, not every sideline a database would show. Extend by
 * adding more `lines` entries; the tree builder and trainer need no changes.
 */
import { Chess } from 'chess.js';
import { positionKey } from './openingTree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface RepNode {
  fen: string;
  ply: number;
  children: Map<string, string>; // SAN -> child position key
}

export interface RepertoireTree {
  root: RepNode;
  rootKey: string;
  positions: Map<string, RepNode>;
}

export interface RepertoireDef {
  id: string;
  name: string;
  color: 'w' | 'b';
  description: string;
  /** Full lines in PGN move text, e.g. "1. e4 e5 2. Nf3 Nc6 3. d4". */
  lines: string[];
}

export const REPERTOIRES: RepertoireDef[] = [
  {
    id: 'scotch-white',
    name: 'Scotch Complex — White',
    color: 'w',
    description: 'Scotch Game, Scotch Gambit, and the Haxo Gambit against 1...e5.',
    lines: [
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5',
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Bc5 5. Be3 Qf6 6. c3 Nge7 7. Bc4 Ne5 8. Be2 Qg6',
      // Stockfish 18 (depth 20): 9.Bxc6 first (not 9.Nxc6 bxc6 10.Bxc6??, which just drops the
      // bishop to 10...Bxc6 — the d7-bishop already covers c6). Full line verified near-equal (+28cp).
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Nf6 5. e5 d5 6. Bb5 Ne4 7. Nxd4 Bc5 8. Be3 Bd7 9. Bxc6 bxc6 10. Nd2 Nxd2 11. Qxd2 Bb6',
      // Haxo Gambit: 4...Bc5 5.O-O Nf6 6.e5 d5 7.exf6 dxc4 8.fxg7 Rg8 — the defining piece sac.
      // Stockfish 18 (depth 20, MultiPV 3) has 9.Re1 as the top try here, not the historically named
      // 9.Bh6 (Bh6 isn't in the top 3 at that depth); Re1 keeps the same sac, just a sounder follow-up.
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Bc5 5. O-O Nf6 6. e5 d5 7. exf6 dxc4 8. fxg7 Rg8 9. Re1',
    ],
  },
  {
    id: 'scotch-black',
    name: 'Scotch Complex — Black',
    color: 'b',
    description: 'Defending 1...e5 against the Scotch Game, Scotch Gambit, and the Haxo Gambit.',
    lines: [
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6',
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Nf6 5. e5 d5 6. Bb5 Ne4 7. Nxd4 Bc5 8. Be3 Bd7 9. Bxc6 bxc6 10. Nd2 Nxd2 11. Qxd2 Bb6',
      // Facing the Haxo Gambit: keep material, finish development. 9...Be6 is Stockfish 18's own
      // top reply to 9.Re1 at depth 20.
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Bc4 Bc5 5. O-O Nf6 6. e5 d5 7. exf6 dxc4 8. fxg7 Rg8 9. Re1 Be6',
    ],
  },
  {
    id: 'panov-white',
    name: 'Accelerated Panov vs Caro-Kann — White',
    color: 'w',
    description: 'Panov-Botvinnik Attack (accelerated move order, c4 before Nf3) against the Caro-Kann.',
    lines: [
      '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 Nf6 5. Nc3 e6 6. Nf3 Be7 7. cxd5 Nxd5 8. Bc4 Nc6 9. O-O O-O',
      '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 e6 5. Nc3 Nf6 6. Nf3 Be7 7. cxd5 Nxd5 8. Bc4 Nc6 9. O-O O-O 10. Re1',
      '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 Nc6 5. Nc3 Nf6 6. Nf3 Bg4 7. cxd5 Nxd5 8. Qb3 Bxf3 9. gxf3 Nb6 10. d5',
    ],
  },
  {
    id: 'alapin-white',
    name: 'Sicilian Alapin (2.c3) — White',
    color: 'w',
    description: 'The Alapin Variation against the Sicilian, avoiding main-line theory with 2.c3.',
    lines: [
      '1. e4 c5 2. c3 d5 3. exd5 Qxd5 4. d4 Nf6 5. Nf3 Bg4 6. Be2 e6 7. h3 Bh5 8. O-O Nc6 9. Be3 cxd4 10. cxd4',
      '1. e4 c5 2. c3 Nf6 3. e5 Nd5 4. Nf3 Nc6 5. Bc4 Nb6 6. Bb3 c4 7. Bc2 Qc7 8. Qe2 g6',
      '1. e4 c5 2. c3 e6 3. d4 d5 4. e5 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4',
      // Stockfish 18 (depth 20) prefers 6.Nge2 before Nc3 (+68cp), not 6.Nc3 g6 7.Nge2.
      '1. e4 c5 2. c3 d6 3. d4 Nf6 4. Bd3 cxd4 5. cxd4 Nc6 6. Nge2 Bd7 7. Nbc3 e5 8. Bc2 g6 9. d5 Nb4 10. Ba4',
    ],
  },
  {
    id: 'tarrasch-french-white',
    name: 'Tarrasch French — White',
    color: 'w',
    description: 'The Tarrasch Variation (3.Nd2) against the French, covering both the Closed setup and the Open, IQP-structure lines.',
    lines: [
      // Closed Tarrasch: 3...Nf6 4.e5 locks the center.
      '1. e4 e6 2. d4 d5 3. Nd2 Nf6 4. e5 Nfd7 5. Bd3 c5 6. c3 Nc6 7. Ne2 Qb6 8. Nf3 cxd4 9. cxd4 f6 10. exf6 Nxf6 11. O-O Bd6',
      // Open Tarrasch: 3...c5 4.exd5 exd5, IQP middlegame.
      '1. e4 e6 2. d4 d5 3. Nd2 c5 4. exd5 exd5 5. Ngf3 Nc6 6. Bb5 Bd6 7. dxc5 Bxc5 8. O-O Nge7 9. Nb3 Bd6',
      // Open Tarrasch sideline: 4...Qxd5 instead of recapturing with the pawn.
      '1. e4 e6 2. d4 d5 3. Nd2 c5 4. exd5 Qxd5 5. Ngf3 cxd4 6. Bc4 Qd6 7. O-O Nf6 8. Nb3 Nc6 9. Nbxd4 Nxd4 10. Nxd4',
    ],
  },
];

function newNode(fen: string, ply: number): RepNode {
  return { fen, ply, children: new Map() };
}

/** Builds the merged position tree for one repertoire. Throws if a line contains an illegal move
 *  (a typo in the data above) — fail loudly at build/test time rather than silently truncating a
 *  line, since a broken line here is a content bug, not a runtime edge case to degrade gracefully. */
export function buildRepertoireTree(def: RepertoireDef): RepertoireTree {
  const positions = new Map<string, RepNode>();
  const rootKey = positionKey(START_FEN);
  const root = newNode(START_FEN, 0);
  positions.set(rootKey, root);

  for (const line of def.lines) {
    const chess = new Chess();
    let node = root;
    // Strip move numbers ("1.", "12...") — chess.js's own SAN parser handles bare tokens fine and
    // this keeps the loop simple (no need to distinguish "1." from "1...").
    const tokens = line.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
    for (const token of tokens) {
      let moveResult;
      try {
        moveResult = chess.move(token);
      } catch (err) {
        throw new Error(`Illegal move "${token}" in repertoire "${def.id}" line: ${line}`);
      }
      const san = moveResult.san;
      const fen = chess.fen();
      const childKey = positionKey(fen);
      let child = positions.get(childKey);
      if (!child) {
        child = newNode(fen, node.ply + 1);
        positions.set(childKey, child);
      }
      node.children.set(san, childKey);
      node = child;
    }
  }

  return { root, rootKey, positions };
}

export interface QuizPoint {
  path: string[]; // SANs from the root to this node
  fen: string; // the position to quiz (side to move === def.color)
}

/** Every position in the tree where it's the trainee's move and there's a recommended move to
 *  quiz — walks the tree depth-first, tracking the SAN path for a stable SRS key (positions can
 *  repeat across the tree via transposition, but a path is always unique). */
export function collectQuizPoints(tree: RepertoireTree, color: 'w' | 'b'): QuizPoint[] {
  const out: QuizPoint[] = [];
  const seenPaths = new Set<string>();

  function walk(node: RepNode, path: string[]) {
    if (node.children.size === 0) return;
    const toMove = node.fen.split(' ')[1] as 'w' | 'b';
    if (toMove === color) {
      const key = path.join(' ');
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        out.push({ path, fen: node.fen });
      }
    }
    for (const [san, childKey] of node.children) {
      const child = tree.positions.get(childKey);
      if (child) walk(child, [...path, san]);
    }
  }

  walk(tree.root, []);
  return out;
}

export function nodeAtPath(tree: RepertoireTree, path: string[]): RepNode | null {
  let node: RepNode = tree.root;
  for (const san of path) {
    const childKey = node.children.get(san);
    if (!childKey) return null;
    const child = tree.positions.get(childKey);
    if (!child) return null;
    node = child;
  }
  return node;
}
