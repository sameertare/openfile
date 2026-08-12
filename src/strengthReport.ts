import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, isBotOrComputerGame, splitPgn, tryParseGame } from './pgn';
import { Engine } from './engine';
import { analyzeGame, positionsNeeded } from './analyze';
import { aggregate, scorePct, themeUrl } from './aggregate';
import type { Aggregates, OpeningRow, WDL } from './aggregate';
import type { GameRecord } from './types';
import { renderLineChartSvg } from './linechart';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { groupPlayerNames, nameKey } from './playerMatch';

registerServiceWorker();
initTheme();

// A leaner, single-purpose sibling of Performance Analysis (src/main.ts): same upload/fetch and
// engine-analysis pipeline, but the report itself only covers opening/phase/tactics strengths and
// weaknesses — no training-plan generator, puzzle trainer, head-to-head, time-trouble section, or
// report persistence (download/re-upload to extend over time). Each analysis run here is a
// self-contained, one-off report, not something meant to accumulate across sessions.

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let records: GameRecord[] = [];
let detectedUsername: string | null = null;
let detectedMatchKeys: Set<string> | null = null;
// Every username explicitly fetched via the lichess/chess.com account-fetch below — a self-declared
// "this is me" that detectMainPlayer() folds into the primary identity's matchKeys even when it's a
// different literal handle than the other platform, so one report can combine both.
let fetchedUsernames: Set<string> = new Set();

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const pastePgnInput = $('#paste-pgn') as HTMLTextAreaElement;
const pastePgnBtn = $('#paste-pgn-btn') as HTMLButtonElement;
const pastePgnClearBtn = $('#paste-pgn-clear-btn') as HTMLButtonElement;
const pastePgnStatusEl = $('#paste-pgn-status');
const lichessUsernameInput = $('#lichess-username') as HTMLInputElement;
const lichessMaxSelect = $('#lichess-max') as HTMLSelectElement;
const lichessMaxLabel = $('#lichess-max-label');
const lichessFetchBtn = $('#lichess-fetch-btn') as HTMLButtonElement;
const lichessStatusEl = $('#lichess-status');
const chesscomUsernameInput = $('#chesscom-username') as HTMLInputElement;
const chesscomMaxSelect = $('#chesscom-max') as HTMLSelectElement;
const chesscomMaxLabel = $('#chesscom-max-label');
const chesscomFetchBtn = $('#chesscom-fetch-btn') as HTMLButtonElement;
const chesscomStatusEl = $('#chesscom-status');
const combineToggle = $('#combine-toggle') as HTMLInputElement;
const combineRow = $('#combine-row');
const combineSinceInput = $('#combine-since') as HTMLInputElement;
const combineBtn = $('#combine-btn') as HTMLButtonElement;
const combineStatusEl = $('#combine-status');
const configCard = $('#config-card');
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
// inconsistent naming doesn't silently drop that player's games from the report.
function detectMainPlayer(): { name: string; count: number; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
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

  // Fold in every explicitly-fetched username's group, even ones groupPlayerNames wouldn't treat
  // as a variant of the primary name (e.g. a chess.com handle that looks nothing like the lichess
  // one) — fetching an account here is an explicit "this is me" the frequency heuristic can't infer.
  const matchKeys = new Set(best.keys);
  for (const uname of fetchedUsernames) {
    const key = nameKey(uname);
    matchKeys.add(key);
    for (const g of groups) {
      if (g !== best && g.keys.has(key)) for (const k of g.keys) matchKeys.add(k);
    }
  }
  return { name: best.display, count: best.count, matchKeys };
}

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

// ---------- lichess / chess.com account fetch (cross-platform merge) ----------
lichessFetchBtn.addEventListener('click', () => void fetchFromLichess());
lichessUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromLichess();
});

// `max` and `sinceMs` are independent lichess API params — the game-count dropdown passes `max`
// only, the combined-report date picker passes `sinceMs` only (omitting `max` streams every game
// since that date, per lichess's own API default). `max === 'all'` also omits the param entirely
// — lichess streams the account's full history (unbounded) when it's left off.
async function fetchLichessPgnText(username: string, opts: { max?: string; sinceMs?: number }): Promise<string> {
  const params = new URLSearchParams({ pgnInJson: 'false', clocks: 'false', evals: 'false', opening: 'false' });
  if (opts.max && opts.max !== 'all') params.set('max', opts.max);
  if (opts.sinceMs) params.set('since', String(opts.sinceMs));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`;
  const resp = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
  if (resp.status === 404) throw new Error(`No lichess account named "${username}" found.`);
  if (resp.status === 429) throw new Error('Lichess is rate-limiting this request — wait a minute and try again.');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function fetchFromLichess() {
  const username = lichessUsernameInput.value.trim();
  if (!username) {
    lichessStatusEl.textContent = 'Enter a lichess username first.';
    return;
  }
  const max = lichessMaxSelect.value;
  lichessFetchBtn.disabled = true;
  lichessStatusEl.textContent =
    max === 'all'
      ? `Fetching ${username}'s entire lichess history… this can take a while for a long-tenured account.`
      : `Fetching up to ${max} games for ${username} from lichess… this can take a moment for larger counts.`;
  try {
    const text = await fetchLichessPgnText(username, { max });
    if (!text.trim()) {
      lichessStatusEl.textContent = `${username} has no games matching this request.`;
      return;
    }
    fetchedUsernames.add(username);
    const file = new File([text], `${username}-lichess.pgn`);
    await handleFiles([file]);
    lichessStatusEl.textContent = `Loaded games for ${username} from lichess.`;
  } catch (e) {
    lichessStatusEl.textContent = `Could not fetch from lichess: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    lichessFetchBtn.disabled = false;
  }
}

// Chess.com's public "Published Data API" has no single all-games endpoint like lichess, and no
// count-limited one either — games are grouped into monthly archives. To offer a "max games"
// control that matches lichess's, this walks archives newest-month-first, fetching one month at a
// time (has to be sequential, not parallel, since it needs to know the running total before
// deciding whether another month is needed) and stops as soon as it has enough, then trims to
// exactly that count — a month's own games arrive oldest-first, so the trim keeps its most recent
// games too.
interface ChessComArchivesResponse { archives: string[]; }
interface ChessComGamesResponse { games: { pgn?: string; url?: string; end_time?: number }[]; }

// Chess.com's own [Site] header is never a URL ("Chess.com", not a link), so the game's separate
// `url` field is injected as a [Link] header so gameLink()-style downstream code can still resolve
// a "View" link. Inserted right after [Event] rather than before it — splitPgn() treats any `\n`
// immediately followed by `[Event` as a new-game boundary.
function injectLinkHeader(pgn: string, url: string | undefined): string {
  if (!url || /\[Link /.test(pgn)) return pgn;
  return pgn.replace(/^(\[Event\s[^\n]*\n)/, `$1[Link "${url}"]\n`);
}

chesscomFetchBtn.addEventListener('click', () => void fetchFromChessCom());
chesscomUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromChessCom();
});

async function fetchChessComPgnText(username: string, opts: { maxGames?: number; sinceMs?: number }): Promise<string> {
  const archivesResp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
  if (archivesResp.status === 404) throw new Error(`No chess.com account named "${username}" found.`);
  if (!archivesResp.ok) throw new Error(`HTTP ${archivesResp.status}`);
  const archivesData: ChessComArchivesResponse = await archivesResp.json();
  const archives = archivesData.archives ?? [];
  if (!archives.length) return '';
  const sinceSec = opts.sinceMs ? Math.floor(opts.sinceMs / 1000) : null;
  const pgns: string[] = []; // accumulated newest-first
  for (let i = archives.length - 1; i >= 0; i--) {
    if (opts.maxGames !== undefined && pgns.length >= opts.maxGames) break;
    const m = archives[i].match(/\/(\d{4})\/(\d{2})$/);
    if (sinceSec !== null && m) {
      const archiveMonthEndSec = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10), 1) / 1000;
      if (archiveMonthEndSec <= sinceSec) break;
    }
    try {
      const r = await fetch(archives[i]);
      if (!r.ok) continue;
      const data: ChessComGamesResponse = await r.json();
      const monthPgns = (data.games ?? [])
        .filter((g): g is { pgn: string; url?: string; end_time?: number } => !!g.pgn)
        .filter((g) => sinceSec === null || (g.end_time ?? 0) >= sinceSec)
        .map((g) => injectLinkHeader(g.pgn, g.url))
        .reverse(); // a month's games arrive oldest-first; reverse so newest-first holds within it too
      pgns.push(...monthPgns);
    } catch {
      // one bad month shouldn't sink the whole fetch
    }
  }
  return (opts.maxGames !== undefined ? pgns.slice(0, opts.maxGames) : pgns).join('\n\n');
}

async function fetchFromChessCom() {
  const username = chesscomUsernameInput.value.trim();
  if (!username) {
    chesscomStatusEl.textContent = 'Enter a chess.com username first.';
    return;
  }
  const maxRaw = chesscomMaxSelect.value;
  const maxGames = maxRaw === 'all' ? undefined : parseInt(maxRaw, 10);
  chesscomFetchBtn.disabled = true;
  chesscomStatusEl.textContent =
    maxGames === undefined
      ? `Fetching ${username}'s entire chess.com history… this can take a while for a long-tenured account.`
      : `Fetching up to ${maxGames} game(s) for ${username} from chess.com…`;
  try {
    const text = await fetchChessComPgnText(username, { maxGames });
    if (!text.trim()) {
      chesscomStatusEl.textContent = `No games found for ${username}.`;
      return;
    }
    fetchedUsernames.add(username);
    const file = new File([text], `${username}-chesscom.pgn`);
    await handleFiles([file]);
    chesscomStatusEl.textContent = `Loaded games for ${username} from chess.com.`;
  } catch (e) {
    chesscomStatusEl.textContent = `Could not fetch from chess.com: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    chesscomFetchBtn.disabled = false;
  }
}

function updateCombineUi() {
  const on = combineToggle.checked;
  lichessFetchBtn.hidden = on;
  chesscomFetchBtn.hidden = on;
  lichessMaxLabel.hidden = on;
  chesscomMaxLabel.hidden = on;
  combineRow.hidden = !on;
}
combineToggle.addEventListener('change', updateCombineUi);
updateCombineUi();

combineBtn.addEventListener('click', () => void fetchCombined());

async function fetchCombined() {
  const lichessUsername = lichessUsernameInput.value.trim();
  const chesscomUsername = chesscomUsernameInput.value.trim();
  if (!lichessUsername && !chesscomUsername) {
    combineStatusEl.textContent = 'Enter at least one username above.';
    return;
  }
  const sinceMs = combineSinceInput.value ? new Date(`${combineSinceInput.value}T00:00:00`).getTime() : undefined;
  combineBtn.disabled = true;
  combineStatusEl.textContent = 'Fetching…';
  try {
    const files: File[] = [];
    if (lichessUsername) {
      combineStatusEl.textContent = `Fetching ${lichessUsername} from lichess…`;
      const text = await fetchLichessPgnText(lichessUsername, { sinceMs });
      if (text.trim()) {
        fetchedUsernames.add(lichessUsername);
        files.push(new File([text], `${lichessUsername}-lichess.pgn`));
      }
    }
    if (chesscomUsername) {
      combineStatusEl.textContent = `Fetching ${chesscomUsername} from chess.com…`;
      const text = await fetchChessComPgnText(chesscomUsername, { sinceMs });
      if (text.trim()) {
        fetchedUsernames.add(chesscomUsername);
        files.push(new File([text], `${chesscomUsername}-chesscom.pgn`));
      }
    }
    if (!files.length) {
      combineStatusEl.textContent = 'No games found for the given username(s).';
      return;
    }
    await handleFiles(files);
    combineStatusEl.textContent = `Loaded games from ${[lichessUsername && 'lichess', chesscomUsername && 'chess.com'].filter(Boolean).join(' + ')}.`;
  } catch (e) {
    combineStatusEl.textContent = `Could not fetch: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    combineBtn.disabled = false;
  }
}

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

function renderResults(a: Aggregates, username: string) {
  const p = a.patterns;
  const html: string[] = [];

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

  html.push(`<div class="card"><h2>🔍 Patterns detected</h2>
    ${
      p.narrative.length
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
