// Verify the files shipped to browsers, not just the npm dependency or UI label.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = new URL('../', import.meta.url);
const basename = 'stockfish-19-lite-single';
const files = [`${basename}.js`, `${basename}.wasm`];
const pkg = JSON.parse(await readFile(new URL('node_modules/stockfish/package.json', root), 'utf8'));
assert.equal(pkg.version, '19.0.0', 'The installed engine must be Stockfish 19.0.0');
assert.deepEqual((await readdir(new URL('public/engine/', root))).sort(), [...files].sort(),
  'Ship only the Stockfish 19 worker and WASM; remove obsolete engine assets');
for (const file of files) {
  const digest = async (path) => createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
  assert.equal(await digest(`public/engine/${file}`), await digest(`node_modules/stockfish/bin/${file}`),
    `Bundled ${file} differs from the Stockfish 19.0.0 package`);
}

// The browser worker also supports Node, but needs a CommonJS scope for its CLI.
const dir = await mkdtemp(join(tmpdir(), 'openfile-engine-'));
try {
  await writeFile(join(dir, 'package.json'), '{"type":"commonjs"}');
  for (const file of files) await copyFile(new URL(`public/engine/${file}`, root), join(dir, file));
  await new Promise((resolve, reject) => {
    const engine = spawn(process.execPath, [join(dir, `${basename}.js`)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let identity = '';
    let errors = '';
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Engine verification timed out')), 30_000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      engine.kill();
      if (error) reject(error); else resolve();
    }
    engine.on('error', finish);
    engine.stdin.on('error', finish);
    engine.stderr.on('data', (data) => { errors += data; });
    engine.on('exit', (code) => {
      if (!finished) finish(new Error(`Engine exited before verification (${code}): ${errors}`));
    });
    createInterface({ input: engine.stdout }).on('line', (line) => {
      if (line.startsWith('id name ')) identity = line.slice(8);
      if (line === 'uciok') {
        if (!/^Stockfish 19\b/.test(identity)) return finish(new Error(`Unexpected engine: ${identity}`));
        engine.stdin.write('isready\n');
      }
      if (line === 'readyok') engine.stdin.write('position startpos\ngo depth 4\n');
      if (/^bestmove [a-h][1-8][a-h][1-8][qrbn]?\b/.test(line)) {
        console.log(`Verified ${identity}: UCI handshake, readiness, and depth-4 search passed.`);
        finish();
      }
    });
    engine.stdin.write('uci\n');
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
