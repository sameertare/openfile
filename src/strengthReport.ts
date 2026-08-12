import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, isBotOrComputerGame, splitPgn, tryParseGame } from './pgn';
import { Engine } from './engine';
import { analyzeGame, positionsNeeded } from './analyze';
import { aggregate, scorePct, themeUrl } from './aggregate';
import type { Aggregates, OpeningRow, WDL } from './aggregate';
import type { GameRecord } from './types';
import { renderLineChartSvg } from './linechart';
import { renderSparklineSvg } from './sparkline';
import { assessGame } from './gameAssessment';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { groupPlayerNames, nameKey } from './playerMatch';
import type { NameGroup } from './playerMatch';

registerServiceWorker();
initTheme();

// A leaner, single-purpose sibling of Performance Analysis (src/main.ts): drop/upload a PGN (or
// paste a single game's text directly) and run it through the same Stockfish analysis core, but
// the report itself only covers opening/phase/tactics strengths and weaknesses — no lichess/
// chess.com account fetching, training-plan generator, puzzle trainer, head-to-head, time-trouble
// section, or report persistence (download/re-upload to extend over time). Each analysis run here
// is a self-contained, one-off report, not something meant to accumulate across sessions.

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let records: GameRecord[] = [];
let detectedUsername: string | null = null;
let detectedMatchKeys: Set<string> | null = null;
// Every distinct player identity found across the loaded games (sorted most-games-first), so the
// "Analyze for" selector can offer every side rather than silently committing to whichever name
// detectMainPlayer() happens to pick — that matters most for a single pasted game, where White and
// Black both appear exactly once and the frequency heuristic has no real signal to break the tie.
let playerGroups: NameGroup[] = [];

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const pastePgnInput = $('#paste-pgn') as HTMLTextAreaElement;
const pastePgnBtn = $('#paste-pgn-btn') as HTMLButtonElement;
const pastePgnClearBtn = $('#paste-pgn-clear-btn') as HTMLButtonElement;
const pastePgnStatusEl = $('#paste-pgn-status');
const configCard = $('#config-card');
const analyzeForRow = $('#analyze-for-row');
const analyzeForSelect = $('#analyze-for-select') as HTMLSelectElement;
const detectedPlayerName = $('#detected-player-name');
const detectedPlayerCount = $('#detected-player-count');
const depthSelect = $('#depth-select') as HTMLSelectElement;
const analyzeBtn = $('#analyze-btn') as HTMLButtonElement;
const progressWrap = $('#progress-wrap');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const resultsEl = $('#results');

function isPlayerNameMatch(name: string | undefined, matchKeys: Set<string>): boolean {
  return !!name && name !== '?' && matchKeys.has(nameKey(name));
}
function hasAnyPlayerName(g: ParsedGame, matchKeys: Set<string>): boolean {
  return isPlayerNameMatch(g.headers['White'], matchKeys) || isPlayerNameMatch(g.headers['Black'], matchKeys);
}
function hasAnyNameAtAll(g: ParsedGame): boolean {
  return (!!g.headers['White'] && g.headers['White'] !== '?') || (!!g.headers['Black'] && g.headers['Black'] !== '?');
}
// A chapter with no [White]/[Black] tags at all has no other player to attribute it to, so it's
// assumed to be the analyzed player's game (analyzeGame infers their color from the chapter title
// when possible).
function gamesForPlayer(matchKeys: Set<string>): ParsedGame[] {
  return parsedGames.filter((g) => (hasAnyNameAtAll(g) ? hasAnyPlayerName(g, matchKeys) : true));
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

// ---------- file loading ----------
async function handleFiles(files: FileList | File[]): Promise<{ parsed: number; failed: number; botExcluded: number }> {
  let parsed = 0;
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
        if (isBotOrComputerGame(game.headers)) {
          botExcluded++;
          continue;
        }
        parsedGames.push(game);
        parsed++;
      } else {
        failed++;
        if (error) recordFailure(error);
      }
    }
  }
  // de-dupe parsed games by id
  const seen = new Set<string>();
  parsedGames = parsedGames.filter((g) => {
    const id = gameId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const detected = parsedGames.length ? detectMainPlayer() : null;
  detectedUsername = detected?.name ?? null;
  detectedMatchKeys = detected?.matchKeys ?? null;

  const chips: string[] = [];
  if (parsedGames.length) chips.push(`<span class="chip">♟ ${parsedGames.length} game(s) loaded</span>`);
  if (failed) chips.push(`<span class="chip">⚠ ${failed} item(s) could not be parsed</span>`);
  if (botExcluded) chips.push(`<span class="chip">🤖 ${botExcluded} game(s) vs a bot/computer excluded</span>`);
  let html = chips.join(' ');
  if (failureCounts.size) {
    const rows = [...failureCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(
        ([reason, { count, sample }]) =>
          `<li><b>${count}×</b> ${esc(reason)} <span class="hint">— e.g. "${esc(sample)}"</span></li>`
      )
      .join('');
    html += `<details class="parse-errors"><summary>Why ${failed} item(s) failed to parse</summary><ul>${rows}</ul></details>`;
  }
  fileSummary.innerHTML = html;

  if (parsedGames.length) {
    populateAnalyzeForSelect();
    detectedPlayerName.textContent = detectedUsername ?? '—';
    const total = detectedMatchKeys ? gamesForPlayer(detectedMatchKeys).length : 0;
    detectedPlayerCount.textContent = detectedMatchKeys ? ` — ${total} game${total === 1 ? '' : 's'} will be analyzed` : '';
    configCard.hidden = false;
    configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  return { parsed, failed, botExcluded };
}

// Auto-detects who the report is for: the player appearing in the most games. Name variants that
// likely refer to the same person (different casing, "Last, First" vs "First Last", or a
// nickname/first-name-only form) are folded together by groupPlayerNames() so a game set with
// inconsistent naming doesn't silently drop that player's games from the report. Also refreshes
// `playerGroups` with every distinct identity found, so populateAnalyzeForSelect() can offer a
// manual override — the frequency heuristic here is a genuine coin-flip for a single game (White
// and Black each appear exactly once), so it must never be the *only* way to pick a side.
function detectMainPlayer(): { name: string; count: number; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
    for (const key of ['White', 'Black'] as const) {
      const name = g.headers[key];
      if (!name || name === '?') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!counts.size) {
    playerGroups = [];
    return null;
  }

  const groups = groupPlayerNames(counts);
  groups.sort((a, b) => b.count - a.count);
  playerGroups = groups;
  const best = groups[0];
  return { name: best.display, count: best.count, matchKeys: new Set(best.keys) };
}

// Lets the TD/player override which side a loaded game set is analyzed for, instead of silently
// trusting the most-games-wins heuristic — critical for a single pasted game, where White and
// Black both appear exactly once and there's no real frequency signal to break the tie (it was
// defaulting to whichever side detectMainPlayer() iterates first, which reads as "always analyzes
// the opponent" for anyone who consistently pastes games where they played the other color).
function populateAnalyzeForSelect() {
  // Only surface the picker when the top spot is genuinely ambiguous (a tie on game count) — a
  // single pasted game is the common case (White and Black both at 1), but any tie qualifies.
  // A normal multi-game report has a clear most-frequent player and doesn't need this shown.
  const ambiguous = playerGroups.length >= 2 && playerGroups[0].count === playerGroups[1].count;
  analyzeForRow.hidden = !ambiguous;
  const currentKey = detectedMatchKeys ? [...detectedMatchKeys][0] : null;
  analyzeForSelect.innerHTML = playerGroups
    .map((g, i) => {
      const selected = currentKey !== null ? g.keys.has(currentKey) : i === 0;
      return `<option value="${i}"${selected ? ' selected' : ''}>${esc(g.display)} (${g.count} game${g.count === 1 ? '' : 's'})</option>`;
    })
    .join('');
}
analyzeForSelect.addEventListener('change', () => {
  const g = playerGroups[parseInt(analyzeForSelect.value, 10)];
  if (!g) return;
  detectedUsername = g.display;
  detectedMatchKeys = new Set(g.keys);
  detectedPlayerName.textContent = detectedUsername;
  const total = gamesForPlayer(detectedMatchKeys).length;
  detectedPlayerCount.textContent = ` — ${total} game${total === 1 ? '' : 's'} will be analyzed`;
});

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void handleFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer?.files.length) void handleFiles(e.dataTransfer.files);
});
$('#load-sample').addEventListener('click', async () => {
  const resp = await fetch(`${import.meta.env.BASE_URL}samples/sample-games.pgn`);
  const text = await resp.text();
  const file = new File([text], 'sample-games.pgn');
  await handleFiles([file]);
});

// ---------- paste a single game's PGN ----------
pastePgnBtn.addEventListener('click', () => void loadPastedPgn());

async function loadPastedPgn() {
  const text = pastePgnInput.value.trim();
  if (!text) {
    pastePgnStatusEl.textContent = 'Paste a game\'s PGN text first.';
    return;
  }
  const { parsed, failed } = await handleFiles([new File([text], 'pasted-game.pgn')]);
  if (parsed > 0) {
    pastePgnStatusEl.textContent = `Loaded ${parsed} game${parsed === 1 ? '' : 's'} from the pasted PGN.`;
  } else if (failed > 0) {
    pastePgnStatusEl.textContent = 'Could not parse the pasted text as a game — check that it includes move text, not just headers.';
  } else {
    pastePgnStatusEl.textContent = 'No new game found — this game (or a bot/computer game) was already loaded or excluded.';
  }
}
pastePgnClearBtn.addEventListener('click', () => {
  pastePgnInput.value = '';
  pastePgnStatusEl.textContent = '';
});

// ---------- analysis ----------
analyzeBtn.addEventListener('click', () => void runAnalysis());

async function runAnalysis() {
  const username = detectedUsername;
  const matchKeys = detectedMatchKeys;
  if (!username || !matchKeys) {
    progressWrap.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = "Couldn't detect a player in the loaded games — check that your PGN files include White/Black player names.";
    return;
  }
  const depth = parseInt(depthSelect.value, 10);
  const useEngine = depth > 0;

  analyzeBtn.disabled = true;
  progressWrap.hidden = false;

  const toAnalyze = gamesForPlayer(matchKeys);

  let engine: Engine | null = null;
  try {
    if (useEngine && toAnalyze.some((g) => positionsNeeded(g, true) > 0)) {
      progressText.textContent = 'Loading Stockfish 18 (first load fetches the neural network — ~38 MB)…';
      engine = new Engine();
      await engine.init();
    }

    const totalPositions = toAnalyze.reduce((s, g) => s + positionsNeeded(g, useEngine), 0);
    let done = 0;
    const newRecords: GameRecord[] = [];
    for (let i = 0; i < toAnalyze.length; i++) {
      const g = toAnalyze[i];
      const label = g.headers['White'] && g.headers['Black']
        ? `${g.headers['White']} vs ${g.headers['Black']}`
        : g.headers['ChapterName'] || g.headers['Event'] || 'untitled game';
      progressText.textContent = `Analyzing game ${i + 1} of ${toAnalyze.length}… (${label})`;
      const rec = await analyzeGame(toAnalyze[i], {
        username,
        matchKeys,
        depth,
        engine,
        onPosition: () => {
          done++;
          if (totalPositions > 0) progressFill.style.width = `${(done / totalPositions) * 100}%`;
        },
      });
      newRecords.push(rec);
      if (totalPositions === 0) progressFill.style.width = `${((i + 1) / toAnalyze.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    records = newRecords;
    const agg = aggregate(records);
    renderResults(agg, username);
    progressFill.style.width = '100%';
    progressText.textContent = `Done — ${records.length} game(s) analyzed.`;
  } catch (err) {
    progressText.textContent = `Analysis error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  } finally {
    engine?.destroy();
    analyzeBtn.disabled = false;
  }
}

// ---------- report rendering ----------
function pct(v: number | null, cls = true): string {
  if (v === null) return '—';
  const c = cls ? (v >= 90 ? 'pos' : v < 70 ? 'neg' : 'mid') : '';
  return `<span class="${c}">${v}%</span>`;
}
function wdlRow(label: string, w: WDL, extra = ''): string {
  return `<tr><td>${label}</td><td class="num">${w.games}</td><td class="num">${w.wins}</td><td class="num">${w.draws}</td><td class="num">${w.losses}</td><td class="num">${pct(scorePct(w), false)}</td>${extra}</tr>`;
}
function openingTableHtml(rows: OpeningRow[], emptyMsg: string): string {
  if (!rows.length) return `<p class="section-note">${emptyMsg}</p>`;
  return `<table><thead><tr><th>Opening</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>
    ${rows
      .map(
        (r) =>
          `<tr><td>${esc(r.family)}${r.eco ? ` <span class="hint">(${esc(r.eco)})</span>` : ''}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${r.draws}</td><td class="num">${r.losses}</td><td class="num">${pct(scorePct(r), false)}</td><td class="num">${pct(r.avgAccuracy)}</td></tr>`
      )
      .join('')}
  </tbody></table>`;
}
function mdBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Per-game strength/weakness breakdown, derived purely from GameRecord fields already computed by
// analyzeGame() — same source assessGame() (gameAssessment.ts) already powers on Performance
// Analysis's games list. Cites the actual flagged moves for each phase rather than just an
// accuracy number, and — unlike the aggregate-level "Patterns detected" section below — never
// implies a repeatable trend from a single game (a one-off opening line is labeled as such, not
// scored against a "weakest phase" that a sample of one can't actually establish).
function assessmentHtml(g: GameRecord, openingsByFamily?: Map<string, OpeningRow>): string {
  const a = assessGame(g, openingsByFamily?.get(g.family));
  if (!a) return '<p class="section-note">No move-quality data for this game.</p>';
  const verdictCls = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? 'pos' : v === 'weakness' ? 'neg' : 'mid');
  const verdictIcon = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? '✓' : v === 'weakness' ? '✗' : '·');
  const phaseRows = a.phases
    .map(
      (ph) =>
        `<li><span class="${verdictCls(ph.verdict)}">${verdictIcon(ph.verdict)} ${ph.phase[0].toUpperCase() + ph.phase.slice(1)}</span> — ${mdBold(esc(ph.summary))}</li>`
    )
    .join('');
  const strengthsHtml = a.strengths.length
    ? `<p><b>Strengths</b></p><ul class="pattern-list">${a.strengths.map((s) => `<li><span class="pos">✓</span> ${mdBold(esc(s))}</li>`).join('')}</ul>`
    : '';
  const weaknessesHtml = a.weaknesses.length
    ? `<p><b>Weaknesses</b></p><ul class="pattern-list">${a.weaknesses.map((s) => `<li><span class="neg">✗</span> ${mdBold(esc(s))}</li>`).join('')}</ul>`
    : '';
  return `
    <p><b>Overall:</b> ${mdBold(esc(a.overall))}</p>
    <p><b>By phase</b></p>
    <ul class="pattern-list">${phaseRows}</ul>
    ${strengthsHtml}
    ${weaknessesHtml}
  `;
}

function gamesSectionHtml(games: GameRecord[], openings: OpeningRow[]): string {
  if (!games.length) return '';
  const openingsByFamily = new Map(openings.map((o) => [o.family, o]));
  const rows = [...games]
    .sort((x, y) => y.date.localeCompare(x.date))
    .map((g) => {
      const resultCls = g.result === 'win' ? 'pos' : g.result === 'loss' ? 'neg' : g.result === 'draw' ? 'mid' : '';
      const resultLabel = g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Unfinished';
      const opponent = g.userColor === 'w' ? g.black : g.white;
      const colorGlyph = g.userColor === 'w' ? '♔' : '♚';
      const spark = g.evalGraph && g.evalGraph.length > 1
        ? renderSparklineSvg(g.evalGraph, { width: 140, height: 28 })
        : `<span class="hint">no engine data</span>`;
      const assessBtn = g.analyzed
        ? `<button class="btn-icon assess-btn" data-id="${esc(g.id)}" title="Detailed phase-by-phase analysis">🩺</button>`
        : '';
      const assessRow = g.analyzed
        ? `<tr class="explain-row assess-row" data-id="${esc(g.id)}" hidden><td></td><td colspan="6">${assessmentHtml(g, openingsByFamily)}</td></tr>`
        : '';
      return `<tr>
        <td>${esc(g.date)}</td>
        <td>${colorGlyph} ${esc(opponent)}</td>
        <td><span class="${resultCls}">${resultLabel}</span></td>
        <td>${esc(g.family)}</td>
        <td class="num">${g.accuracy.overall != null ? g.accuracy.overall + '%' : '—'}</td>
        <td class="spark-cell">${spark}</td>
        <td class="num">${assessBtn}</td>
      </tr>${assessRow}`;
    })
    .join('');
  return `<div class="card span-2"><h2>📈 Games</h2>
    <div class="games-table-wrap"><table><thead><tr>
      <th>Date</th><th>Opponent</th><th>Result</th><th>Opening</th><th class="num">Accuracy</th><th>Eval graph</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Click 🩺 for a detailed, phase-by-phase strengths/weaknesses breakdown of that specific game — the source for what a single game's opening/middlegame/endgame play actually looked like, not just an aggregate accuracy number.</p>
  </div>`;
}

function renderResults(a: Aggregates, username: string) {
  const p = a.patterns;
  const html: string[] = [];
  const isSingleGame = a.analyzedCount <= 1;

  const unfinishedCount = records.length - a.total.games;
  html.push(`<div class="card">
    <h2>Results for <b>${esc(username)}</b></h2>
    <p class="section-note">${a.analyzedCount} of ${records.length} games have move-quality data${unfinishedCount ? ` · ${unfinishedCount} unfinished/undecided game(s) excluded from W-D-L and score` : ''}</p>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${a.total.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${a.total.wins}-${a.total.draws}-${a.total.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pct(scorePct(a.total), false)}</span><span class="label">Score</span></div>
      <div class="stat-card"><span class="big">${a.overallAccuracy !== null ? a.overallAccuracy + '%' : '—'}</span><span class="label">Accuracy</span></div>
      <div class="stat-card"><span class="big">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
    </div>
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>
      ${wdlRow('As White', a.byColor.white)}
      ${wdlRow('As Black', a.byColor.black)}
    </tbody></table>
  </div>`);

  html.push(gamesSectionHtml(records, a.openings));

  const rc = a.repertoireCoverage;
  html.push(`<div class="card span-2"><h2>♟ Opening strength &amp; weakness</h2>
    ${
      rc.coveragePct !== null
        ? `<div class="summary-cards">
      <div class="stat-card"><span class="big">${rc.coveragePct}%</span><span class="label">Repertoire coverage</span></div>
      <div class="stat-card"><span class="big">${rc.preparedGames}</span><span class="label">Games in a known line (2+ played)</span></div>
      <div class="stat-card"><span class="big mid">${rc.improvisedGames}</span><span class="label">Games in a one-off line</span></div>
    </div>`
        : ''
    }
    <h3>Strongest openings</h3>${openingTableHtml(a.strongest, 'Need at least 2 games in an opening (with ≥50% score) to rank it.')}
    <h3>Weakest openings</h3>${openingTableHtml(a.weakest, 'No openings scoring below 50% with 2+ games — nice.')}
  </div>`);

  const egRows = Object.entries(p.endgameTypeCounts).sort((x, y) => y[1].games - x[1].games);
  html.push(`<div class="card span-2"><h2>📊 Middlegame &amp; endgame weakness</h2>
    <table><thead><tr><th>Phase</th><th class="num">Accuracy</th><th class="num">Inaccuracies</th><th class="num">Mistakes</th><th class="num">Blunders</th><th class="num">Blunders/game</th><th class="num">Losses decided here</th></tr></thead><tbody>
    ${a.phases
      .map(
        (ph) =>
          `<tr><td>${ph.phase[0].toUpperCase() + ph.phase.slice(1)}</td><td class="num">${pct(ph.avgAccuracy)}</td><td class="num">${ph.inaccuracies}</td><td class="num">${ph.mistakes}</td><td class="num neg">${ph.blunders}</td><td class="num">${ph.blundersPerGame}</td><td class="num">${ph.decisiveErrorsInLosses}</td></tr>`
      )
      .join('')}
    </tbody></table>
    ${
      egRows.length
        ? `<h3>Endgame types reached</h3><table><thead><tr><th>Type</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>${egRows.map(([type, w]) => wdlRow(esc(type), w)).join('')}</tbody></table>`
        : ''
    }
    ${
      a.errorsByMove.length > 1
        ? `<h3>Errors by move number</h3>
    <p class="section-note">Where inaccuracies, mistakes and blunders actually land across the whole game — more granular than the opening/middlegame/endgame split above, since two games can reach the endgame at very different move numbers.</p>
    ${renderLineChartSvg(
      [
        { label: 'Inaccuracies', values: a.errorsByMove.map((e) => e.inaccuracies), color: 'var(--blue)' },
        { label: 'Mistakes', values: a.errorsByMove.map((e) => e.mistakes), color: 'var(--gold)' },
        { label: 'Blunders', values: a.errorsByMove.map((e) => e.blunders), color: 'var(--red)' },
      ],
      { xLabels: a.errorsByMove.map((e) => String(e.moveNo)) }
    )}`
        : ''
    }
  </div>`);

  html.push(`<div class="card span-2"><h2>⚔ Tactical motifs: strengths &amp; misses</h2>
    <div class="summary-cards">
      <div class="stat-card"><span class="big neg">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
      <div class="stat-card"><span class="big neg">${a.tactics.missedWins}</span><span class="label">Missed wins</span></div>
      <div class="stat-card"><span class="big neg">${a.tactics.missedMates}</span><span class="label">Missed mates</span></div>
      <div class="stat-card"><span class="big mid">${a.tactics.missedTactics}</span><span class="label">Missed tactics</span></div>
    </div>
    ${
      a.tactics.worstMoments.length
        ? `<h3>Biggest single-move swings</h3><table><thead><tr><th>Game</th><th class="num">Move</th><th>Played</th><th>Type</th><th>Win% swing</th><th>Engine best</th></tr></thead><tbody>${a.tactics.worstMoments
            .map(({ game, move }) => {
              const label = `${esc(game.white)} vs ${esc(game.black)} (${esc(game.date)})`;
              const link = game.site.startsWith('http') ? `<a href="${esc(game.site)}" target="_blank" rel="noopener">${label}</a>` : label;
              return `<tr><td>${link}</td><td class="num">${move.moveNo}</td><td>${esc(move.san)}</td><td>${move.kind}</td><td><span class="pos">${move.winPctBefore}%</span> → <span class="neg">${move.winPctAfter}%</span></td><td>${move.best ? esc(move.best) : '—'}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : '<p class="section-note">No major swings detected (or engine analysis was skipped).</p>'
    }
    <h3>Errors: wins vs losses</h3>
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">Inaccuracies</th><th class="num">Mistakes</th><th class="num">Blunders</th></tr></thead><tbody>
      <tr><td>In wins</td><td class="num">${p.analyzedWins}</td><td class="num">${p.errorsInWins.inaccuracies}</td><td class="num">${p.errorsInWins.mistakes}</td><td class="num">${p.errorsInWins.blunders}</td></tr>
      <tr><td>In losses</td><td class="num">${p.analyzedLosses}</td><td class="num">${p.errorsInLosses.inaccuracies}</td><td class="num">${p.errorsInLosses.mistakes}</td><td class="num">${p.errorsInLosses.blunders}</td></tr>
    </tbody></table>
  </div>`);

  // For a single analyzed game, the aggregate narrative (e.g. "Phase gap: strongest phase is X,
  // weakest is Y") reads as a repeatable trend when it isn't one — a single game's opening
  // accuracy in particular is heavily shaped by what the opponent chose to play, not just your own
  // prep, so calling it a "weakest phase" from one data point is misleading. Point to the per-game
  // breakdown above instead, which grounds every phase verdict in this specific game's actual
  // moves rather than an aggregate comparison that needs more than one game to mean anything.
  html.push(`<div class="card"><h2>🔍 Patterns detected</h2>
    ${
      isSingleGame
        ? '<p class="section-note">Patterns need more than one game to mean anything reliable — a single game\'s phase accuracy is shaped as much by what your opponent played as by your own strengths. See the detailed, move-by-move breakdown for this game above (click 🩺 next to it).</p>'
        : p.narrative.length
          ? `<ul class="pattern-list">${p.narrative.map((n) => `<li>${mdBold(esc(n))}</li>`).join('')}</ul>`
          : '<p class="section-note">Not enough analyzed games to detect reliable patterns yet — keep adding games.</p>'
    }
  </div>`);

  html.push(`<div class="card span-2"><h2>🎯 Tactical motifs to drill</h2>
    ${
      a.recommendations.length
        ? a.recommendations
            .map(
              (r) => `<div class="rec-card sev-${r.severity}">
        <h4>${esc(r.area)}<span class="sev-tag">${r.severity} priority</span></h4>
        <p class="section-note">${esc(r.why)}</p>
        <div class="theme-links">${r.themes.map((t) => `<a href="${themeUrl(t.name)}" target="_blank" rel="noopener">🧩 ${esc(t.label)}</a>`).join('')}</div>
      </div>`
            )
            .join('')
        : '<p class="section-note">Run engine analysis to unlock motif-specific weaknesses.</p>'
    }
    <p class="hint">Links open lichess.org training themes (free) for the motifs showing up most in your losses/blunders.</p>
  </div>`);

  resultsEl.innerHTML = `<div class="card-grid">${html.join('')}</div>`;
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

resultsEl.addEventListener('click', (e) => {
  const assessBtn = (e.target as HTMLElement).closest('.assess-btn') as HTMLButtonElement | null;
  if (!assessBtn) return;
  const row = assessBtn.closest('tr')?.nextElementSibling as HTMLElement | null;
  if (row?.classList.contains('assess-row')) row.hidden = !row.hidden;
});
