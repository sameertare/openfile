import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, gameLink, isBotOrComputerGame, splitPgn, tryParseGame } from './pgn';
import { groupPlayerNames, nameKey } from './playerMatch';
import type { Color, Result } from './types';
import { buildRepertoireTree, compareGameToRepertoire, plyLabel } from './repertoire';
import type { RepertoireTree, GameDeviationResult, PlyStatus } from './repertoire';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- dom ----------
const repDropzone = $('#rep-dropzone');
const repFileInput = $('#rep-file-input') as HTMLInputElement;
const repPasteEl = $('#rep-paste') as HTMLTextAreaElement;
const repLoadPasteBtn = $('#rep-load-paste-btn') as HTMLButtonElement;
const repColorSelect = $('#rep-color-select') as HTMLSelectElement;
const repSummaryEl = $('#rep-summary');

const dropzone = $('#dropzone');
const fileInput = $('#file-input') as HTMLInputElement;
const fileSummaryEl = $('#file-summary');

const resultsCard = $('#results-card');
const resultsSummaryEl = $('#results-summary');
const resultsNoteEl = $('#results-note');
const resultsTbody = $('#results-tbody');

// ---------- state ----------
let repTree: RepertoireTree | null = null;
let parsedGames: ParsedGame[] = [];

// ---------- repertoire loading ----------
function loadRepertoireText(text: string, sourceLabel: string) {
  const tree = buildRepertoireTree(text);
  if (tree.nodeCount === 0) {
    repTree = null;
    repSummaryEl.innerHTML = `<span class="chip">⚠ No moves found in ${esc(sourceLabel)}</span>`;
    render();
    return;
  }
  repTree = tree;
  const skippedNote = tree.skippedChunks
    ? ` <span class="chip">⚠ ${tree.skippedChunks} chunk(s) in the file had no usable moves and were skipped</span>`
    : '';
  const truncatedNote = tree.truncatedLines
    ? ` <span class="chip">⚠ ${tree.truncatedLines} line(s) stopped early at an unrecognized move</span>`
    : '';
  const warningsBlock = tree.warnings.length
    ? `<details class="parse-errors"><summary>Why some of the file was skipped</summary><ul>${tree.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`
    : '';
  repSummaryEl.innerHTML = `<span class="chip">✓ ${tree.lineCount} line(s) loaded — ${tree.nodeCount} distinct position(s), up to ${tree.maxDepthPly} ply deep, ${tree.leafCount} line-ending(s)</span>${skippedNote}${truncatedNote}${warningsBlock}`;
  render();
}

repFileInput.addEventListener('change', async () => {
  const file = repFileInput.files?.[0];
  if (file) loadRepertoireText(await file.text(), file.name);
  repFileInput.value = '';
});
repDropzone.addEventListener('dragover', (e) => { e.preventDefault(); repDropzone.classList.add('dragover'); });
repDropzone.addEventListener('dragleave', () => repDropzone.classList.remove('dragover'));
repDropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  repDropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) loadRepertoireText(await file.text(), file.name);
});
repLoadPasteBtn.addEventListener('click', () => {
  if (!repPasteEl.value.trim()) return;
  loadRepertoireText(repPasteEl.value, 'the pasted text');
});
repColorSelect.addEventListener('change', render);

// ---------- games loading (same shape as Performance Analysis / Opening Explorer) ----------
async function handleGameFiles(files: FileList | File[]) {
  let failed = 0;
  let botExcluded = 0;
  const failureCounts = new Map<string, { count: number; sample: string }>();
  const recordFailure = (f: ParseFailure) => {
    const existing = failureCounts.get(f.reason);
    if (existing) existing.count++;
    else failureCounts.set(f.reason, { count: 1, sample: f.snippet });
  };

  for (const file of Array.from(files)) {
    const text = await file.text();
    const chunks = splitPgn(text);
    for (const chunk of chunks) {
      const { game, error } = tryParseGame(chunk);
      if (game) {
        if (isBotOrComputerGame(game.headers)) { botExcluded++; continue; }
        parsedGames.push(game);
      } else {
        failed++;
        if (error) recordFailure(error);
      }
    }
  }
  const seen = new Set<string>();
  parsedGames = parsedGames.filter((g) => {
    const id = gameId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let note = '';
  if (failed) note += ` <span class="chip">⚠ ${failed} item(s) could not be parsed</span>`;
  if (botExcluded) note += ` <span class="chip">🤖 ${botExcluded} game(s) vs a bot/computer excluded</span>`;
  if (failureCounts.size) {
    const rows = [...failureCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([reason, { count, sample }]) => `<li><b>${count}×</b> ${esc(reason)} <span class="hint">— e.g. "${esc(sample)}"</span></li>`)
      .join('');
    note += `<details class="parse-errors"><summary>Why ${failed} item(s) failed to parse</summary><ul>${rows}</ul></details>`;
  }
  fileSummaryEl.innerHTML = (parsedGames.length ? `<span class="chip">♟ ${parsedGames.length} game(s) loaded</span>` : '') + note;
  render();
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void handleGameFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files?.length) void handleGameFiles(files);
});

// ---------- player detection (same heuristic as the other tools) ----------
function detectMainPlayer(games: ParsedGame[]): { name: string; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of games) {
    for (const key of ['White', 'Black'] as const) {
      const name = g.headers[key];
      if (!name || name === '?') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  const groups = groupPlayerNames(counts);
  groups.sort((a, b) => b.count - a.count);
  const best = groups[0];
  return { name: best.display, matchKeys: best.keys };
}

// ---------- comparison + rendering ----------
interface ResultRow {
  game: ParsedGame;
  opponent: string;
  result: Result;
  date: string;
  link: string | null;
  cmp: GameDeviationResult;
}

function resultOf(userIsWhite: boolean, resultRaw: string): Result {
  if (resultRaw === '1-0') return userIsWhite ? 'win' : 'loss';
  if (resultRaw === '0-1') return userIsWhite ? 'loss' : 'win';
  if (resultRaw === '1/2-1/2') return 'draw';
  return 'unknown';
}

function movePairsHtml(plies: GameDeviationResult['plies']): string {
  const cls = (s: PlyStatus) => (s === 'book' ? 'dev-book' : s === 'deviation' ? 'dev-deviation' : 'dev-endbook');
  const byMoveNo = new Map<number, { white?: (typeof plies)[number]; black?: (typeof plies)[number] }>();
  for (const p of plies) {
    const slot = byMoveNo.get(p.moveNo) ?? {};
    if (p.color === 'w') slot.white = p; else slot.black = p;
    byMoveNo.set(p.moveNo, slot);
  }
  const rows = [...byMoveNo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, { white, black }]) => {
      const w = white ? `<span class="lpm-move ${cls(white.status)}">${esc(white.san)}</span>` : `<span class="lpm-move lpm-empty"></span>`;
      const b = black ? `<span class="lpm-move ${cls(black.status)}">${esc(black.san)}</span>` : `<span class="lpm-move lpm-empty"></span>`;
      return `<span class="lpm-num">${no}.</span>${w}${b}`;
    })
    .join('');
  return `<div class="live-pgn-moves">${rows}</div>`;
}

function statusChipHtml(cmp: GameDeviationResult): string {
  if (!cmp.deviation) return `<span class="dev-status-chip dev-full">✓ Followed repertoire the whole game</span>`;
  const label = plyLabel(cmp.deviation.moveNo, cmp.deviation.color, cmp.deviation.san);
  return cmp.deviation.reason === 'end-of-book'
    ? `<span class="dev-status-chip dev-endbook">↴ Left prepared theory at ${esc(label)}</span>`
    : `<span class="dev-status-chip dev-deviation">⚠ Deviated at ${esc(label)}</span>`;
}

function render() {
  if (!repTree || !parsedGames.length) {
    resultsCard.hidden = true;
    return;
  }
  const detected = detectMainPlayer(parsedGames);
  if (!detected) {
    resultsCard.hidden = false;
    resultsSummaryEl.innerHTML = '';
    resultsNoteEl.innerHTML = `⚠ Couldn't detect a single common player across the uploaded games — Openings Deviation compares one player's moves against the repertoire. Make sure that player's name appears consistently in the PGN headers.`;
    resultsTbody.innerHTML = '';
    return;
  }
  const repColor = repColorSelect.value as Color;

  const rows: ResultRow[] = [];
  let skippedColor = 0;
  let skippedNotInvolved = 0;

  for (const g of parsedGames) {
    const h = g.headers;
    const hasWhiteName = !!h['White'] && h['White'] !== '?';
    const hasBlackName = !!h['Black'] && h['Black'] !== '?';
    if (hasWhiteName || hasBlackName) {
      const involved = detected.matchKeys.has(nameKey(h['White'] ?? '')) || detected.matchKeys.has(nameKey(h['Black'] ?? ''));
      if (!involved) { skippedNotInvolved++; continue; }
    }
    const userIsWhite = detected.matchKeys.has(nameKey(h['White'] ?? ''));
    const playerColor: Color = userIsWhite ? 'w' : 'b';
    if (playerColor !== repColor) { skippedColor++; continue; }

    const cmp = compareGameToRepertoire(g.moves, repTree);
    rows.push({
      game: g,
      opponent: (userIsWhite ? h['Black'] : h['White']) || 'Unknown',
      result: resultOf(userIsWhite, h['Result'] ?? '*'),
      date: h['Date'] ?? h['UTCDate'] ?? '',
      link: gameLink(h),
      cmp,
    });
  }

  resultsCard.hidden = false;

  const compared = rows.length;
  const fullBook = rows.filter((r) => !r.cmp.deviation).length;
  const endOfBook = rows.filter((r) => r.cmp.deviation?.reason === 'end-of-book').length;
  const deviated = rows.filter((r) => r.cmp.deviation?.reason === 'deviation').length;
  const avgInBook = compared ? Math.round((rows.reduce((s, r) => s + r.cmp.inRepertoireCount, 0) / compared) * 10) / 10 : 0;

  resultsSummaryEl.innerHTML = `
    <div class="stat-card"><span class="big">${compared}</span><span class="label">Games compared</span></div>
    <div class="stat-card"><span class="big">${fullBook}</span><span class="label">Stayed in book</span></div>
    <div class="stat-card"><span class="big">${deviated}</span><span class="label">Real deviations</span></div>
    <div class="stat-card"><span class="big">${endOfBook}</span><span class="label">Ran past prep</span></div>
    <div class="stat-card"><span class="big">${avgInBook}</span><span class="label">Avg. moves in book</span></div>
  `;

  const skipParts: string[] = [];
  if (skippedColor) skipParts.push(`${skippedColor} game(s) skipped — <b>${esc(detected.name)}</b> played the other color (repertoire is for ${repColor === 'w' ? 'White' : 'Black'})`);
  if (skippedNotInvolved) skipParts.push(`${skippedNotInvolved} game(s) skipped — didn't involve ${esc(detected.name)}`);
  resultsNoteEl.innerHTML = `Comparing <b>${esc(detected.name)}</b>'s moves (${parsedGames.length} game(s) loaded).` + (skipParts.length ? ' ' + skipParts.join('. ') + '.' : '');

  if (!compared) {
    resultsTbody.innerHTML = `<tr><td colspan="7" class="hint">No games matched the selected color for this repertoire.</td></tr>`;
    return;
  }

  const resultLabel = (r: Result) => (r === 'win' ? 'Win' : r === 'loss' ? 'Loss' : r === 'draw' ? 'Draw' : '—');
  const resultClass = (r: Result) => (r === 'win' ? 'pos' : r === 'loss' ? 'neg' : r === 'draw' ? 'mid' : '');

  resultsTbody.innerHTML = rows
    .map((r, i) => {
      const leftAt = r.cmp.deviation ? plyLabel(r.cmp.deviation.moveNo, r.cmp.deviation.color, r.cmp.deviation.san) : '—';
      const opponentCell = r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.opponent)} ↗</a>` : esc(r.opponent);
      return `
      <tr>
        <td>${opponentCell}</td>
        <td class="${resultClass(r.result)}">${resultLabel(r.result)}</td>
        <td class="hint">${esc(r.date.slice(0, 10))}</td>
        <td class="num">${r.cmp.inRepertoireCount}</td>
        <td class="num">${r.cmp.outOfRepertoireCount}</td>
        <td>${statusChipHtml(r.cmp)}</td>
        <td><button class="btn-icon moves-toggle" data-idx="${i}" title="Show moves">☰</button></td>
      </tr>
      <tr class="moves-row" id="dev-moves-row-${i}" hidden>
        <td colspan="7"><div class="dev-moves-wrap">${movePairsHtml(r.cmp.plies)}</div></td>
      </tr>`;
    })
    .join('');

  resultsTbody.querySelectorAll<HTMLButtonElement>('.moves-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = $(`#dev-moves-row-${btn.dataset.idx}`);
      row.hidden = !row.hidden;
    });
  });
}

render();
