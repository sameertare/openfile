// Builds src/data/openings.json from lichess-org/chess-openings (CC0): every named opening line as
// [eco, name, "san san san ..."]. Run `npm run build:openings` to refresh (needs network), or pass
// `--from <dir>` with a.tsv..e.tsv already downloaded.
import { Chess } from 'chess.js';
import fs from 'node:fs';
import path from 'node:path';

const fromIdx = process.argv.indexOf('--from');
const fromDir = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';

const entries = [];
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const text = fromDir ? fs.readFileSync(path.join(fromDir, `${f}.tsv`), 'utf8') : await (await fetch(`${BASE}${f}.tsv`)).text();
  for (const line of text.trim().split('\n').slice(1)) {
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) continue;
    const chess = new Chess();
    const sans = [];
    for (const tok of pgn.split(/\s+/)) {
      if (/^\d+\.+$/.test(tok)) continue;
      const mv = chess.move(tok); // throws on a bad line — fail the build loudly
      sans.push(mv.san);
    }
    entries.push([eco, name, sans.join(' ')]);
  }
}

const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'data', 'openings.json');
fs.writeFileSync(out, JSON.stringify({
  source: 'lichess-org/chess-openings (CC0 1.0) — https://github.com/lichess-org/chess-openings',
  entries,
}));
console.log(`wrote ${entries.length} openings -> ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
