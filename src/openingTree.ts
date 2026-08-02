/**
 * Builds a branching move tree from a batch of games (own SAN sequences), aggregating how often
 * each move was played from each position and the practical score from there — the core data
 * structure behind the Opening Explorer. Pure logic, no DOM; src/openingExplorer.ts renders it.
 *
 * Transposition-aware: nodes are keyed by *position* (board + side to move + castling rights +
 * en-passant target — the first four FEN fields), not by the sequence of moves that reached them.
 * A position reached via two different move orders is one merged node with combined stats, not two
 * separate branches each with half the sample size — the same idea chesscope.com's Repertoire
 * Explorer (a re-architecture of openingtree.com) calls "transposition-aware." Navigation still
 * follows a path of SANs from the root (breadcrumbs, drilling), but the tree that path walks
 * through is this merged graph, resolved via RepertoireTree.positions rather than each node owning
 * its children directly.
 */
import { Chess } from 'chess.js';
import type { Result } from './types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Cap tree depth to the opening phase — deeper transpositions rarely matter for repertoire prep,
 *  and letting every game's full move list branch out would make the tree unusably wide. */
export const MAX_TREE_PLY = 24; // 12 full moves

/** The first four FEN fields (board, side to move, castling rights, en-passant target) — the part
 *  of a position that actually matters for "have I been here before," dropping the halfmove clock
 *  and fullmove number, which are always different across games/paths even in an identical position. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** One underlying game, attached to every tree node its move sequence passes through — the same
 *  object reference is shared across nodes (cheap; not cloned), so a popular position can list
 *  every individual game that reached it, not just the aggregate counts. */
export interface GameRef {
  opponent: string;
  opponentRating: number | null;
  result: Result;
  link: string | null;
  date: string;
  sans: string[]; // the full game's moves, not just the prefix up to this node
}

export interface TreeNode {
  fen: string; // position after the move that led here (root = start position); representative —
               // the first FEN seen for this position key, not necessarily every game's exact FEN
               // (halfmove clock/move number can differ across transposing games).
  ply: number; // ply at which this position was first reached (root = 0)
  games: number;
  wins: number;
  draws: number;
  losses: number;
  children: Map<string, string>; // SAN -> child position key (resolve via RepertoireTree.positions)
  gameRefs: GameRef[]; // every underlying game that passed through this node
  ratedGames: number; // count of gameRefs with a known opponent rating
  ratingSum: number;  // sum of those known ratings, for the average
}

/** The full merged graph a tree walk resolves against. buildTree()'s return value. */
export interface RepertoireTree {
  root: TreeNode;
  rootKey: string;
  positions: Map<string, TreeNode>; // keyed by positionKey()
}

export interface TreeGame {
  sans: string[];
  result: Result; // already from the color being explored's perspective
  opponent: string;
  opponentRating: number | null;
  link: string | null;
  date: string;
}

export interface ChildSummary {
  san: string;
  fen: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number; // (wins + draws*0.5) / games * 100
  avgOpponentRating: number | null;
  performanceRating: number | null;
}

function newNode(fen: string, ply: number): TreeNode {
  return { fen, ply, games: 0, wins: 0, draws: 0, losses: 0, children: new Map(), gameRefs: [], ratedGames: 0, ratingSum: 0 };
}

function tally(node: TreeNode, result: Result, ref: GameRef) {
  node.games++;
  if (result === 'win') node.wins++;
  else if (result === 'loss') node.losses++;
  else if (result === 'draw') node.draws++;
  // 'unknown' games are excluded from the input list entirely (see buildTree), so never reach here.
  node.gameRefs.push(ref);
  if (ref.opponentRating != null && Number.isFinite(ref.opponentRating)) {
    node.ratedGames++;
    node.ratingSum += ref.opponentRating;
  }
}

/** Builds the tree from games already filtered to one color and one player. Games with an
 *  unresolved result are skipped — there's no practical outcome to attribute to any branch. */
export function buildTree(games: TreeGame[], maxPly = MAX_TREE_PLY): RepertoireTree {
  const positions = new Map<string, TreeNode>();
  const rootKey = positionKey(START_FEN);
  const root = newNode(START_FEN, 0);
  positions.set(rootKey, root);

  for (const g of games) {
    if (g.result === 'unknown') continue;
    const ref: GameRef = {
      opponent: g.opponent,
      opponentRating: g.opponentRating,
      result: g.result,
      link: g.link,
      date: g.date,
      sans: g.sans,
    };
    tally(root, g.result, ref);
    const chess = new Chess();
    let node = root;
    const limit = Math.min(g.sans.length, maxPly);
    for (let i = 0; i < limit; i++) {
      let moveResult;
      try {
        moveResult = chess.move(g.sans[i]);
      } catch {
        break; // malformed SAN somewhere downstream — stop walking this game, keep what we have
      }
      if (!moveResult) break;
      const san = moveResult.san; // normalized (chess.js's own SAN, matches what we'll look up by)
      const fen = chess.fen();
      const childKey = positionKey(fen);
      let child = positions.get(childKey);
      if (!child) {
        child = newNode(fen, i + 1);
        positions.set(childKey, child);
      }
      tally(child, g.result, ref);
      node.children.set(san, childKey); // idempotent if this exact edge already existed
      node = child;
    }
  }
  return { root, rootKey, positions };
}

/** Same core log10 performance-rating approximation used by ratingEngine.ts's estimator (average
 *  opponent rating adjusted by score, FIDE-style), applied directly here without the rest of that
 *  tool's K-factor/effective-games machinery — this is a lightweight per-position stat, not a full
 *  rating-change estimate, so it deliberately doesn't try to match rating.html's numbers exactly. */
function performanceRatingEstimate(avgOpponentRating: number, score: number, games: number): number {
  if (games <= 0) return Math.round(avgOpponentRating);
  if (score <= 0) return Math.round(avgOpponentRating - 400);
  if (score >= games) return Math.round(avgOpponentRating + 400);
  return Math.round(avgOpponentRating + 400 * Math.log10(score / (games - score)));
}

export function avgOpponentRating(node: TreeNode): number | null {
  return node.ratedGames ? Math.round(node.ratingSum / node.ratedGames) : null;
}

export function performanceRating(node: TreeNode): number | null {
  const avg = avgOpponentRating(node);
  if (avg == null) return null;
  return performanceRatingEstimate(avg, node.wins + node.draws * 0.5, node.games);
}

/** Children sorted by how often they were played, most-common first — the natural reading order
 *  for "what do I actually play here." Resolved against the merged position graph, so if a child
 *  position was also reached via a different move order elsewhere in the tree, its stats here
 *  already reflect that combined sample. */
export function childSummaries(tree: RepertoireTree, node: TreeNode): ChildSummary[] {
  const out: ChildSummary[] = [];
  for (const [san, key] of node.children) {
    const child = tree.positions.get(key);
    if (!child) continue; // shouldn't happen — defensive, e.g. against a future bug in buildTree
    out.push({
      san,
      fen: child.fen,
      games: child.games,
      wins: child.wins,
      draws: child.draws,
      losses: child.losses,
      scorePct: child.games ? Math.round(((child.wins + child.draws * 0.5) / child.games) * 1000) / 10 : 0,
      avgOpponentRating: avgOpponentRating(child),
      performanceRating: performanceRating(child),
    });
  }
  return out.sort((a, b) => b.games - a.games);
}

/** Walks a path of SANs from the root, returning the node reached or null if the path doesn't
 *  exist in this tree (e.g. after switching color/filters out from under an open path). */
export function nodeAtPath(tree: RepertoireTree, path: string[]): TreeNode | null {
  let node = tree.root;
  for (const san of path) {
    const key = node.children.get(san);
    if (!key) return null;
    const next = tree.positions.get(key);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function scorePct(node: TreeNode): number {
  return node.games ? Math.round(((node.wins + node.draws * 0.5) / node.games) * 1000) / 10 : 0;
}
