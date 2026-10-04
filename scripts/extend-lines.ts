// Stockfish-verifies every trainer line and completes it to 12 full moves (24 plies).
//  - Every move on the TRAINED side (the colour the opening is for) must be within LOSS_LIMIT cp of the
//    engine's best at DEPTH; the first lichess book move that isn't is cut, and the line continues with
//    the engine's best move from there. Engine padding past the book is best-move for both sides.
//  - The opening's own defining root moves (e.g. 2.f4 in the King's Gambit) are never cut, only reported.
//  - Opponent book moves are kept as-is (they're the theory you must face; a gambit's refutation is fine).
// Writes src/data/lineExtensions.json: { [lineId]: { keep, ext } } and src/data/lineReport.json.
// Run `npm run build:lines` after changing the catalog or openings data (about 20-40 min).
import { Chess } from 'chess.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import raw from '../src/data/openings.json';
import { loadBook, buildLines } from '../src/openingBook';
import { CATALOG } from '../src/openingCatalog';
import { LINE_PLIES } from '../src/openingBook';

const DEPTH = 18;
const LOSS_LIMIT = 60; // centipawns
const CLAMP = 600; // beyond +/-6 pawns the game is decided; don't flag losses inside that
const WORKERS = 9;
const ENGINE = new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url).pathname;

interface Result { best: string; cp: number } // cp from the side to move's view

class Uci {
  p = spawn('node', [ENGINE]);
  buf = '';
  onLine: ((l: string) => void) | null = null;
  constructor() {
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.onLine?.(line);
      }
    });
    this.p.stdin.write('uci\n');
  }
  until(pred: (l: string) => boolean): Promise<void> {
    return new Promise((res) => { this.onLine = (l) => { if (pred(l)) { this.onLine = null; res(); } }; });
  }
  async init() { await this.until((l) => l === 'uciok'); this.p.stdin.write('isready\n'); await this.until((l) => l === 'readyok'); }
  async search(fen: string): Promise<Result> {
    let cp = 0;
    let best = '';
    this.p.stdin.write(`position fen ${fen}\ngo depth ${DEPTH}\n`);
    await this.until((l) => {
      const m = l.match(/^info (?:.* )?depth (\d+) .*score (cp|mate) (-?\d+)/);
      if (m && !/lowerbound|upperbound/.test(l)) cp = m[2] === 'mate' ? (parseInt(m[3], 10) > 0 ? 10000 : -10000) : parseInt(m[3], 10);
      if (l.startsWith('bestmove')) { best = l.split(' ')[1]; return true; }
      return false;
    });
    return { best, cp };
  }
  quit() { this.p.stdin.write('quit\n'); this.p.kill(); }
}

const book = loadBook((raw as unknown as { entries: [string, string, string][] }).entries);
const jobs = CATALOG.flatMap((o) => buildLines(book, o).map((line) => ({ line, side: o.side, rootPlies: o.root.split(' ').length })));
const cache = new Map<string, Promise<Result>>();
const out: Record<string, { keep: number; ext: string[] }> = {};
const report: Record<string, unknown>[] = [];
let next = 0, done = 0;

const clamp = (v: number) => Math.max(-CLAMP, Math.min(CLAMP, v));

async function worker() {
  const e = new Uci();
  await e.init();
  const look = (fen: string) => {
    let r = cache.get(fen);
    if (!r) { r = e.search(fen); cache.set(fen, r); }
    return r;
  };
  while (next < jobs.length) {
    const { line, side, rootPlies } = jobs[next++];
    const g = new Chess();
    const sans: string[] = [];
    let keep = line.sans.length;
    let worstLoss = 0;
    let rootLoss = 0; // loss inside the opening's own defining moves: reported, never cut (the opening IS those moves)
    const cuts: string[] = [];
    // verify the trained side's book moves
    for (let i = 0; i < line.sans.length; i++) {
      const mover = i % 2 === 0 ? 'w' : 'b';
      if (mover === side) {
        const before = await look(g.fen());
        const mv = g.move(line.sans[i]);
        const after = g.isGameOver() ? { cp: g.isCheckmate() ? -10000 : 0, best: '' } : await look(g.fen());
        const loss = clamp(before.cp) - clamp(-after.cp);
        if (i < rootPlies) rootLoss = Math.max(rootLoss, loss);
        else worstLoss = Math.max(worstLoss, loss);
        if (loss > LOSS_LIMIT && i >= rootPlies) { keep = i; cuts.push(`${Math.floor(i / 2) + 1}${mover === 'w' ? '.' : '...'}${mv.san} (-${loss}cp)`); g.undo(); break; }
        sans.push(mv.san);
      } else { sans.push(g.move(line.sans[i]).san); }
    }
    const ext: string[] = [];
    while (sans.length + ext.length < LINE_PLIES && !g.isGameOver()) {
      const r = await look(g.fen());
      const mv = g.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
      ext.push(mv.san);
    }
    const finalCp = g.isGameOver() ? 0 : (await look(g.fen())).cp * (g.turn() === side ? 1 : -1);
    if (keep < line.sans.length || ext.length) out[line.id] = { keep, ext };
    report.push({ id: line.id, side, bookPlies: line.sans.length, keptBookPlies: keep, cut: cuts[0] ?? null, worstTrainedLossCp: worstLoss, rootLossCp: rootLoss, evalForTrainedSideAtEnd: finalCp });
    if (++done % 25 === 0) console.log(`${done}/${jobs.length}`);
  }
  e.quit();
}

await Promise.all(Array.from({ length: WORKERS }, worker));
const dir = new URL('../src/data/', import.meta.url).pathname;
fs.writeFileSync(dir + 'lineExtensions.json', JSON.stringify(out));
fs.writeFileSync(dir + 'lineReport.json', JSON.stringify(report, null, 1));
console.log(`wrote ${Object.keys(out).length} line completions; ${report.filter((r) => r.cut).length} lines had an unsound book move cut`);
