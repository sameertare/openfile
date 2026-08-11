import './style.css';
import { Chess } from 'chess.js';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, isBotOrComputerGame, splitPgn, tryParseGame } from './pgn';
import { Engine } from './engine';
import { analyzeGame, positionsNeeded } from './analyze';
import { aggregate, scorePct, themeUrl, opponentList, headToHeadWithOpponent } from './aggregate';
import type { Aggregates, OpeningRow, WDL, HeadToHeadOpponent } from './aggregate';
import { assessGame } from './gameAssessment';
import { mergeGames, parseMarkdownReport, renderMarkdown } from './markdown';
import type { GameRecord, ReportData, ReportMeta } from './types';
import { renderSparklineSvg } from './sparkline';
import { renderLineChartSvg } from './linechart';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { groupPlayerNames, nameKey } from './playerMatch';
import { buildAnnotatedPgn, downloadPgn } from './pgnExport';
import { Board } from './board';
import { derivePuzzles } from './puzzles';
import type { Puzzle } from './puzzles';
import { newCard, isDue, review } from './srs';
import type { SrsCard } from './srs';
import { generateTrainingPlan, tasksByDay } from './trainingPlan';
import type { PlanDetail, PlanDuration, PlanTask, TrainingPlan } from './trainingPlan';

registerServiceWorker();
initTheme();

// ---------- state ----------
let parsedGames: ParsedGame[] = [];
let baseReport: ReportData | null = null;
let records: GameRecord[] = [];
let currentMarkdown = '';
let currentAgg: Aggregates | null = null;
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
const configCard = $('#config-card');
const detectedPlayerName = $('#detected-player-name');
const detectedPlayerCount = $('#detected-player-count');
const depthSelect = $('#depth-select') as HTMLSelectElement;
const analyzeBtn = $('#analyze-btn') as HTMLButtonElement;
const progressWrap = $('#progress-wrap');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const resultsEl = $('#results');
const exportCard = $('#export-card');
const puzzleCard = $('#puzzle-card');
const puzzleDueCount = $('#puzzle-due-count');
const puzzleStartBtn = $('#puzzle-start-btn') as HTMLButtonElement;
const puzzleIntro = $('#puzzle-intro');
const puzzleSession = $('#puzzle-session');
const puzzleFeedback = $('#puzzle-feedback');
const puzzleContext = $('#puzzle-context');
const puzzleProgress = $('#puzzle-progress');
const puzzleNextBtn = $('#puzzle-next-btn') as HTMLButtonElement;
const puzzleStopBtn = $('#puzzle-stop-btn') as HTMLButtonElement;
const puzzleSummary = $('#puzzle-summary');
const puzzleBoard = new Board($('#puzzle-board'));
const trainplanCard = $('#trainplan-card');
const trainplanSetup = $('#trainplan-setup');
const trainplanActive = $('#trainplan-active');
const trainplanDurationSelect = $('#trainplan-duration') as HTMLSelectElement;
const trainplanDetailSelect = $('#trainplan-detail') as HTMLSelectElement;
const trainplanGenerateBtn = $('#trainplan-generate-btn') as HTMLButtonElement;
const trainplanProgress = $('#trainplan-progress');
const trainplanXlsxBtn = $('#trainplan-xlsx-btn') as HTMLButtonElement;
const trainplanRegenerateBtn = $('#trainplan-regenerate-btn') as HTMLButtonElement;
const trainplanCompareNote = $('#trainplan-compare-note');
const trainplanDaysEl = $('#trainplan-days');

function isPlayerNameMatch(name: string | undefined, matchKeys: Set<string>): boolean {
  return !!name && name !== '?' && matchKeys.has(nameKey(name));
}
function hasAnyPlayerName(g: ParsedGame, matchKeys: Set<string>): boolean {
  return isPlayerNameMatch(g.headers['White'], matchKeys) || isPlayerNameMatch(g.headers['Black'], matchKeys);
}
function hasAnyNameAtAll(g: ParsedGame): boolean {
  return (!!g.headers['White'] && g.headers['White'] !== '?') || (!!g.headers['Black'] && g.headers['Black'] !== '?');
}
// A game with exactly one side named (the other blank/"?") is genuinely ambiguous — the unnamed
// side could be the analyzed player (their name just wasn't recorded), or the game could belong to
// two other people entirely. Rather than guess, gamesForPlayer() excludes it like any other
// non-match; this only flags which games fell into that specific ambiguous case, so the exclusion
// is visible instead of the game silently vanishing with no trace at all.
function isAmbiguousOneSidedExclusion(g: ParsedGame, matchKeys: Set<string>): boolean {
  const white = g.headers['White'];
  const black = g.headers['Black'];
  const whiteNamed = !!white && white !== '?';
  const blackNamed = !!black && black !== '?';
  if (whiteNamed === blackNamed) return false; // both named, or neither — not this case
  return !isPlayerNameMatch(whiteNamed ? white : black, matchKeys);
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
async function handleFiles(files: FileList | File[]) {
  let newGames = 0;
  let mdLoaded = 0;
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
    if (file.name.endsWith('.md') || text.includes('chess-insight:data:v1')) {
      const data = parseMarkdownReport(text);
      if (data) {
        baseReport = baseReport
          ? {
              version: 1,
              meta: {
                ...baseReport.meta,
                sessions: [...baseReport.meta.sessions, ...data.meta.sessions],
              },
              games: mergeGames(baseReport.games, data.games),
            }
          : data;
        mdLoaded++;
      } else failed++;
      continue;
    }
    const chunks = splitPgn(text);
    for (const chunk of chunks) {
      const { game, error } = tryParseGame(chunk);
      if (game) {
        if (isBotOrComputerGame(game.headers)) {
          botExcluded++;
          continue;
        }
        parsedGames.push(game);
        newGames++;
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

  // Detect the player before building the summary chips so an ambiguous-exclusion count (below)
  // can be shown alongside the others, instead of those games silently vanishing with no trace.
  const detected = (parsedGames.length || baseReport) ? detectMainPlayer() : null;
  detectedUsername = detected?.name ?? null;
  detectedMatchKeys = detected?.matchKeys ?? null;
  const ambiguousExcluded = detectedMatchKeys
    ? parsedGames.filter((g) => isAmbiguousOneSidedExclusion(g, detectedMatchKeys!)).length
    : 0;

  const chips: string[] = [];
  if (parsedGames.length) chips.push(`<span class="chip">♟ ${parsedGames.length} game(s) loaded from PGN</span>`);
  if (baseReport) chips.push(`<span class="chip">📄 previous report: ${baseReport.games.length} analyzed game(s) for <b>${esc(baseReport.meta.username)}</b></span>`);
  if (failed) chips.push(`<span class="chip">⚠ ${failed} item(s) could not be parsed</span>`);
  if (botExcluded) chips.push(`<span class="chip">🤖 ${botExcluded} game(s) vs a bot/computer excluded</span>`);
  if (mdLoaded && !parsedGames.length) chips.push(`<span class="chip">Tip: add new PGN files to extend this report</span>`);
  if (ambiguousExcluded) chips.push(`<span class="chip">⚠ ${ambiguousExcluded} game(s) with only one player named — not matching <b>${esc(detectedUsername!)}</b> — were excluded</span>`);
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

  if (parsedGames.length || baseReport) {
    detectedPlayerName.textContent = detectedUsername ?? '—';
    const total = detectedMatchKeys ? gamesForPlayer(detectedMatchKeys).length : 0;
    detectedPlayerCount.textContent = detectedMatchKeys ? ` — ${total} game${total === 1 ? '' : 's'} will be analyzed` : '';
    configCard.hidden = false;
    configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Auto-detects who the report is for: the player appearing in the most games, weighted toward a
// loaded report's existing owner so re-uploads stay attributed to the same player. Name variants
// that likely refer to the same person (different casing, "Last, First" vs "First Last", or a
// nickname/first-name-only form) are folded together by groupPlayerNames() so a tournament roster
// with inconsistent naming doesn't silently drop that player's games from the report.
function detectMainPlayer(): { name: string; count: number; matchKeys: Set<string> } | null {
  const counts = new Map<string, number>();
  for (const g of parsedGames) {
    for (const key of ['White', 'Black'] as const) {
      const name = g.headers[key];
      if (!name || name === '?') continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!counts.size && !baseReport) return null;
  if (baseReport && !counts.has(baseReport.meta.username)) counts.set(baseReport.meta.username, 0);

  const groups = groupPlayerNames(counts);
  const baseKey = baseReport ? nameKey(baseReport.meta.username) : null;
  const weight = (g: (typeof groups)[number]) => g.count + (baseKey && g.keys.has(baseKey) ? 10000 : 0);
  groups.sort((a, b) => weight(b) - weight(a));
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

// ---------- lichess / chess.com account fetch (cross-platform merge) ----------
lichessFetchBtn.addEventListener('click', () => void fetchFromLichess());
lichessUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromLichess();
});

// `max` and `sinceMs` are independent lichess API params — the game-count dropdown passes `max`
// only, the combined-report date picker passes `sinceMs` only (omitting `max` streams every game
// since that date, per lichess's own API default). `max === 'all'` also omits the param entirely
// — lichess streams the account's full history (unbounded) when it's left off, rather than there
// being an explicit "unlimited" sentinel value on lichess's own end.
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
// count-limited one either — games are grouped into monthly archives. To offer a "max games" control
// that matches lichess's, this walks archives newest-month-first, fetching one month at a time (has
// to be sequential, not parallel, since it needs to know the running total before deciding whether
// another month is needed) and stops as soon as it has enough, then trims to exactly that count — a
// month's own games arrive oldest-first, so the trim keeps its most recent games too.
interface ChessComArchivesResponse { archives: string[]; }
interface ChessComGamesResponse { games: { pgn?: string; url?: string; end_time?: number }[]; }

// Chess.com's own [Site] header is never a URL ("Chess.com", not a link), so the game's separate
// `url` field is injected as a [Link] header so gameLink() can still resolve a "View" link
// downstream. Inserted right after [Event] rather than before it — splitPgn() treats any `\n`
// immediately followed by `[Event` as a new-game boundary (that's how it finds game boundaries in a
// multi-game file at all), so putting Link *before* Event created a spurious boundary there: the
// Link line got split off into its own one-line "game" (which then failed to parse, surfacing as a
// bogus parse error) and the real game lost its Link header entirely.
function injectLinkHeader(pgn: string, url: string | undefined): string {
  if (!url || /\[Link /.test(pgn)) return pgn;
  return pgn.replace(/^(\[Event\s[^\n]*\n)/, `$1[Link "${url}"]\n`);
}

chesscomFetchBtn.addEventListener('click', () => void fetchFromChessCom());
chesscomUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromChessCom();
});

// `maxGames` and `sinceMs` are independent limits — the game-count dropdown passes `maxGames` only
// (walk newest-month-first, stop once there are enough); the combined-report date picker passes
// `sinceMs` only (walk newest-month-first, stop once a whole archive month falls before the date,
// filtering individual games by their own `end_time` for day-level precision within the boundary
// month, since an archive covers a full calendar month regardless of the chosen day).
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
      // an archive covers the whole month; once that month's own end is before the cutoff, every
      // earlier archive (we're walking newest-first) is too — safe to stop entirely.
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

// ---------- combined lichess + chess.com fetch, one action ----------
// Both fetches already merge into the same report on their own — parsedGames/fetchedUsernames
// accumulate across calls rather than resetting, and detectMainPlayer() folds every explicitly
// fetched username into the same identity (see the fetchedUsernames comment above). This toggle
// exists purely as a one-click convenience over fetching each account separately, not because the
// separate path is broken.
const combineToggle = $('#combine-toggle') as HTMLInputElement;
const combineRow = $('#combine-row');
const combineBtn = $('#combine-btn') as HTMLButtonElement;
const combineStatusEl = $('#combine-status');
const combineSinceInput = $('#combine-since') as HTMLInputElement;

function updateCombineUi() {
  const on = combineToggle.checked;
  lichessFetchBtn.hidden = on;
  chesscomFetchBtn.hidden = on;
  // The combined path fetches by date instead of game count — a "since" date applies naturally to
  // both platforms at once, where "N games" doesn't (200 games means very different date ranges for
  // a bullet grinder vs. a daily-game player). The individual fetch rows keep their count dropdowns.
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
  // Parsed as local midnight rather than UTC (bare "YYYY-MM-DD" is UTC per spec) so "since Aug 1"
  // means Aug 1 in the browser's own timezone, matching what the date picker visually shows.
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
    // One handleFiles call for both files — a single combined status message and a single
    // config-card re-render/scroll, instead of the double-render two sequential fetches give.
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
    // Reachable whenever detectMainPlayer() can't identify a player (e.g. PGNs with no White/Black
    // headers) — the config card still shows in that case (it's gated on having games loaded, not on
    // a successful detection), so without this the button did nothing with zero feedback.
    progressWrap.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = "Couldn't detect a player in the loaded games — check that your PGN files include White/Black player names.";
    return;
  }
  const depth = parseInt(depthSelect.value, 10);
  const useEngine = depth > 0;

  analyzeBtn.disabled = true;
  progressWrap.hidden = false;

  const baseReportIsSamePlayer = !!baseReport && matchKeys.has(nameKey(baseReport.meta.username));

  // Skip games already analyzed in the loaded report (same id, same player).
  const knownIds = new Set((baseReportIsSamePlayer ? baseReport!.games : []).map((g) => g.id));
  const toAnalyze = gamesForPlayer(matchKeys).filter((g) => !knownIds.has(gameId(g)));

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

    const oldGames = baseReportIsSamePlayer ? baseReport!.games : [];
    records = mergeGames(oldGames, newRecords);

    const now = new Date().toISOString();
    const meta: ReportMeta = {
      username,
      // Gated the same way oldGames/knownIds are above — otherwise loading a report.md for a
      // different player alongside new PGNs (wrong file, shared machine, etc.) correctly keeps
      // their games out of this report but still leaks that other player's creation date and
      // session history into it.
      createdAt: baseReportIsSamePlayer ? baseReport!.meta.createdAt : now,
      updatedAt: now,
      sessions: [
        ...(baseReportIsSamePlayer ? baseReport!.meta.sessions : []),
        ...(newRecords.length
          ? [{ date: now.slice(0, 10), gamesAdded: newRecords.length, source: 'PGN upload' }]
          : []),
      ],
    };
    // Fold this run's results back into baseReport so a second "Analyze" click later in the same
    // session (e.g. after dropping in a few more PGNs) only re-analyzes the new games — without
    // this, knownIds below stays built from whatever was true before this run, and every click
    // would silently re-run the engine on every already-analyzed game again.
    baseReport = { version: 1, meta, games: records };

    currentAgg = aggregate(records);
    currentMarkdown = renderMarkdown(currentAgg, records, meta);
    renderResults(currentAgg, username, newRecords.length, oldGames.length);
    exportCard.hidden = false;
    updatePuzzleCard();
    updateTrainPlanCard();
    progressFill.style.width = '100%';
    progressText.textContent = `Done — ${newRecords.length} new game(s) analyzed, ${records.length} total in report.`;
  } catch (err) {
    progressText.textContent = `Analysis error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  } finally {
    engine?.destroy();
    analyzeBtn.disabled = false;
  }
}

// ---------- puzzle trainer (blunders/missed wins/missed mates → SRS drill) ----------
const PUZZLE_SESSION_CAP = 20;
let puzzles: Puzzle[] = [];
let puzzleSrsData: Record<string, SrsCard> = {};
let puzzleQueue: Puzzle[] = [];
let puzzleCurrent: Puzzle | null = null;
let puzzleStats = { correct: 0, incorrect: 0 };
let puzzleAwaitingNext = false;

function puzzleSrsStorageKey(): string | null {
  if (!detectedUsername) return null;
  return `openfile-puzzle-srs:${detectedUsername.trim().toLowerCase()}`;
}

function loadPuzzleSrsData(): Record<string, SrsCard> {
  const key = puzzleSrsStorageKey();
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePuzzleSrsData(data: Record<string, SrsCard>) {
  const key = puzzleSrsStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage unavailable/full — drilling still works for this session, just won't persist
  }
}

function updatePuzzleCard() {
  puzzles = derivePuzzles(records);
  if (!puzzles.length) {
    puzzleCard.hidden = true;
    return;
  }
  puzzleCard.hidden = false;
  puzzleSrsData = loadPuzzleSrsData();
  const now = new Date();
  const dueCount = puzzles.filter((p) => {
    const card = puzzleSrsData[p.id];
    return !card || isDue(card, now);
  }).length;
  puzzleDueCount.textContent = `${dueCount} of ${puzzles.length} puzzle(s) due for review.`;
  puzzleIntro.hidden = false;
  puzzleSession.hidden = true;
  puzzleSummary.hidden = true;
}

const PUZZLE_KIND_LABEL: Record<Puzzle['kind'], string> = {
  blunder: 'Blunder',
  mistake: 'Mistake',
  'missed win': 'Missed win',
  'missed mate': 'Missed mate',
};

puzzleStartBtn.addEventListener('click', () => {
  const now = new Date();
  puzzleSrsData = loadPuzzleSrsData();
  const withDue = puzzles.map((p) => ({ p, card: puzzleSrsData[p.id] }));
  puzzleQueue = withDue.filter((x) => !x.card || isDue(x.card, now)).slice(0, PUZZLE_SESSION_CAP).map((x) => x.p);
  if (!puzzleQueue.length) {
    // nothing due — drill anyway so "Start drilling" never does nothing
    puzzleQueue = withDue.slice(0, PUZZLE_SESSION_CAP).map((x) => x.p);
  }
  puzzleStats = { correct: 0, incorrect: 0 };
  puzzleIntro.hidden = true;
  puzzleSummary.hidden = true;
  puzzleSession.hidden = false;
  nextPuzzle();
});

function nextPuzzle() {
  puzzleFeedback.className = 'drill-feedback';
  puzzleFeedback.innerHTML = '';
  puzzleNextBtn.hidden = true;
  puzzleAwaitingNext = false;
  puzzleBoard.setSelected(null);
  puzzleBoard.setArrow(null);
  puzzleBoard.setLastMove(null);

  const next = puzzleQueue.shift();
  if (!next) {
    puzzleSession.hidden = true;
    puzzleSummary.hidden = false;
    const total = puzzleStats.correct + puzzleStats.incorrect;
    puzzleSummary.innerHTML = `
      <div class="drill-summary-stats">
        <div class="stat-card"><span class="big pos">${puzzleStats.correct}</span><span class="label">Correct</span></div>
        <div class="stat-card"><span class="big neg">${puzzleStats.incorrect}</span><span class="label">Missed</span></div>
      </div>
      <p class="hint">${total} puzzle(s) drilled this session.</p>
      <button id="puzzle-restart-btn" class="btn btn-primary">▶ Drill again</button>
    `;
    $('#puzzle-restart-btn').addEventListener('click', () => { updatePuzzleCard(); puzzleStartBtn.click(); });
    return;
  }
  puzzleCurrent = next;
  puzzleBoard.setOrientation(next.color);
  puzzleBoard.setFen(next.fen);
  const dateStr = next.date ? new Date(next.date).toLocaleDateString() : '';
  puzzleContext.textContent = `${PUZZLE_KIND_LABEL[next.kind]} vs ${next.opponent}${dateStr ? ` · ${dateStr}` : ''} · move ${next.moveNo} — find the move you missed.`;
  puzzleProgress.textContent = `${puzzleQueue.length + 1} puzzle(s) left this session · ${puzzleStats.correct} correct, ${puzzleStats.incorrect} missed so far`;
}

function answerPuzzle(playedSan: string) {
  if (!puzzleCurrent || puzzleAwaitingNext) return;
  puzzleAwaitingNext = true;
  const correct = playedSan === puzzleCurrent.best;
  const prior = puzzleSrsData[puzzleCurrent.id] ?? newCard();
  puzzleSrsData[puzzleCurrent.id] = review(prior, correct);
  savePuzzleSrsData(puzzleSrsData);

  if (correct) {
    puzzleStats.correct++;
    puzzleFeedback.className = 'drill-feedback correct';
    puzzleFeedback.innerHTML = `<b>✓ Correct</b> — ${esc(puzzleCurrent.best)} was the move. You played ${esc(puzzleCurrent.played)} in the actual game.`;
  } else {
    puzzleStats.incorrect++;
    puzzleFeedback.className = 'drill-feedback incorrect';
    puzzleFeedback.innerHTML = `<b>✗ Not quite</b> — you played ${esc(playedSan)}. The engine's move was <b>${esc(puzzleCurrent.best)}</b> (in the actual game you played ${esc(puzzleCurrent.played)}).`;
    if (puzzleCurrent) puzzleQueue.push(puzzleCurrent);
  }
  puzzleNextBtn.hidden = false;
}

puzzleBoard.onSquareClick = (sq) => {
  if (!puzzleCurrent || puzzleAwaitingNext) return;
  const c = new Chess(puzzleCurrent.fen);
  const piece = c.get(sq as any);
  const sel = puzzleBoard.getSelected();
  if (sel && sel !== sq) {
    const moves = c.moves({ square: sel as any, verbose: true }) as any[];
    const m = moves.find((x) => x.to === sq);
    if (m) {
      puzzleBoard.setSelected(null);
      puzzleBoard.setLastMove([m.from, m.to]);
      answerPuzzle(m.san);
      return;
    }
    if (!(piece && piece.color === c.turn())) puzzleBoard.flashIllegal(sq);
  }
  if (piece && piece.color === c.turn()) puzzleBoard.setSelected(sq);
  else puzzleBoard.setSelected(null);
};

puzzleNextBtn.addEventListener('click', nextPuzzle);
puzzleStopBtn.addEventListener('click', () => {
  puzzleQueue = [];
  puzzleCurrent = null;
  updatePuzzleCard();
});

// ---------- training plan (turns the recommendations above into a day-by-day checklist) ----------
interface StoredTrainingPlan {
  plan: TrainingPlan;
  done: Record<string, boolean>;
  startDateISO: string; // date generated — day 1 of the plan
}

function trainPlanStorageKey(): string | null {
  if (!detectedUsername) return null;
  return `openfile-trainplan:${detectedUsername.trim().toLowerCase()}`;
}

function loadTrainPlan(): StoredTrainingPlan | null {
  const key = trainPlanStorageKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTrainPlan(data: StoredTrainingPlan | null) {
  const key = trainPlanStorageKey();
  if (!key) return;
  try {
    if (data) localStorage.setItem(key, JSON.stringify(data));
    else localStorage.removeItem(key);
  } catch {
    // localStorage unavailable/full — plan still works this session, just won't persist
  }
}

function planDayDate(startISO: string, day: number): Date {
  const d = new Date(startISO);
  d.setDate(d.getDate() + (day - 1));
  return d;
}
function fmtPlanDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const SEVERITY_LABEL: Record<PlanTask['severity'], string> = {
  high: 'high priority', medium: 'medium priority', low: 'low priority',
};

function updateTrainPlanCard() {
  if (!currentAgg) { trainplanCard.hidden = true; return; }
  trainplanCard.hidden = false;

  const stored = loadTrainPlan();
  if (!stored) {
    trainplanSetup.hidden = false;
    trainplanActive.hidden = true;
    const hasRecs = currentAgg.recommendations.length > 0;
    trainplanGenerateBtn.disabled = !hasRecs;
    trainplanGenerateBtn.title = hasRecs ? '' : 'Run engine analysis to unlock personalized recommendations first.';
    return;
  }
  trainplanSetup.hidden = true;
  trainplanActive.hidden = false;
  renderTrainPlanActive(stored);
}

function renderTrainPlanActive(stored: StoredTrainingPlan, preserveOpenDays?: Set<number>) {
  const { plan, done, startDateISO } = stored;
  const totalTasks = plan.tasks.length;
  const doneCount = plan.tasks.filter((t) => done[t.id]).length;
  const endDate = planDayDate(startDateISO, plan.duration);
  const today = new Date();
  const daysElapsed = Math.floor((today.getTime() - new Date(startDateISO).getTime()) / 86400000) + 1;
  const currentDay = Math.max(1, Math.min(plan.duration, daysElapsed));
  const isPastEnd = today.getTime() > endDate.getTime();
  const openDays = preserveOpenDays ?? new Set([currentDay]);

  trainplanProgress.textContent = `${doneCount} / ${totalTasks} tasks done · Day ${currentDay} of ${plan.duration} · ends ${fmtPlanDate(endDate)}`;

  trainplanCompareNote.className = `rec-card sev-${isPastEnd ? 'high' : 'medium'}`;
  trainplanCompareNote.innerHTML = isPastEnd
    ? `<h4>Plan complete — see how you did</h4><p class="section-note">This plan ended ${fmtPlanDate(endDate)}. Analyze your new games (load PGNs above and re-run analysis), then use <a href="compare-reports.html">Compare Reports</a> against the report.md you saved when you started this plan to see exactly what improved.</p>`
    : `<h4>Tracking progress</h4><p class="section-note">Make sure you've downloaded a report.md (below) as your "before" snapshot. When this plan ends on ${fmtPlanDate(endDate)}, analyze new games and use <a href="compare-reports.html">Compare Reports</a> to see your improvement.</p>`;

  trainplanDaysEl.innerHTML = tasksByDay(plan)
    .map(({ day, tasks }) => {
      const date = planDayDate(startDateISO, day);
      const dayDone = tasks.every((t) => done[t.id]);
      const rows = tasks
        .map((t) => {
          const checked = !!done[t.id];
          const links = t.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ');
          return `<li class="trainplan-task${checked ? ' done' : ''}">
            <label>
              <input type="checkbox" class="trainplan-check" data-task="${esc(t.id)}"${checked ? ' checked' : ''} />
              <span class="trainplan-task-title">${esc(t.title)} <span class="hint">(${SEVERITY_LABEL[t.severity]})</span></span>
            </label>
            ${t.detail ? `<p class="section-note">${esc(t.detail)}</p>` : ''}
            ${links ? `<div class="theme-links">${links}</div>` : ''}
          </li>`;
        })
        .join('');
      return `<details class="trainplan-day" data-day="${day}"${openDays.has(day) ? ' open' : ''}>
        <summary>Day ${day} — ${fmtPlanDate(date)} ${dayDone ? '<span class="pos">✓ done</span>' : ''}</summary>
        <ul class="trainplan-task-list">${rows}</ul>
      </details>`;
    })
    .join('');
}

trainplanGenerateBtn.addEventListener('click', () => {
  if (!currentAgg || !currentAgg.recommendations.length) return;
  const duration = parseInt(trainplanDurationSelect.value, 10) as PlanDuration;
  const detail = trainplanDetailSelect.value as PlanDetail;
  const plan = generateTrainingPlan(currentAgg.recommendations, duration, detail);
  const stored: StoredTrainingPlan = { plan, done: {}, startDateISO: new Date().toISOString() };
  saveTrainPlan(stored);
  updateTrainPlanCard();
});

trainplanRegenerateBtn.addEventListener('click', () => {
  if (!confirm('Start a new plan? This discards checked-off progress on the current one.')) return;
  saveTrainPlan(null);
  updateTrainPlanCard();
});

trainplanDaysEl.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.classList.contains('trainplan-check')) return;
  const stored = loadTrainPlan();
  if (!stored) return;
  const taskId = target.dataset.task!;
  stored.done[taskId] = target.checked;
  saveTrainPlan(stored);
  const openDays = new Set(
    [...trainplanDaysEl.querySelectorAll('details[open]')].map((d) => parseInt((d as HTMLElement).dataset.day!, 10))
  );
  renderTrainPlanActive(stored, openDays);
});

trainplanXlsxBtn.addEventListener('click', async () => {
  const stored = loadTrainPlan();
  if (!stored) return;
  // The xlsx library is ~350KB — split into its own chunk and only fetched the moment someone
  // actually clicks this, instead of bloating every Performance Analysis page load with it.
  trainplanXlsxBtn.disabled = true;
  const originalLabel = trainplanXlsxBtn.textContent;
  trainplanXlsxBtn.textContent = 'Preparing file…';
  try {
    const { downloadTrainingPlanXlsx } = await import('./trainingPlanXlsx');
    downloadTrainingPlanXlsx(stored.plan, stored.done, stored.startDateISO, detectedUsername ?? 'player');
  } finally {
    trainplanXlsxBtn.disabled = false;
    trainplanXlsxBtn.textContent = originalLabel;
  }
});

// ---------- rendering ----------
function pct(v: number | null, cls = true): string {
  if (v === null) return '—';
  const c = v >= 60 ? 'pos' : v >= 40 ? 'mid' : 'neg';
  return cls ? `<span class="${c}">${v}%</span>` : `${v}%`;
}

function wdlRow(label: string, w: WDL, extra = ''): string {
  return `<tr><td>${label}</td><td class="num">${w.games}</td><td class="num pos">${w.wins}</td><td class="num mid">${w.draws}</td><td class="num neg">${w.losses}</td><td class="num">${pct(scorePct(w))}</td>${extra}</tr>`;
}

function openingTableHtml(rows: OpeningRow[], emptyMsg: string): string {
  if (!rows.length) return `<p class="section-note">${emptyMsg}</p>`;
  return `<table><thead><tr><th>Opening</th><th>ECO</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">White/Black</th><th class="num">Accuracy</th></tr></thead><tbody>${rows
    .map(
      (o) =>
        `<tr><td>${esc(o.family)}</td><td>${esc(o.eco || '—')}</td><td class="num">${o.games}</td><td class="num pos">${o.wins}</td><td class="num mid">${o.draws}</td><td class="num neg">${o.losses}</td><td class="num">${pct(scorePct(o))}</td><td class="num">${o.asWhite}/${o.asBlack}</td><td class="num">${o.avgAccuracy !== null ? o.avgAccuracy + '%' : '—'}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

function h2hBodyHtml(h2h: HeadToHeadOpponent): string {
  if (!h2h.games.length) return '<p class="section-note">No games found against this opponent.</p>';
  const openingsByFamily = new Map(h2h.openings.map((o) => [o.family, o]));
  return `
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${h2h.wdl.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${h2h.wdl.wins}-${h2h.wdl.draws}-${h2h.wdl.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pct(scorePct(h2h.wdl))}</span><span class="label">Score</span></div>
    </div>
    <h3>Openings vs ${esc(h2h.opponent)}</h3>
    ${openingTableHtml(h2h.openings, 'No repeated openings against this opponent yet.')}
    <h3>Games</h3>
    ${gamesTableHtml(h2h.games, openingsByFamily)}
  `;
}

/** Renders one game's strength/weakness/overall assessment (see gameAssessment.ts) as the hidden
 *  detail row toggled by a game table row's 🩺 button. */
function assessmentHtml(g: GameRecord, openingsByFamily?: Map<string, OpeningRow>): string {
  const a = assessGame(g, openingsByFamily?.get(g.family));
  if (!a) return '<p class="section-note">No move-quality data for this game.</p>';
  const verdictCls = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? 'pos' : v === 'weakness' ? 'neg' : 'mid');
  const verdictIcon = (v: 'strength' | 'weakness' | 'neutral') => (v === 'strength' ? '✓' : v === 'weakness' ? '✗' : '·');
  const phaseRows = a.phases
    .map(
      (p) =>
        `<li><span class="${verdictCls(p.verdict)}">${verdictIcon(p.verdict)} ${p.phase[0].toUpperCase() + p.phase.slice(1)}</span> — ${mdBold(esc(p.summary))}</li>`
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

function gamesTableHtml(games: GameRecord[], openingsByFamily?: Map<string, OpeningRow>): string {
  if (!games.length) return '<p class="section-note">No games.</p>';
  const rows = [...games]
    .sort((x, y) => y.date.localeCompare(x.date))
    .map((g) => {
      const resultCls = g.result === 'win' ? 'pos' : g.result === 'loss' ? 'neg' : g.result === 'draw' ? 'mid' : '';
      const resultLabel =
        g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Unfinished';
      const opponent = g.userColor === 'w' ? g.black : g.white;
      const colorGlyph = g.userColor === 'w' ? '♔' : '♚';
      const evalGraph = g.evalGraph ?? null;
      const spark = evalGraph && evalGraph.length > 1
        ? renderSparklineSvg(evalGraph, { width: 140, height: 28 })
        : `<span class="hint">no engine data</span>`;
      // Game Analysis can only load lichess games (chess.com has no public unauthenticated live-game API).
      const liveLink = /^https?:\/\/(www\.)?lichess\.org\//.test(g.site)
        ? `<a href="live.html?game=${encodeURIComponent(g.site)}" target="_blank" rel="noopener" title="Open in Game Analysis">▶</a>`
        : '';
      const pgnBtn = g.sans?.length
        ? `<button class="btn-icon pgn-dl-btn" data-id="${esc(g.id)}" title="Download annotated PGN (engine evals + notes on flagged moves)">⬇</button>`
        : '';
      const assessBtn = g.analyzed
        ? `<button class="btn-icon assess-btn" data-id="${esc(g.id)}" title="Strengths &amp; weaknesses">🩺</button>`
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
        <td class="num">${liveLink} ${pgnBtn} ${assessBtn}</td>
      </tr>${assessRow}`;
    })
    .join('');
  return `<div class="games-table-wrap"><table><thead><tr>
      <th>Date</th><th>Opponent</th><th>Result</th><th>Opening</th><th class="num">Accuracy</th><th>Eval graph</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderGamesSection(games: GameRecord[], openings: OpeningRow[]): string {
  if (!games.length) return '';
  const openingsByFamily = new Map(openings.map((o) => [o.family, o]));
  return `<div class="card span-2"><h2>📈 Games</h2>
    ${gamesTableHtml(games, openingsByFamily)}
    <p class="hint">The eval graph tracks the position's evaluation (white's perspective) across the whole game. Click ▶ to open a game in Game Analysis and step through it move by move. Click ⬇ to download that game as a standard PGN with engine evals and flagged-move notes baked in as comments. Click 🩺 for a strengths/weaknesses breakdown of that game's opening, middlegame, and endgame.</p>
  </div>`;
}

function renderResults(a: Aggregates, username: string, newCount: number, oldCount: number) {
  const p = a.patterns;
  const html: string[] = [];

  const unfinishedCount = records.length - a.total.games;
  html.push(`<div class="card">
    <h2>Results for <b>${esc(username)}</b></h2>
    <p class="section-note">${newCount} newly analyzed game(s)${oldCount ? ` merged with ${oldCount} from the loaded report` : ''} · ${a.analyzedCount} of ${records.length} games have move-quality data${unfinishedCount ? ` · ${unfinishedCount} unfinished/undecided game(s) excluded from W-D-L and score` : ''}</p>
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${a.total.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${a.total.wins}-${a.total.draws}-${a.total.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pct(scorePct(a.total))}</span><span class="label">Score</span></div>
      <div class="stat-card"><span class="big">${a.overallAccuracy !== null ? a.overallAccuracy + '%' : '—'}</span><span class="label">Accuracy</span></div>
      <div class="stat-card"><span class="big">${a.tactics.blundersTotal}</span><span class="label">Blunders</span></div>
    </div>
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>
      ${wdlRow('As White', a.byColor.white)}
      ${wdlRow('As Black', a.byColor.black)}
    </tbody></table>
  </div>`);

  html.push(renderGamesSection(records, a.openings));

  const opponents = opponentList(records);
  if (opponents.length > 0) {
    const topOpponent = opponents[0].opponent;
    html.push(`<div class="card span-2"><h2>🤝 Head-to-head</h2>
      <label class="stack">Opponent
        <select id="opponent-select">
          ${opponents.map((o) => `<option value="${esc(o.opponent)}">${esc(o.opponent)} (${o.games} game${o.games === 1 ? '' : 's'})</option>`).join('')}
        </select>
      </label>
      <div id="h2h-body">${h2hBodyHtml(headToHeadWithOpponent(records, topOpponent))}</div>
    </div>`);
  }

  const rc = a.repertoireCoverage;
  html.push(`<div class="card span-2"><h2>♟ Opening performance</h2>
    ${
      rc.coveragePct !== null
        ? `<div class="summary-cards">
      <div class="stat-card"><span class="big">${rc.coveragePct}%</span><span class="label">Repertoire coverage</span></div>
      <div class="stat-card"><span class="big">${rc.preparedGames}</span><span class="label">Games in a known line (2+ played)</span></div>
      <div class="stat-card"><span class="big mid">${rc.improvisedGames}</span><span class="label">Games in a one-off line</span></div>
    </div>
    <p class="section-note">${rc.coveragePct}% of your games followed an opening you've played at least twice — a rough read on how much of your results come from actual prep vs. improvising over the board.</p>`
        : ''
    }
    <h3>Strongest openings</h3>${openingTableHtml(a.strongest, 'Need at least 2 games in an opening (with ≥50% score) to rank it.')}
    <h3>Weakest openings</h3>${openingTableHtml(a.weakest, 'No openings scoring below 50% with 2+ games — nice.')}
    <h3>All openings</h3>${openingTableHtml(a.openings, 'No games loaded.')}
  </div>`);

  html.push(`<div class="card"><h2>⏱ Results by time control</h2>
    <table><thead><tr><th>Time control</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>
    ${a.byTimeClass.map((tc) => wdlRow(esc(tc.timeClass), tc.wdl, `<td class="num">${tc.avgAccuracy !== null ? tc.avgAccuracy + '%' : '—'}</td>`)).join('')}
    </tbody></table>
  </div>`);

  if (a.openingsByTimeClass.length > 1) {
    html.push(`<div class="card span-2"><h2>♟⏱ Openings by time control</h2>
      <p class="section-note">The same opening can score very differently depending on speed — a repertoire built for Rapid may fall apart in Bullet. Each table below only reflects games played at that time control.</p>
      ${a.openingsByTimeClass
        .map((tc) => `<h3>${esc(tc.timeClass)}</h3>${openingTableHtml(tc.openings, 'No games at this time control.')}`)
        .join('')}
    </div>`);
  }

  const egRows = Object.entries(p.endgameTypeCounts).sort((x, y) => y[1].games - x[1].games);
  html.push(`<div class="card span-2"><h2>📊 Game-phase breakdown</h2>
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
    <p class="section-note">Where inaccuracies, mistakes and blunders actually land across the whole game, move by move — more granular than the opening/middlegame/endgame split above, since two games can reach the endgame at very different move numbers.</p>
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

  html.push(`<div class="card span-2"><h2>⚔ Tactics: strengths &amp; misses</h2>
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

  const mistakesTotal = a.phases.reduce((s, ph) => s + ph.mistakes, 0);
  const errorDenom = a.tactics.blundersTotal + mistakesTotal;
  const timePct = errorDenom > 0 ? Math.round((p.timePressureBlunders / errorDenom) * 100) : null;
  html.push(`<div class="card span-2"><h2>⏱ Time trouble</h2>
    ${
      p.clockGames > 0
        ? `<div class="summary-cards">
      <div class="stat-card"><span class="big">${p.clockGames}</span><span class="label">Games with clock data</span></div>
      <div class="stat-card"><span class="big neg">${p.timePressureBlunders}</span><span class="label">Errors under 30s left</span></div>
      <div class="stat-card"><span class="big">${timePct !== null ? timePct + '%' : '—'}</span><span class="label">Of all your errors</span></div>
    </div>
    <p class="section-note">${p.timePressureBlunders} blunder(s)/mistake(s) were played with under 30 seconds on the clock, across ${p.clockGames} game(s) with clock data${timePct !== null ? ` — ${timePct}% of all your inaccuracy-or-worse moves happened in time trouble` : ''}. ${p.timePressureBlunders >= 2 ? 'Worth training: banking more time earlier in the game, or practicing at a longer time control.' : 'Not a major factor yet in this sample.'}</p>`
        : `<p class="section-note">No clock data found in these games — they don't include <code>[%clk]</code> tags (common for correspondence/daily games or manually-typed PGNs).</p>`
    }
    ${
      a.timeUsage.length > 1
        ? `<h3>Time usage by move number</h3>
    <p class="section-note">Average seconds left on the clock after each move, across every game with clock data — shows whether time trouble tends to build up at a particular stage rather than being spread evenly.</p>
    ${renderLineChartSvg(
      [{ label: 'Avg. seconds remaining', values: a.timeUsage.map((t) => t.avgSec), color: 'var(--accent)' }],
      { xLabels: a.timeUsage.map((t) => String(t.moveNo)), ySuffix: 's' }
    )}`
        : ''
    }
  </div>`);

  html.push(`<div class="card"><h2>🔍 Patterns detected</h2>
    ${
      p.narrative.length
        ? `<ul class="pattern-list">${p.narrative.map((n) => `<li>${mdBold(esc(n))}</li>`).join('')}</ul>`
        : '<p class="section-note">Not enough analyzed games to detect reliable patterns yet — keep adding games over time.</p>'
    }
    ${
      p.lostFromWinning.length
        ? `<h3>Winning positions that were lost</h3><ul class="pattern-list">${p.lostFromWinning
            .map((g) => {
              const label = `${esc(g.white)} vs ${esc(g.black)}, ${esc(g.date)} — peaked at ${g.bestWinPct}% win chance${g.decisiveErrorPhase ? `, decisive error in the ${g.decisiveErrorPhase} (move ${g.decisiveErrorMove})` : ''}`;
              return `<li>${g.site.startsWith('http') ? `<a href="${esc(g.site)}" target="_blank" rel="noopener">${label}</a>` : label}</li>`;
            })
            .join('')}</ul>`
        : ''
    }
  </div>`);

  // Time by phase analysis
  if (a.timeByPhase && a.timeByPhase.length > 0 && a.timeByPhase.some(p => p.totalMoves > 0)) {
    html.push(`<div class="card"><h2>⏲️ Move time by phase</h2>
      <table class="data-table">
        <tr><th>Phase</th><th>Avg seconds</th><th>Range</th><th>Moves under 30s</th></tr>
        ${a.timeByPhase.map(p => `
          <tr>
            <td>${p.phase.charAt(0).toUpperCase() + p.phase.slice(1)}</td>
            <td>${p.avgSeconds}s</td>
            <td>${p.minSeconds}s – ${p.maxSeconds}s</td>
            <td>${p.movesUnderThreshold} / ${p.totalMoves}</td>
          </tr>
        `).join('')}
      </table>
      <p class="section-note">Time spent per phase. High pressure in a particular phase often correlates with errors there.</p>
    </div>`);
  }

  // Blunder clustering
  if (a.blunderClusters && a.blunderClusters.length > 0) {
    html.push(`<div class="card"><h2>📊 Blunder clustering</h2>
      <p class="section-note">Moves where multiple blunders occurred in nearby moves — often a sign of specific weak spots.</p>
      <ul>${a.blunderClusters.map(c => `
        <li><b>Moves ${c.moveRange[0]}–${c.moveRange[1]}</b> (${c.phase}): ${c.count} blunder(s)</li>
      `).join('')}</ul>
    </div>`);
  }

  html.push(`<div class="card span-2"><h2>🎯 Training recommendations</h2>
    ${
      a.recommendations.length
        ? a.recommendations
            .map(
              (r) => `<div class="rec-card sev-${r.severity}">
        <h4>${esc(r.area)}<span class="sev-tag">${r.severity} priority</span></h4>
        <p class="section-note">${esc(r.why)}</p>
        <div class="theme-links">${r.themes.map((t) => `<a href="${themeUrl(t.name)}" target="_blank" rel="noopener">🧩 ${esc(t.label)}</a>`).join('')}</div>
        <ul>${r.drills.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>`
            )
            .join('')
        : '<p class="section-note">Run engine analysis to unlock personalized recommendations.</p>'
    }
    <p class="hint">Puzzle links open lichess.org training themes (free). The same themes exist in the chess.com puzzle trainer under Puzzles → Custom.</p>
  </div>`);

  resultsEl.innerHTML = `<div class="card-grid">${html.join('')}</div>`;
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mdBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Delegated once on the (stable) results container, since its innerHTML is fully replaced on
// every re-render — a listener on the buttons themselves would be destroyed each time.
resultsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const pgnBtn = target.closest('.pgn-dl-btn') as HTMLButtonElement | null;
  if (pgnBtn) {
    const rec = records.find((g) => g.id === pgnBtn.dataset.id);
    if (!rec) return;
    const safeName = `${rec.white}_vs_${rec.black}`.replace(/[^\w.-]/g, '_').slice(0, 60);
    downloadPgn(`${rec.date}_${safeName}.pgn`, buildAnnotatedPgn(rec));
    return;
  }
  const assessBtn = target.closest('.assess-btn') as HTMLButtonElement | null;
  if (assessBtn) {
    const row = assessBtn.closest('tr')?.nextElementSibling as HTMLElement | null;
    if (row?.classList.contains('assess-row')) row.hidden = !row.hidden;
  }
});

resultsEl.addEventListener('change', (e) => {
  const select = e.target as HTMLElement;
  if (select.id !== 'opponent-select') return;
  const opponent = (select as HTMLSelectElement).value;
  const body = $('#h2h-body');
  if (body) body.innerHTML = h2hBodyHtml(headToHeadWithOpponent(records, opponent));
});

// ---------- export / persistence ----------
$('#download-md').addEventListener('click', () => {
  if (!currentMarkdown) return;
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const aEl = document.createElement('a');
  aEl.href = url;
  aEl.download = `chess-report-${detectedUsername || 'player'}-${new Date().toISOString().slice(0, 10)}.md`;
  aEl.click();
  URL.revokeObjectURL(url);
});

$('#export-pdf').addEventListener('click', () => {
  if (resultsEl.hidden) return;
  // The browser's print-to-PDF flow uses document.title as the default save filename — set it to
  // something meaningful for the duration of the print dialog, then restore it once the dialog
  // closes. window.print() isn't reliably synchronous across browsers, so restoring the title
  // right after calling it (rather than on 'afterprint') can race the dialog capturing the title.
  const originalTitle = document.title;
  document.title = `chess-report-${detectedUsername || 'player'}-${new Date().toISOString().slice(0, 10)}`;
  window.addEventListener('afterprint', () => { document.title = originalTitle; }, { once: true });
  window.print();
});

