/**
 * One run through a trainable line: you play your side's book moves, the "engine" plays the book
 * replies for the other side. Pure state machine over chess.js — no DOM, no storage — so the
 * transitions (wrong move, hint, fade, completion) can be unit tested. src/openingTrainer.ts drives it.
 */
import { Chess } from 'chess.js';
import type { Quality } from './openingTrainerCore';
import { arrowVisible, movePoints, CLEAN_COMPLETION_BONUS } from './openingTrainerCore';

export type Color = 'w' | 'b';

export interface SessionMove {
  san: string;
  /** Position after the move. */
  fen: string;
  from: string;
  to: string;
  by: 'user' | 'book';
  /** Set later, once the engine has graded the move. */
  quality?: Quality;
}

export type AttemptResult =
  | { ok: true; move: SessionMove; points: number }
  | { ok: false; expected: string };

export class PracticeSession {
  readonly sans: string[];
  readonly userColor: Color;
  readonly viewing: number;
  readonly fadeAfter: number;

  private chess = new Chess();
  history: SessionMove[] = [];
  mistakes = 0;
  points = 0;
  /** True until any of your moves is made with an arrow showing (shown by fade schedule or by asking for a hint). */
  fromMemory = true;
  private missedThisPly = false;
  private hinted = false;

  constructor(sans: string[], userColor: Color, viewing: number, fadeAfter: number) {
    this.sans = sans;
    this.userColor = userColor;
    this.viewing = viewing;
    this.fadeAfter = fadeAfter;
  }

  get ply(): number { return this.history.length; }
  get done(): boolean { return this.ply >= this.sans.length; }
  get fen(): string { return this.chess.fen(); }
  get turn(): Color { return this.chess.turn(); }
  isUserTurn(): boolean { return !this.done && this.turn === this.userColor; }
  expected(): string | null { return this.done ? null : this.sans[this.ply]; }
  isClean(): boolean { return this.mistakes === 0; }

  /** How many of the line's plies are yours, and how many of those you've already played. */
  get userMoveCount(): number {
    let n = 0;
    for (let i = 0; i < this.sans.length; i++) if (this.colorOfPly(i) === this.userColor) n++;
    return n;
  }
  get userMoveIndex(): number {
    let n = 0;
    for (let i = 0; i < this.ply; i++) if (this.colorOfPly(i) === this.userColor) n++;
    return n;
  }
  private colorOfPly(i: number): Color { return i % 2 === 0 ? 'w' : 'b'; }

  /** Whether the book-move arrow is showing for your current move. */
  arrowShown(): boolean {
    return this.hinted || arrowVisible(this.viewing, this.fadeAfter, this.userMoveIndex, this.userMoveCount);
  }
  /** Reveal the book move for this turn ("show hint") — costs the from-memory credit and points. */
  requestHint(): void { this.hinted = true; }

  /** SAN for a from→to drag/click on the current position, or null if it isn't legal. */
  legalMove(from: string, to: string, promotion = 'q'): string | null {
    try {
      const probe = new Chess(this.chess.fen());
      return probe.move({ from, to, promotion }).san;
    } catch {
      return null;
    }
  }

  /** The book move's from/to squares (for drawing the arrow). */
  expectedSquares(): { from: string; to: string } | null {
    const exp = this.expected();
    if (!exp) return null;
    const probe = new Chess(this.chess.fen());
    const m = probe.move(exp);
    return { from: m.from, to: m.to };
  }

  attempt(san: string): AttemptResult {
    const expected = this.expected();
    if (!this.isUserTurn() || expected === null) return { ok: false, expected: expected ?? '' };
    if (san !== expected) {
      this.mistakes++;
      this.missedThisPly = true;
      return { ok: false, expected };
    }
    const shown = this.arrowShown();
    const points = movePoints(shown, !this.missedThisPly);
    if (shown) this.fromMemory = false;
    const move = this.apply(san, 'user');
    this.points += points;
    this.missedThisPly = false;
    this.hinted = false;
    return { ok: true, move, points };
  }

  /** Plays the book reply for the other side, if it's their turn. */
  opponentReply(): SessionMove | null {
    if (this.done || this.isUserTurn()) return null;
    return this.apply(this.sans[this.ply], 'book');
  }

  /** Bonus awarded once, on finishing without a single mistake. */
  completionBonus(): number {
    return this.done && this.isClean() ? CLEAN_COMPLETION_BONUS : 0;
  }

  private apply(san: string, by: 'user' | 'book'): SessionMove {
    const m = this.chess.move(san);
    const move: SessionMove = { san: m.san, fen: this.chess.fen(), from: m.from, to: m.to, by };
    this.history.push(move);
    return move;
  }
}
