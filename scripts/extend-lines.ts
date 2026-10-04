// Pads every trainer line out to 12 full moves (24 plies) with Stockfish's best moves, so every line
// is the same depth. Writes src/data/lineExtensions.json: { [lineId]: ["Nf3", ...] } — only the plies
// beyond the lichess book line. Run `npm run build:lines` after changing the catalog or openings data.
import { Chess } from 'chess.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import raw from '../src/data/openings.json';
import { loadBook, buildLines } from '../src/openingBook';
import { CATALOG } from '../src/openingCatalog';
import { LINE_PLIES } from '../src/openingBook';

const DEPTH = 10;
const WORKERS = 4;
const ENGINE = new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url).pathname;

class Uci {
  p = spawn('node', [ENGINE]);
  buf = '';
  waiter: ((l: string) => void) | null = null;
  constructor() {
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (this.waiter && this.waiter(line)) this.waiter = null;
      }
    });
    this.p.stdin.write('uci\n');
  }
  until(pred: (l: string) => boolean): Promise<string> {
    return new Promise((res) => { this.waiter = (l) => (pred(l) ? (res(l), true) : false) as never; });
  }
  async init() { await this.until((l) => l === 'uciok'); this.p.stdin.write('isready\n'); await this.until((l) => l === 'readyok'); }
  async best(fen: string): Promise<string> {
    this.p.stdin.write(`position fen ${fen}\ngo depth ${DEPTH}\n`);
    return (await this.until((l) => l.startsWith('bestmove'))).split(' ')[1];
  }
  quit() { this.p.stdin.write('quit\n'); this.p.kill(); }
}

const book = loadBook((raw as unknown as { entries: [string, string, string][] }).entries);
const lines = CATALOG.flatMap((o) => buildLines(book, o));
const cache = new Map<string, string>();
const out: Record<string, string[]> = {};
let next = 0, done = 0;

async function worker() {
  const e = new Uci();
  await e.init();
  while (next < lines.length) {
    const line = lines[next++];
    const g = new Chess();
    for (const s of line.sans) g.move(s);
    const ext: string[] = [];
    while (line.sans.length + ext.length < LINE_PLIES && !g.isGameOver()) {
      const fen = g.fen();
      let uci = cache.get(fen);
      if (!uci) { uci = await e.best(fen); cache.set(fen, uci); }
      const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      ext.push(m.san);
    }
    if (ext.length) out[line.id] = ext;
    if (++done % 25 === 0) console.log(`${done}/${lines.length}`);
  }
  e.quit();
}

await Promise.all(Array.from({ length: WORKERS }, worker));
fs.writeFileSync(new URL('../src/data/lineExtensions.json', import.meta.url).pathname, JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} extensions`);
