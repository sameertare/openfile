/**
 * Parses an uploaded opening-repertoire PGN into a branching move tree, and compares real games
 * against it move by move. Pure logic, no DOM.
 *
 * chess.js's own PGN loader (loadPgn) discards recursive variations (RAVs) — it only walks the
 * main line of whatever's parsed (see its `node = node.variations[0]` loop), so it can't represent
 * a repertoire's branches on its own. Rather than reach into chess.js's unexported internal PEG
 * parser, this file tokenizes movetext itself (move numbers, NAGs, comments, glyphs stripped;
 * parentheses kept as structural tokens) and walks the tokens with a `Chess` instance, re-loading
 * the branch point's FEN whenever a "(" opens an alternative to the move just played. This also
 * naturally merges multiple uploaded lines that share an opening prefix into one tree, whether the
 * repertoire is supplied as several separate PGN games (one line each — the common export format)
 * or as a single PGN with nested variations (also common), or a mix of both.
 */
import { Chess } from 'chess.js';
import { sanitizePgnText } from './pgn';
import type { ParsedMove } from './pgn';
import type { Color } from './types';

export interface RepertoireNode {
  san: string; // '' for the root (starting position)
  uci: string;
  moveNo: number; // full-move number; 0 for root
  color: Color | null; // null for root
  fenAfter: string;
  children: RepertoireNode[];
  parent: RepertoireNode | null;
}

export interface RepertoireTree {
  root: RepertoireNode;
  lineCount: number; // number of uploaded chunks that contributed at least one move
  nodeCount: number; // distinct positions in the tree, excluding root
  leafCount: number; // number of lines that terminate (end of prepared theory)
  maxDepthPly: number;
  skippedChunks: number; // chunks with zero usable moves (garbled / empty / illegal first move)
  truncatedLines: number; // chunks that added some moves, then hit an unrecognized move and stopped
  warnings: string[]; // human-readable detail for skipped/truncated chunks, worst offenders first
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function newNode(parent: RepertoireNode | null): RepertoireNode {
  return { san: '', uci: '', moveNo: 0, color: null, fenAfter: START_FEN, children: [], parent };
}

type Token = { type: 'san'; value: string } | { type: 'open' } | { type: 'close' };

/** Strips comments/NAGs/result markers, then splits into SAN / "(" / ")" tokens, dropping move-
 *  number labels ("12." / "12...") and trailing "!?" annotation glyphs from each move token. */
function tokenizeMovetext(movetext: string): Token[] {
  const cleaned = movetext
    .replace(/\{[^}]*\}/g, ' ') // PGN comments don't nest, so a non-greedy scan isn't needed
    .replace(/;[^\n]*/g, ' ') // rest-of-line comments
    .replace(/\$\d+/g, ' ') // NAGs
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' '); // trailing result marker
  const rawTokens = cleaned.replace(/([()])/g, ' $1 ').split(/\s+/).filter(Boolean);
  const tokens: Token[] = [];
  for (const t of rawTokens) {
    if (t === '(') { tokens.push({ type: 'open' }); continue; }
    if (t === ')') { tokens.push({ type: 'close' }); continue; }
    const value = t.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
    if (value) tokens.push({ type: 'san', value });
  }
  return tokens;
}

/** Per-chunk parse bookkeeping, threaded through the recursive descent below so a single pass can
 *  tell a fully-clean line apart from one that merely duplicated an existing line (both play moves,
 *  neither is a failure) from one that hit something unparseable partway through. */
interface ParseStats {
  played: number; // moves successfully played in this chunk, new node or not
  failedAt: string | null; // first unrecognized move token, if any
}

/** Plays one SAN token from the current board position (assumed to equal `parent.fenAfter`),
 *  merging into an existing child if some earlier line already reached the same position via the
 *  same move. Returns null (leaving the board untouched) if the move is illegal here. */
function findOrAddChild(parent: RepertoireNode, chess: Chess, sanToken: string, stats: ParseStats): RepertoireNode | null {
  let move;
  try {
    move = chess.move(sanToken);
  } catch {
    if (stats.failedAt === null) stats.failedAt = sanToken;
    return null;
  }
  stats.played++;
  const uci = move.from + move.to + (move.promotion ?? '');
  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return existing;
  const moveNo = parseInt(move.before.split(' ')[5], 10);
  const child: RepertoireNode = {
    san: move.san, uci, moveNo, color: move.color as Color, fenAfter: move.after, children: [], parent,
  };
  parent.children.push(child);
  return child;
}

function skipVariation(tokens: Token[], idx: number): number {
  let depth = 1;
  let i = idx;
  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === 'open') depth++;
    else if (tokens[i].type === 'close') depth--;
    i++;
  }
  return i;
}

/** Scans forward from an unparseable move to the close-paren that ends the *current* sequence
 *  (depth 0 relative to `idx`), without consuming it — or to end of input if there isn't one. Used
 *  so one bad move deep inside a variation discards only that variation's remaining tokens, instead
 *  of leaving them to be misread as a continuation of whatever sequence called us. */
function skipToSequenceEnd(tokens: Token[], idx: number): number {
  let depth = 0;
  let i = idx;
  while (i < tokens.length) {
    if (tokens[i].type === 'open') depth++;
    else if (tokens[i].type === 'close') {
      if (depth === 0) return i;
      depth--;
    }
    i++;
  }
  return i;
}

/** Walks a token stream starting at `idx`, playing moves from `parentNode` onward. The board must
 *  already be positioned at `parentNode.fenAfter` when called. A "(" branches an alternative off
 *  the move that was just played (i.e. off `current`'s parent, per standard PGN RAV semantics),
 *  reloading that FEN as the current position rather than using a chess.js move/undo stack, so
 *  nested branches at any depth need no manual bookkeeping. Returns the index just past the token
 *  that ended this sequence (end of input, or an unconsumed close-paren left for the caller). */
function parseSequence(tokens: Token[], idx: number, parentNode: RepertoireNode, chess: Chess, stats: ParseStats): number {
  let i = idx;
  let current = parentNode;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'close') return i;
    if (tok.type === 'open') {
      const branchParent = current.parent;
      if (!branchParent) {
        // Malformed: a variation with no preceding move to branch from. Skip its contents rather
        // than guessing what it means.
        i = skipVariation(tokens, i + 1);
        continue;
      }
      chess.load(branchParent.fenAfter);
      i = parseSequence(tokens, i + 1, branchParent, chess, stats);
      if (tokens[i]?.type === 'close') i++;
      chess.load(current.fenAfter); // restore position to continue the outer line
      continue;
    }
    const child = findOrAddChild(current, chess, tok.value, stats);
    if (!child) {
      // Illegal/unparseable move. Jump to this sequence's own boundary rather than just stopping,
      // so the leftover tokens of an aborted variation aren't misread as belonging to the caller.
      return skipToSequenceEnd(tokens, i + 1);
    }
    i++;
    current = child;
  }
  return i;
}

/** Splits an uploaded repertoire file into per-game chunks the same way pgn.ts's splitPgn does
 *  (one chunk per "[Event ...]" boundary), except a file with no headers at all — a hand-pasted
 *  movetext blob, which real repertoire input often is — is kept as a single chunk instead of being
 *  dropped, since splitPgn's stricter filter exists for whole-game exports, not this. */
function splitRepertoireChunks(text: string): string[] {
  const normalized = sanitizePgnText(text).replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  if (!/^\s*\[\w+\s/m.test(normalized)) return [normalized];
  return normalized.split(/\n(?=\[Event\s)/g).map((c) => c.trim()).filter(Boolean);
}

function stripHeaderBlock(chunk: string): string {
  const m = chunk.match(/^(\s*\[[^\]]*\]\s*)+/);
  return m ? chunk.slice(m[0].length) : chunk;
}

function firstLine(chunk: string): string {
  return chunk.split('\n', 1)[0]?.slice(0, 80) ?? '';
}

const MAX_WARNINGS = 8;

export function buildRepertoireTree(text: string): RepertoireTree {
  const chunks = splitRepertoireChunks(text);
  const root = newNode(null);
  const chess = new Chess();
  let lineCount = 0;
  let skippedChunks = 0;
  let truncatedLines = 0;
  const warnings: string[] = [];
  const addWarning = (msg: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(msg); };

  for (const chunk of chunks) {
    const tokens = tokenizeMovetext(stripHeaderBlock(chunk));
    if (!tokens.length) { skippedChunks++; continue; }
    chess.load(START_FEN);
    const stats: ParseStats = { played: 0, failedAt: null };
    parseSequence(tokens, 0, root, chess, stats);
    if (stats.played === 0) {
      skippedChunks++;
      if (stats.failedAt) addWarning(`Couldn't use "${firstLine(chunk)}" — "${stats.failedAt}" isn't a legal first move there.`);
    } else {
      lineCount++;
      if (stats.failedAt) {
        truncatedLines++;
        addWarning(`Stopped partway through "${firstLine(chunk)}" at unrecognized move "${stats.failedAt}" — the rest of that line wasn't added.`);
      }
    }
  }

  let nodeCount = 0, leafCount = 0, maxDepthPly = 0;
  (function walk(n: RepertoireNode, depth: number) {
    if (n !== root) { nodeCount++; maxDepthPly = Math.max(maxDepthPly, depth); }
    if (n.children.length === 0 && n !== root) leafCount++;
    for (const c of n.children) walk(c, depth + 1);
  })(root, 0);

  return { root, lineCount, nodeCount, leafCount, maxDepthPly, skippedChunks, truncatedLines, warnings };
}

// ---------- comparing a real game against the tree ----------

export type PlyStatus = 'book' | 'deviation' | 'end-of-book';

export interface PlyComparison {
  ply: number; // 1-indexed overall ply count
  moveNo: number;
  color: Color;
  san: string;
  status: PlyStatus;
}

export interface GameDeviationResult {
  plies: PlyComparison[];
  inRepertoireCount: number;
  outOfRepertoireCount: number;
  /** First point the game left the tree, if any. `reason: 'deviation'` means a move was played
   *  that contradicts a branch your repertoire actually covers; `'end-of-book'` means the game
   *  simply continued past where your prepared lines end — not a mistake, just untracked ground. */
  deviation: { ply: number; moveNo: number; color: Color; san: string; reason: 'deviation' | 'end-of-book' } | null;
}

export function compareGameToRepertoire(moves: ParsedMove[], tree: RepertoireTree): GameDeviationResult {
  const plies: PlyComparison[] = [];
  let node = tree.root;
  let deviation: GameDeviationResult['deviation'] = null;
  let inCount = 0;
  let outCount = 0;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (deviation) {
      plies.push({ ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, status: deviation.reason });
      outCount++;
      continue;
    }
    if (node.children.length === 0) {
      deviation = { ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, reason: 'end-of-book' };
      plies.push({ ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, status: 'end-of-book' });
      outCount++;
      continue;
    }
    const match = node.children.find((c) => c.uci === m.uci);
    if (match) {
      plies.push({ ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, status: 'book' });
      inCount++;
      node = match;
    } else {
      deviation = { ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, reason: 'deviation' };
      plies.push({ ply: i + 1, moveNo: m.moveNo, color: m.color, san: m.san, status: 'deviation' });
      outCount++;
    }
  }
  return { plies, inRepertoireCount: inCount, outOfRepertoireCount: outCount, deviation };
}

/** e.g. "8...Nf6" or "12.e4" - standard algebraic move-number prefix for a ply. */
export function plyLabel(moveNo: number, color: Color, san: string): string {
  return `${moveNo}${color === 'w' ? '.' : '...'}${san}`;
}
