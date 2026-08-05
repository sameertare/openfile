import './style.css';
import type { ParsedGame, ParseFailure } from './pgn';
import { gameId, gameLink, isBotOrComputerGame, splitPgn, tryParseGame } from './pgn';
import { groupPlayerNames, nameKey, inferOwnerColorFromTitle } from './playerMatch';
import type { Color, Result } from './types';
import { Board } from './board';
import { buildTree, childSummaries, nodeAtPath, scorePct, avgOpponentRating, performanceRating } from './openingTree';
import type { TreeNode, RepertoireTree, ChildSummary, GameRef } from './openingTree';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { downloadPgn } from './pgnExport';
import { analyzeGame } from './analyze';
import { aggregate, scorePct as aggScorePct } from './aggregate';
import type { WDL, OpeningRow } from './aggregate';
import type { GameRecord } from './types';
import { Chess } from 'chess.js';
import { newCard, isDue, review } from './srs';
import type { SrsCard } from './srs';
import { Engine } from './engine';
import type { EngineEval } from './engine';
import { fmtEval, uciToSan, pvToSans } from './engineFormat';
import { debounce } from './debounce';
import { getStoredAuth, isReturningFromAuthServer, completeLogin, startLogin, logout } from './lichessAuth';
import type { LichessAuth } from './lichessAuth';

registerServiceWorker();
initTheme();

// ---------- state ----------
interface ExplorerGame { sans: string[]; color: Color; result: Result; opponent: string; opponentRating: number | null; link: string | null; date: string; }

/** The one loaded dataset — whichever account (yours or an opponent's) is currently loaded. Every
 *  panel below (tree, moves, games, scouting report, drill) reads from this same profile; loading
 *  a new source replaces it rather than keeping a separate copy per "who". */
interface Profile {
  parsedGames: ParsedGame[];
  username: string | null;
  matchKeys: Set<string> | null;
  explorerGames: ExplorerGame[];
  // Extra chip HTML from the most recent load (parse failures, bot/computer games excluded) —
  // syncUiToProfile() rebuilds fileSummary from scratch on every call, so this has to live on the
  // profile to survive past the load that set it.
  lastLoadNote: string;
  // Set only by a successful lichess/chess.com username fetch — a shareable position URL needs to
  // be reproducible by re-fetching the same account, which a PGN upload or loaded .tree file (no
  // re-fetchable source) can't offer, so those leave this null and the URL just stays bare.
  loadedFrom: 'lichess' | 'chesscom' | null;
}
function newProfile(): Profile {
  return { parsedGames: [], username: null, matchKeys: null, explorerGames: [], lastLoadNote: '', loadedFrom: null };
}
const profile: Profile = newProfile();

let tree: RepertoireTree | null = null;
let path: string[] = []; // SAN path from root to the currently viewed node
let minGames = 2;

// "Games reaching this position" pagination — reset to page 1 whenever the viewed node changes,
// but preserved across a page-size change or Prev/Next click (both just re-run renderGamesHere).
let gamesPageSize: number | 'all' = 50;
let gamesPage = 0;
let gamesPagePathKey: string | null = null;

// ---------- dom ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fileInput = $('#file-input') as HTMLInputElement;
const dropzone = $('#dropzone');
const fileSummary = $('#file-summary');
const configCard = $('#config-card');
const detectedPlayerName = $('#detected-player-name');
const detectedPlayerCount = $('#detected-player-count');
const colorSelect = $('#color-select') as HTMLSelectElement;
const minGamesSelect = $('#mingames-select') as HTMLSelectElement;
const resultsEl = $('#results');
const breadcrumbEl = $('#breadcrumb');
const nodeStatsEl = $('#node-stats');
const yourMovesEl = $('#your-moves');
const gamesHereEl = $('#games-here');
const gamesHereCountEl = $('#games-here-count');
const lichessUsernameInput = $('#lichess-username') as HTMLInputElement;
const lichessMaxSelect = $('#lichess-max') as HTMLSelectElement;
const lichessFetchBtn = $('#lichess-fetch-btn') as HTMLButtonElement;
const lichessStatusEl = $('#lichess-status');
const chesscomUsernameInput = $('#chesscom-username') as HTMLInputElement;
const chesscomMonthsSelect = $('#chesscom-months') as HTMLSelectElement;
const chesscomFetchBtn = $('#chesscom-fetch-btn') as HTMLButtonElement;
const chesscomStatusEl = $('#chesscom-status');
const scoutingCard = $('#scouting-card');
const scoutingBody = $('#scouting-body');
const drillCard = $('#drill-card');
const drillDueCount = $('#drill-due-count');
const drillStartBtn = $('#drill-start-btn') as HTMLButtonElement;
const drillIntro = $('#drill-intro');
const drillSession = $('#drill-session');
const drillFeedback = $('#drill-feedback');
const drillProgress = $('#drill-progress');
const drillNextBtn = $('#drill-next-btn') as HTMLButtonElement;
const drillStopBtn = $('#drill-stop-btn') as HTMLButtonElement;
const drillSummary = $('#drill-summary');
const explorerDepthSelect = $('#explorer-depth') as HTMLSelectElement;
const explorerCandidatesEl = $('#explorer-candidates');
const bookConnectEl = $('#book-connect');
const bookBodyEl = $('#book-body');
const bookUsernameEl = $('#book-username');
const bookTableEl = $('#book-table');
const lichessConnectBtn = $('#lichess-connect-btn') as HTMLButtonElement;
const lichessDisconnectBtn = $('#lichess-disconnect-btn') as HTMLButtonElement;
const copyLinkBtn = $('#copy-link-btn') as HTMLButtonElement;

const board = new Board($('#board'));
const drillBoard = new Board($('#drill-board'));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Reflects the loaded profile into every piece of UI that depends on it — called after any
 *  load/fetch completes. */
function syncUiToProfile() {
  const p = profile;
  const downloadBtn = p.parsedGames.length
    ? ` <button class="btn btn-ghost btn-sm dl-loaded-pgn-btn" title="Download every currently loaded game as one PGN file">⬇ Download PGN</button>`
    : '';
  const saveTreeBtn = p.explorerGames.length
    ? ` <button class="btn btn-ghost btn-sm save-tree-btn" title="Save the built tree as a portable .tree.json file — reload it later instantly, without re-fetching or re-parsing">⬇ Save tree</button>`
    : '';
  const chip = p.parsedGames.length
    ? `<span class="chip">♟ ${p.parsedGames.length} game(s) loaded</span>`
    : p.explorerGames.length
      ? `<span class="chip">🌳 Tree loaded from file (${p.explorerGames.length} game(s), no raw PGN)</span>`
      : '';
  fileSummary.innerHTML = chip + downloadBtn + saveTreeBtn + p.lastLoadNote;
  fileSummary.querySelector('.dl-loaded-pgn-btn')?.addEventListener('click', () => {
    // Use each game's own original raw PGN text (headers exactly as fetched — real ratings, event
    // names, site URLs) rather than reconstructing synthetic ones, since the whole point here is a
    // faithful copy of what was actually loaded, not a re-derived summary of it.
    const pgn = profile.parsedGames.map((g) => g.raw.trim()).join('\n\n');
    const safeName = (profile.username || 'games').replace(/[^\w.-]/g, '_').slice(0, 60);
    downloadPgn(`${safeName}_${profile.parsedGames.length}games.pgn`, pgn);
  });
  fileSummary.querySelector('.save-tree-btn')?.addEventListener('click', () => {
    downloadTreeFile();
  });
  detectedPlayerName.textContent = p.username ?? '—';
  detectedPlayerCount.textContent = p.explorerGames.length
    ? ` — ${p.explorerGames.length} game${p.explorerGames.length === 1 ? '' : 's'} available`
    : '';
  lichessStatusEl.textContent = '';
  chesscomStatusEl.textContent = '';
  void renderScoutingReport();

  if (p.explorerGames.length) {
    configCard.hidden = false;
    rebuildAndRender();
  } else {
    configCard.hidden = true;
    resultsEl.hidden = true;
    drillCard.hidden = true;
  }
}

// ---------- file loading (same pattern as Performance Analysis) ----------
async function handleFiles(
  files: FileList | File[],
  forceUsername?: string,
  source: 'lichess' | 'chesscom' | null = null
) {
  const p = profile;
  // A shareable position URL needs a re-fetchable source — fetchFromLichess/fetchFromChessCom pass
  // their own source through so this is set correctly *before* the render() a few lines down (via
  // finalizeAfterLoad) reads it; a plain upload (drag-drop, file picker, bundled sample) passes
  // none, which also correctly invalidates any source a previous load had.
  p.loadedFrom = source;
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
        p.parsedGames.push(game);
      } else {
        failed++;
        if (error) recordFailure(error);
      }
    }
  }
  const seen = new Set<string>();
  p.parsedGames = p.parsedGames.filter((g) => {
    const id = gameId(g);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // syncUiToProfile() (called at the end of finalizeAfterLoad, below) rebuilds fileSummary from
  // scratch with just the "N games loaded" chip — stash the rest here so it survives that
  // overwrite instead of flashing and disappearing.
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
  p.lastLoadNote = note;

  finalizeAfterLoad(forceUsername);
}

/** Sets the detected player (auto-detected, or forced to a known username) and rebuilds everything
 *  downstream. Split out from handleFiles so the lichess/chess.com fetch flows — which already
 *  know exactly whose account they fetched — can skip the frequency heuristic entirely. */
function finalizeAfterLoad(forceUsername?: string) {
  const p = profile;
  if (!p.parsedGames.length) return;
  const detected = forceUsername
    ? { name: forceUsername, matchKeys: new Set([nameKey(forceUsername)]) }
    : detectMainPlayer(p.parsedGames);
  p.username = detected?.name ?? null;
  p.matchKeys = detected?.matchKeys ?? null;
  p.explorerGames = p.matchKeys ? buildExplorerGames(p.parsedGames, p.matchKeys) : [];

  configCard.hidden = false;
  configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  syncUiToProfile();
}

/** Same heuristic as Performance Analysis: the player appearing in the most games, with name
 *  variants (casing, "Last, First" order, nicknames) folded together. */
function detectMainPlayer(parsedGames: ParsedGame[]): { name: string; count: number; matchKeys: Set<string> } | null {
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
  return { name: best.display, count: best.count, matchKeys: best.keys };
}

/** Same color/result derivation as analyzeGame() in analyze.ts, minus the engine-analysis parts
 *  this tool doesn't need, plus opponent name/link/date for the per-position games list. */
function buildExplorerGames(parsedGames: ParsedGame[], matchKeys: Set<string>): ExplorerGame[] {
  const out: ExplorerGame[] = [];
  for (const g of parsedGames) {
    const h = g.headers;
    // buildTree() (openingTree.ts) replays each game's SANs from a fresh standard starting
    // position to rebuild the tree — unlike pgn.ts's own parse (which correctly honors a [FEN]/
    // [SetUp] header via chess.js), it has no way to know a game didn't start from the standard
    // position. A Chess960/"fromPosition" game's SANs replayed from the wrong start either land on
    // a fabricated position it was never actually in, or throw partway through and truncate the
    // line — either way silently corrupting the tree with data that doesn't reflect real games.
    if (h['FEN'] || (h['Variant'] && !/^(standard|chess)$/i.test(h['Variant'].trim()))) continue;
    const hasWhiteName = !!h['White'] && h['White'] !== '?';
    const hasBlackName = !!h['Black'] && h['Black'] !== '?';
    const userIsWhite =
      hasWhiteName || hasBlackName
        ? matchKeys.has(nameKey(h['White'] ?? ''))
        : inferOwnerColorFromTitle(h['ChapterName'] || h['Event']) !== 'b';
    // Skip games that don't actually involve the detected player at all.
    if (hasWhiteName || hasBlackName) {
      const involved = matchKeys.has(nameKey(h['White'] ?? '')) || matchKeys.has(nameKey(h['Black'] ?? ''));
      if (!involved) continue;
    }
    const color: Color = userIsWhite ? 'w' : 'b';
    const resultRaw = h['Result'] ?? '*';
    let result: Result;
    if (resultRaw === '1-0') result = userIsWhite ? 'win' : 'loss';
    else if (resultRaw === '0-1') result = userIsWhite ? 'loss' : 'win';
    else if (resultRaw === '1/2-1/2') result = 'draw';
    else result = 'unknown';
    const opponent = (userIsWhite ? h['Black'] : h['White']) || 'Unknown';
    const opponentRatingRaw = Number(userIsWhite ? h['BlackElo'] : h['WhiteElo']);
    const opponentRating = Number.isFinite(opponentRatingRaw) && opponentRatingRaw > 0 ? opponentRatingRaw : null;
    out.push({
      sans: g.moves.map((m) => m.san),
      color,
      result,
      opponent,
      opponentRating,
      link: gameLink(h),
      date: h['Date'] ?? h['UTCDate'] ?? '',
    });
  }
  return out;
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void handleFiles(fileInput.files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
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

// ---------- save/load a fully-built tree as a portable .tree.json file ----------
// Distinct from "Download PGN" above: this skips straight to the already-computed ExplorerGame
// list (no raw PGN text, no re-parsing or re-detecting the tracked player on reload), so a large
// account's tree can be reopened instantly later without re-fetching from lichess/chess.com.
interface TreeFile { version: 1; username: string | null; explorerGames: ExplorerGame[]; }

function downloadTreeFile() {
  const payload: TreeFile = { version: 1, username: profile.username, explorerGames: profile.explorerGames };
  const safeName = (profile.username || 'repertoire').replace(/[^\w.-]/g, '_').slice(0, 60);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.tree.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const treeFileInput = $('#tree-file-input') as HTMLInputElement;
treeFileInput.addEventListener('change', () => void loadTreeFile());

async function loadTreeFile() {
  const file = treeFileInput.files?.[0];
  treeFileInput.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data.username !== 'string' || !Array.isArray(data.explorerGames)) {
      throw new Error('not a valid .tree.json file');
    }
    profile.username = data.username;
    profile.matchKeys = new Set([nameKey(data.username)]);
    profile.explorerGames = data.explorerGames;
    profile.parsedGames = []; // no raw PGN in a tree file — scouting report/PGN re-export stay unavailable
    profile.loadedFrom = null; // not re-fetchable from a URL
    profile.lastLoadNote = '';
    configCard.hidden = false;
    configCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    syncUiToProfile();
  } catch (e) {
    fileSummary.innerHTML = `<span class="chip">⚠ Could not load tree file: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
  }
}

// ---------- lichess username bulk fetch ----------
lichessFetchBtn.addEventListener('click', () => void fetchFromLichess());
lichessUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromLichess();
});

async function fetchFromLichess() {
  const username = lichessUsernameInput.value.trim();
  if (!username) {
    lichessStatusEl.textContent = 'Enter a lichess username first.';
    return;
  }
  const max = lichessMaxSelect.value;
  lichessFetchBtn.disabled = true;
  lichessStatusEl.textContent = `Fetching up to ${max} games for ${username} from lichess… this can take a moment for larger counts.`;
  try {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&pgnInJson=false&clocks=false&evals=false&opening=false`;
    const resp = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
    if (resp.status === 404) throw new Error(`No lichess account named "${username}" found.`);
    if (resp.status === 429) throw new Error('Lichess is rate-limiting this request — wait a minute and try again.');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (!text.trim()) {
      lichessStatusEl.textContent = `${username} has no games matching this request.`;
      return;
    }
    const file = new File([text], `${username}-lichess.pgn`);
    await handleFiles([file], username, 'lichess');
    lichessStatusEl.textContent = `Loaded games for ${username} from lichess.`;
  } catch (e) {
    lichessStatusEl.textContent = `Could not fetch from lichess: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    lichessFetchBtn.disabled = false;
  }
}

// ---------- chess.com username bulk fetch ----------
// Chess.com's public "Published Data API" has no single all-games endpoint like lichess — games
// are grouped into monthly archives, so this fetches the archive list, then the N most recent
// months in parallel, and concatenates each game's own `pgn` field (already a complete PGN chunk)
// into one blob for the existing splitPgn/tryParseGame pipeline. Chess.com's own [Site] header is
// never a URL ("Chess.com", not a link), so the game's separate `url` field is injected as a
// [Link] header so gameLink() can still resolve a "View" link downstream.
interface ChessComArchivesResponse { archives: string[]; }
interface ChessComGamesResponse { games: { pgn?: string; url?: string }[]; }

chesscomFetchBtn.addEventListener('click', () => void fetchFromChessCom());
chesscomUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void fetchFromChessCom();
});

async function fetchFromChessCom() {
  const username = chesscomUsernameInput.value.trim();
  if (!username) {
    chesscomStatusEl.textContent = 'Enter a chess.com username first.';
    return;
  }
  const monthsBack = parseInt(chesscomMonthsSelect.value, 10);
  chesscomFetchBtn.disabled = true;
  chesscomStatusEl.textContent = `Fetching up to ${monthsBack} month(s) of games for ${username} from chess.com…`;
  try {
    const archivesResp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
    if (archivesResp.status === 404) throw new Error(`No chess.com account named "${username}" found.`);
    if (!archivesResp.ok) throw new Error(`HTTP ${archivesResp.status}`);
    const archivesData: ChessComArchivesResponse = await archivesResp.json();
    const archives = archivesData.archives ?? [];
    if (!archives.length) {
      chesscomStatusEl.textContent = `${username} has no game archives on chess.com.`;
      return;
    }
    const selected = archives.slice(-monthsBack); // archives are oldest-first; take the most recent N
    const monthResults = await Promise.all(
      selected.map(async (url) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return [];
          const data: ChessComGamesResponse = await r.json();
          return (data.games ?? [])
            .filter((g): g is { pgn: string; url?: string } => !!g.pgn)
            .map((g) => (g.url && !/\[Link /.test(g.pgn) ? `[Link "${g.url}"]\n${g.pgn}` : g.pgn));
        } catch {
          return []; // one bad month shouldn't sink the whole fetch
        }
      })
    );
    const allPgns = monthResults.flat();
    if (!allPgns.length) {
      chesscomStatusEl.textContent = `No games found for ${username} in the selected range.`;
      return;
    }
    const text = allPgns.join('\n\n');
    const file = new File([text], `${username}-chesscom.pgn`);
    await handleFiles([file], username, 'chesscom');
    chesscomStatusEl.textContent = `Loaded ${allPgns.length} game(s) for ${username} from chess.com.`;
  } catch (e) {
    chesscomStatusEl.textContent = `Could not fetch from chess.com: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    chesscomFetchBtn.disabled = false;
  }
}

// ---------- engine analysis for the currently-viewed node ----------
let engine: Engine | null = null;
let enginePromise: Promise<Engine> | null = null;
async function getEngine(): Promise<Engine> {
  if (engine) return engine;
  if (!enginePromise) {
    enginePromise = (async () => {
      const e = new Engine();
      await e.init();
      engine = e;
      return e;
    })();
  }
  return enginePromise;
}

const NUM_CANDIDATES = 3;
let candidatesToken = 0;

function renderCandidates(fen: string, results: EngineEval[]) {
  if (!results.length) { explorerCandidatesEl.innerHTML = ''; board.setArrows([]); return; }
  const stmWhite = fen.split(' ')[1] === 'w';
  const arrows = results
    .slice(0, NUM_CANDIDATES)
    .map((r, i) => {
      const uci = r.bestmove;
      return uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4), rank: (i + 1) as 1 | 2 | 3 } : null;
    })
    .filter((a): a is { from: string; to: string; rank: 1 | 2 | 3 } => a !== null);
  board.setArrows(arrows);

  const rows = results.slice(0, NUM_CANDIDATES).map((r, i) => {
    const san = r.bestmove ? uciToSan(fen, r.bestmove) ?? r.bestmove : '—';
    const whiteEval = stmWhite ? r.cp : -r.cp;
    const evalStr = fmtEval(whiteEval, r.mateIn, stmWhite);
    const contPv = r.bestmove ? pvToSans(fen, r.pv, 4).slice(1).join(' ') : '';
    return `<div class="cand-row cand-rank${i + 1}">
      <span class="cand-num">${i + 1}</span>
      <span class="cand-move">${esc(san)}</span>
      <span class="eval-chip">${esc(evalStr)}</span>
      ${contPv ? `<span class="hint cand-cont">${esc(contPv)}</span>` : ''}
    </div>`;
  });
  explorerCandidatesEl.innerHTML = rows.join('');
}

async function updateCandidates() {
  const token = ++candidatesToken;
  const node = currentNode();
  if (!node) { explorerCandidatesEl.innerHTML = ''; board.setArrows([]); return; }
  const fen = node.fen;
  const c = new Chess(fen);
  if (c.isGameOver()) { explorerCandidatesEl.innerHTML = '<p class="hint">Game over in this position.</p>'; board.setArrows([]); return; }
  explorerCandidatesEl.innerHTML = '<p class="hint">Analyzing…</p>';
  const depth = parseInt(explorerDepthSelect.value, 10);
  const eng = await getEngine();
  const results = await eng.evaluateMultiPv(fen, depth, NUM_CANDIDATES);
  if (token !== candidatesToken) return; // superseded by a newer navigation
  if (currentNode()?.fen !== fen) return; // view moved on while we were searching
  renderCandidates(fen, results);
}

const debouncedUpdateCandidates = debounce(updateCandidates, 80);
explorerDepthSelect.addEventListener('change', () => void updateCandidates());

// ---------- Lichess book theory (requires a connected Lichess account — see lichessAuth.ts) ----------
let lichessAuth: LichessAuth | null = getStoredAuth();
let bookToken = 0;

function renderBookAuthUi() {
  bookConnectEl.hidden = !!lichessAuth;
  bookBodyEl.hidden = !lichessAuth;
  if (lichessAuth) bookUsernameEl.textContent = lichessAuth.username;
}
renderBookAuthUi();

// Connecting a Lichess account is a full-page redirect to lichess.org and back (OAuth's
// Authorization Code flow has no way around that) — everything in this module's memory, including
// a loaded PGN or .tree.json profile, is gone by the time the page comes back. A profile loaded
// via lichess/chess.com username fetch already survives this through the shareable-URL mechanism
// above (the account just gets re-fetched on return), but a raw PGN/tree-file profile has no such
// re-fetchable source — so stash it here right before redirecting, and restore it on the way back.
const OAUTH_SNAPSHOT_KEY = 'openfile-explorer-oauth-snapshot';
interface OAuthSnapshot {
  parsedGames: ParsedGame[];
  username: string | null;
  matchKeys: string[] | null;
  explorerGames: ExplorerGame[];
  color: string;
  path: string[];
}

lichessConnectBtn.addEventListener('click', () => {
  if (!profile.loadedFrom && (profile.parsedGames.length || profile.explorerGames.length)) {
    const snapshot: OAuthSnapshot = {
      parsedGames: profile.parsedGames,
      username: profile.username,
      matchKeys: profile.matchKeys ? [...profile.matchKeys] : null,
      explorerGames: profile.explorerGames,
      color: colorSelect.value,
      path,
    };
    try {
      sessionStorage.setItem(OAUTH_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      // sessionStorage unavailable/full — connecting will just cost the loaded profile, same as
      // before this fix existed, rather than blocking the connect flow over it
    }
  }
  void startLogin();
});

function restoreOAuthSnapshotIfPresent() {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(OAUTH_SNAPSHOT_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  sessionStorage.removeItem(OAUTH_SNAPSHOT_KEY);
  try {
    const snap: OAuthSnapshot = JSON.parse(raw);
    profile.parsedGames = snap.parsedGames;
    profile.username = snap.username;
    profile.matchKeys = snap.matchKeys ? new Set(snap.matchKeys) : null;
    profile.explorerGames = snap.explorerGames;
    profile.loadedFrom = null;
    if (snap.color === 'w' || snap.color === 'b') colorSelect.value = snap.color;
    configCard.hidden = false;
    syncUiToProfile();
    // Re-validate the restored path against the freshly-rebuilt tree the same way tryLoadFromUrl
    // does — syncUiToProfile()'s rebuildAndRender() already reset path to [], so walk it back in.
    if (snap.path.length && tree) {
      let node = tree.root;
      const validPath: string[] = [];
      for (const san of snap.path) {
        const childKey = node.children.get(san);
        if (!childKey) break;
        const child = tree.positions.get(childKey);
        if (!child) break;
        node = child;
        validPath.push(san);
      }
      path = validPath;
      render();
    }
  } catch {
    // corrupt snapshot — nothing to restore, but don't crash the page load over it
  }
}
lichessDisconnectBtn.addEventListener('click', async () => {
  await logout();
  lichessAuth = null;
  renderBookAuthUi();
  bookTableEl.innerHTML = '';
});

interface LichessExplorerMove { san: string; white: number; draws: number; black: number; }
interface LichessExplorerResponse { white: number; draws: number; black: number; moves: LichessExplorerMove[]; }

function bookTableHtml(moves: LichessExplorerMove[]): string {
  if (!moves.length) return `<p class="hint">No book games reach this exact position.</p>`;
  const withTotal = moves.map((m) => ({ ...m, total: m.white + m.draws + m.black })).filter((m) => m.total > 0);
  if (!withTotal.length) return `<p class="hint">No book games reach this exact position.</p>`;
  const maxGames = Math.max(...withTotal.map((m) => m.total));
  const rows = withTotal
    .map((m) => {
      const whiteW = (m.white / m.total) * 100;
      const drawW = (m.draws / m.total) * 100;
      const blackW = (m.black / m.total) * 100;
      const barWidth = 40 + (m.total / maxGames) * 60;
      return `<tr>
        <td><b>${esc(m.san)}</b></td>
        <td class="num">${m.total.toLocaleString()}</td>
        <td>
          <div class="score-bar" style="width:${barWidth}%">
            <div class="seg win" style="width:${whiteW}%"></div>
            <div class="seg draw" style="width:${drawW}%"></div>
            <div class="seg loss" style="width:${blackW}%"></div>
          </div>
        </td>
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Move</th><th class="num">Games</th><th>White / Draw / Black</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function updateBookTheory() {
  const token = ++bookToken;
  if (!lichessAuth) { bookTableEl.innerHTML = ''; return; }
  const node = currentNode();
  if (!node) { bookTableEl.innerHTML = ''; return; }
  const fen = node.fen;
  bookTableEl.innerHTML = '<p class="hint">Looking up book theory…</p>';
  try {
    const url = `https://explorer.lichess.org/lichess?variant=standard&fen=${encodeURIComponent(fen)}&moves=12&topGames=0&recentGames=0`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${lichessAuth.token}` } });
    if (token !== bookToken) return; // superseded
    if (currentNode()?.fen !== fen) return; // view moved on
    if (resp.status === 401) {
      // Token expired or was revoked on Lichess's side — drop it and prompt reconnect rather than
      // silently failing on every subsequent navigation.
      clearStoredAuthAndUi();
      return;
    }
    if (!resp.ok) { bookTableEl.innerHTML = `<p class="hint">Lichess book lookup failed (HTTP ${resp.status}).</p>`; return; }
    const data: LichessExplorerResponse = await resp.json();
    bookTableEl.innerHTML = bookTableHtml(data.moves ?? []);
  } catch {
    if (token !== bookToken) return;
    bookTableEl.innerHTML = `<p class="hint">Lichess book lookup failed — check your connection and try again.</p>`;
  }
}

function clearStoredAuthAndUi() {
  lichessAuth = null;
  logout(); // best-effort revoke; already cleared locally by us setting lichessAuth = null above
  renderBookAuthUi();
  bookTableEl.innerHTML = `<p class="hint">Your Lichess connection expired — reconnect above to keep seeing book theory.</p>`;
}

const debouncedUpdateBookTheory = debounce(updateBookTheory, 200);

// Restores a PGN/tree-file profile stashed right before a Lichess-connect redirect (see
// lichessConnectBtn above) — checked unconditionally rather than only when this load is an OAuth
// return, so a snapshot still gets restored even if the user closed the lichess.org tab instead of
// completing the flow.
restoreOAuthSnapshotIfPresent();

// Resolves the OAuth redirect back from Lichess, if this page load is one.
if (isReturningFromAuthServer()) {
  void (async () => {
    const result = await completeLogin();
    if (result) {
      lichessAuth = result;
      renderBookAuthUi();
      debouncedUpdateBookTheory();
    } else {
      renderBookAuthUi();
    }
  })();
}

// ---------- shareable position URLs ----------
// Only meaningful for a profile loaded via a re-fetchable source (lichess/chess.com username) —
// see Profile.loadedFrom above. Kept in sync via history.replaceState (never pushState: every
// tree click would otherwise flood the browser's back-history) so the address bar always reflects
// exactly what's on screen, ready to copy at any moment without a separate "generate link" step.
function updateUrlForCurrentState() {
  const p = profile;
  const params = new URLSearchParams();
  if (p.loadedFrom && p.username) {
    params.set('src', p.loadedFrom);
    params.set('user', p.username);
    params.set('color', colorSelect.value);
    if (path.length) params.set('path', path.join(','));
  }
  const qs = params.toString();
  const url = location.pathname + (qs ? `?${qs}` : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
  copyLinkBtn.hidden = !(p.loadedFrom && p.username);
}

function flashCopied(btn: HTMLButtonElement, label: string) {
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

copyLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    flashCopied(copyLinkBtn, '✓ Copied');
  } catch {
    flashCopied(copyLinkBtn, 'Copy failed');
  }
});

/** Reproduces a shared link on page load: re-fetches the named account, picks the right tab and
 *  color, and walks as deep into `path` as the rebuilt tree actually supports — a link can go
 *  stale if the account's games have changed since it was shared, so this deliberately stops at
 *  the deepest still-valid prefix instead of failing outright. */
async function tryLoadFromUrl() {
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  const user = params.get('user');
  if (!src || !user || (src !== 'lichess' && src !== 'chesscom')) return;

  const color = params.get('color');
  if (color === 'w' || color === 'b') colorSelect.value = color;

  if (src === 'lichess') {
    lichessUsernameInput.value = user;
    await fetchFromLichess();
  } else {
    chesscomUsernameInput.value = user;
    await fetchFromChessCom();
  }

  const pathParam = params.get('path');
  if (pathParam && tree) {
    const wanted = pathParam.split(',').filter(Boolean);
    let node = tree.root;
    const validPath: string[] = [];
    for (const san of wanted) {
      const childKey = node.children.get(san);
      if (!childKey) break;
      const child = tree.positions.get(childKey);
      if (!child) break;
      node = child;
      validPath.push(san);
    }
    path = validPath;
    render();
  }
}

// ---------- tree building & navigation ----------
colorSelect.addEventListener('change', () => {
  path = [];
  rebuildAndRender();
});
minGamesSelect.addEventListener('change', () => {
  minGames = parseInt(minGamesSelect.value, 10);
  render();
});

// ---------- opponent scouting report ----------
// Openings/results/time-control only, deliberately no engine pass — analyzeGame() with depth 0
// and no engine skips move-quality analysis entirely (evalSource stays 'none') but still computes
// opening identification, result, color, and time-class synchronously from the PGN headers alone,
// which is exactly what a scouting report needs and fast enough for a full account's worth of
// games. aggregate()'s accuracy/phase/tactics/pattern numbers are meaningless without evals, so
// only the sections that don't depend on them are rendered.
let scoutingToken = 0;

function pctSpan(v: number | null): string {
  if (v === null) return '—';
  const c = v >= 60 ? 'pos' : v >= 40 ? 'mid' : 'neg';
  return `<span class="${c}">${v}%</span>`;
}
function wdlRowHtml(label: string, w: WDL): string {
  return `<tr><td>${label}</td><td class="num">${w.games}</td><td class="num pos">${w.wins}</td><td class="num mid">${w.draws}</td><td class="num neg">${w.losses}</td><td class="num">${pctSpan(aggScorePct(w))}</td></tr>`;
}
function openingRowsHtml(rows: OpeningRow[]): string {
  if (!rows.length) return `<p class="section-note">Not enough games in any single opening yet.</p>`;
  return `<table><thead><tr><th>Opening</th><th>ECO</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th><th class="num">White/Black</th></tr></thead><tbody>${rows
    .map(
      (o) =>
        `<tr><td>${esc(o.family)}</td><td>${esc(o.eco || '—')}</td><td class="num">${o.games}</td><td class="num pos">${o.wins}</td><td class="num mid">${o.draws}</td><td class="num neg">${o.losses}</td><td class="num">${pctSpan(aggScorePct(o))}</td><td class="num">${o.asWhite}/${o.asBlack}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

async function renderScoutingReport() {
  const token = ++scoutingToken;
  const p = profile;
  if (!p.parsedGames.length || !p.matchKeys || !p.username) { scoutingCard.hidden = true; return; }

  scoutingCard.hidden = false;
  scoutingBody.innerHTML = `<p class="hint">Building scouting report for ${p.parsedGames.length} game(s)…</p>`;

  const records: GameRecord[] = [];
  for (const game of p.parsedGames) {
    try {
      records.push(await analyzeGame(game, { username: p.username, matchKeys: p.matchKeys, depth: 0, engine: null }));
    } catch {
      // Skip a game that fails to analyze rather than aborting the whole report over one bad game.
    }
  }
  if (token !== scoutingToken) return; // superseded by a newer load or profile switch

  const a = aggregate(records);
  const unfinished = records.length - a.total.games;
  scoutingBody.innerHTML = `
    <div class="summary-cards">
      <div class="stat-card"><span class="big">${a.total.games}</span><span class="label">Games</span></div>
      <div class="stat-card"><span class="big">${a.total.wins}-${a.total.draws}-${a.total.losses}</span><span class="label">W-D-L</span></div>
      <div class="stat-card"><span class="big">${pctSpan(aggScorePct(a.total))}</span><span class="label">Score</span></div>
    </div>
    ${unfinished ? `<p class="section-note">${unfinished} unfinished/undecided game(s) excluded from W-D-L and score.</p>` : ''}
    <table><thead><tr><th></th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>
      ${wdlRowHtml('As White', a.byColor.white)}
      ${wdlRowHtml('As Black', a.byColor.black)}
    </tbody></table>

    <h3>Results by time control</h3>
    <table><thead><tr><th>Time control</th><th class="num">Games</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr></thead><tbody>
      ${a.byTimeClass.map((tc) => wdlRowHtml(tc.timeClass, tc.wdl)).join('')}
    </tbody></table>

    <h3>Most-played openings</h3>
    ${openingRowsHtml(a.openings)}

    <h3>Best-scoring openings (2+ games)</h3>
    ${openingRowsHtml(a.strongest)}

    <h3>Worst-scoring openings (2+ games) — target these</h3>
    ${openingRowsHtml(a.weakest)}
  `;
}

function rebuildAndRender() {
  const color = colorSelect.value as Color;
  const games = profile.explorerGames.filter((g) => g.color === color);
  tree = buildTree(games);
  path = [];
  board.setOrientation(color);
  resultsEl.hidden = false;
  render();
  updateDrillCard();
}

// ======================================================================
// opening repertoire trainer — spaced-repetition drill on the tree above
// ======================================================================
interface QuizNode { path: string[]; node: TreeNode }

/** Every position in the tree where it's the tracked player's own turn AND they've actually
 *  played at least one move from there — i.e. everything worth quizzing. Never includes the
 *  opponent's replies, only the tracked player's own decisions.
 *
 *  Deduped by position (not by path): now that the tree merges transpositions, the same position
 *  can be reachable via more than one move order, and the walk below would otherwise visit it once
 *  per path — a redundant "same board, same question" repeat in a drilling session, and (since the
 *  graph is now a merged DAG rather than a strict tree) a real risk of unbounded recursion if two
 *  different games' contributions happen to chain into a cycle. `visited` guards against both:
 *  each position is collected once, via whichever path reaches it first. */
function collectQuizzableNodes(t: RepertoireTree, color: Color): QuizNode[] {
  const out: QuizNode[] = [];
  const visited = new Set<string>();
  const walk = (node: TreeNode, path: string[], key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    if (node.fen.split(' ')[1] === color && node.children.size > 0) out.push({ path, node });
    for (const [san, childKey] of node.children) {
      const child = t.positions.get(childKey);
      if (child) walk(child, [...path, san], childKey);
    }
  };
  walk(t.root, [], t.rootKey);
  return out;
}

function srsStorageKey(): string | null {
  const p = profile;
  if (!p.username) return null;
  const color = colorSelect.value as Color;
  return `openfile-srs:${p.username.trim().toLowerCase()}:${color}`;
}

function loadSrsData(): Record<string, SrsCard> {
  const key = srsStorageKey();
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {}; // corrupt JSON or private-browsing storage denial — start fresh rather than crash
  }
}

function saveSrsData(data: Record<string, SrsCard>) {
  const key = srsStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage unavailable/full — drilling still works for this session, just won't persist
  }
}

function pathKey(path: string[]): string {
  return path.join('|');
}

// ---------- drill session state ----------
let srsData: Record<string, SrsCard> = {};
let drillQueue: QuizNode[] = [];
let drillCurrent: QuizNode | null = null;
let drillStats = { correct: 0, incorrect: 0 };
let drillAwaitingNext = false;

function updateDrillCard() {
  if (!tree) { drillCard.hidden = true; return; }
  const quizzable = collectQuizzableNodes(tree, colorSelect.value as Color);
  if (!quizzable.length) { drillCard.hidden = true; return; }
  drillCard.hidden = false;
  srsData = loadSrsData();
  const now = new Date();
  const dueCount = quizzable.filter((q) => {
    const card = srsData[pathKey(q.path)];
    return !card || isDue(card, now);
  }).length;
  drillDueCount.textContent = `${dueCount} of ${quizzable.length} position(s) due for review.`;
  drillIntro.hidden = false;
  drillSession.hidden = true;
  drillSummary.hidden = true;
}

const DRILL_SESSION_CAP = 30; // a generous single-session size; click Start again for more

drillStartBtn.addEventListener('click', () => {
  if (!tree) return;
  const color = colorSelect.value as Color;
  const quizzable = collectQuizzableNodes(tree, color);
  srsData = loadSrsData();
  const now = new Date();
  // Overdue/never-seen first (oldest due date first), then anything not yet due, capped to a
  // reasonable session size so "Start drilling" doesn't try to quiz the entire tree at once.
  const withDue = quizzable.map((q) => ({ q, card: srsData[pathKey(q.path)] }));
  withDue.sort((a, b) => {
    const aDue = a.card ? new Date(a.card.dueAt).getTime() : -Infinity; // never-seen sorts first
    const bDue = b.card ? new Date(b.card.dueAt).getTime() : -Infinity;
    return aDue - bDue;
  });
  drillQueue = withDue.filter((x) => !x.card || isDue(x.card, now)).slice(0, DRILL_SESSION_CAP).map((x) => x.q);
  if (!drillQueue.length) {
    // Nothing due — offer to practice ahead of schedule anyway rather than a dead end.
    drillQueue = withDue.slice(0, DRILL_SESSION_CAP).map((x) => x.q);
  }
  drillStats = { correct: 0, incorrect: 0 };
  drillIntro.hidden = true;
  drillSummary.hidden = true;
  drillSession.hidden = false;
  drillBoard.setOrientation(color);
  nextDrillPosition();
});

function nextDrillPosition() {
  drillFeedback.className = 'drill-feedback';
  drillFeedback.innerHTML = '';
  drillNextBtn.hidden = true;
  drillAwaitingNext = false;
  drillBoard.setSelected(null);
  drillBoard.setArrow(null);

  const next = drillQueue.shift();
  if (!next) {
    drillSession.hidden = true;
    drillSummary.hidden = false;
    const total = drillStats.correct + drillStats.incorrect;
    drillSummary.innerHTML = `
      <div class="drill-summary-stats">
        <div class="stat-card"><span class="big pos">${drillStats.correct}</span><span class="label">Correct</span></div>
        <div class="stat-card"><span class="big neg">${drillStats.incorrect}</span><span class="label">Missed</span></div>
      </div>
      <p class="hint">${total} position(s) drilled this session.</p>
      <button id="drill-restart-btn" class="btn btn-primary">▶ Drill again</button>
    `;
    $('#drill-restart-btn').addEventListener('click', () => { updateDrillCard(); drillStartBtn.click(); });
    return;
  }
  drillCurrent = next;
  drillBoard.setFen(next.node.fen);
  drillProgress.textContent = `${drillQueue.length + 1} position(s) left this session · ${drillStats.correct} correct, ${drillStats.incorrect} missed so far`;
}

function answerDrill(playedSan: string) {
  if (!drillCurrent || drillAwaitingNext || !tree) return;
  drillAwaitingNext = true;
  const key = pathKey(drillCurrent.path);
  const correct = drillCurrent.node.children.has(playedSan);
  const prior = srsData[key] ?? newCard();
  srsData[key] = review(prior, correct);
  saveSrsData(srsData);

  const summaries = childSummaries(tree, drillCurrent.node);
  const list = summaries
    .map((c) => `<li><b>${esc(c.san)}</b> — ${c.games} game(s), ${c.scorePct}% score${c.san === playedSan ? ' ✓ (what you played)' : ''}</li>`)
    .join('');

  if (correct) {
    drillStats.correct++;
    drillFeedback.className = 'drill-feedback correct';
    drillFeedback.innerHTML = `<b>✓ Correct</b> — ${esc(playedSan)} is a move you've played here.<ul>${list}</ul>`;
  } else {
    drillStats.incorrect++;
    drillFeedback.className = 'drill-feedback incorrect';
    drillFeedback.innerHTML = `<b>✗ Not in your repertoire</b> — you played ${esc(playedSan)}, but from this position you've actually played:<ul>${list}</ul>`;
    // Requeue at the back of this session's queue so a miss gets one more attempt before the
    // session ends, on top of the SRS record already scheduling it sooner for next time.
    if (drillCurrent) drillQueue.push(drillCurrent);
  }
  drillNextBtn.hidden = false;
}

drillBoard.onSquareClick = (sq) => {
  if (!drillCurrent || drillAwaitingNext) return;
  const fen = drillCurrent.node.fen;
  const c = new Chess(fen);
  const piece = c.get(sq as any);
  const sel = drillBoard.getSelected();
  if (sel && sel !== sq) {
    const moves = c.moves({ square: sel as any, verbose: true }) as any[];
    const m = moves.find((x) => x.to === sq);
    if (m) {
      drillBoard.setSelected(null);
      drillBoard.setLastMove([m.from, m.to]);
      answerDrill(m.san);
      return;
    }
    // Not a legal chess move (distinct from a legal move that's just not in the repertoire, which
    // answerDrill already handles as a normal "incorrect" answer) — flash it so a mis-click reads
    // as "try again" rather than the board silently doing nothing.
    if (!(piece && piece.color === c.turn())) drillBoard.flashIllegal(sq);
  }
  if (piece && piece.color === c.turn()) drillBoard.setSelected(sq);
  else drillBoard.setSelected(null);
};

drillNextBtn.addEventListener('click', nextDrillPosition);
drillStopBtn.addEventListener('click', () => {
  drillQueue = [];
  drillCurrent = null;
  updateDrillCard();
});

$('#root-btn').addEventListener('click', () => { path = []; render(); });
$('#up-btn').addEventListener('click', () => { path = path.slice(0, -1); render(); });
$('#flip-btn').addEventListener('click', () => board.flip());

function currentNode(): TreeNode | null {
  if (!tree) return null;
  return nodeAtPath(tree, path) ?? tree.root;
}

function render() {
  if (!tree) return;
  const node = currentNode();
  if (!node) return;
  board.setFen(node.fen);

  // Breadcrumb
  const crumbs = ['<button class="crumb" data-idx="0">Start</button>'];
  path.forEach((san, i) => {
    crumbs.push(`<span class="crumb-sep">›</span><button class="crumb" data-idx="${i + 1}">${esc(san)}</button>`);
  });
  breadcrumbEl.innerHTML = crumbs.join('');
  breadcrumbEl.querySelectorAll<HTMLButtonElement>('.crumb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx!, 10);
      path = path.slice(0, idx);
      render();
    });
  });

  // Node stats
  const sc = scorePct(node);
  const avgOpp = avgOpponentRating(node);
  const perf = performanceRating(node);
  nodeStatsEl.innerHTML = `
    <div class="stat-card"><span class="big">${node.games}</span><span class="label">Games</span></div>
    <div class="stat-card"><span class="big">${sc}%</span><span class="label">Score</span></div>
    <div class="stat-card"><span class="big pos">${node.wins}</span><span class="label">Wins</span></div>
    <div class="stat-card"><span class="big mid">${node.draws}</span><span class="label">Draws</span></div>
    <div class="stat-card"><span class="big neg">${node.losses}</span><span class="label">Losses</span></div>
    ${avgOpp != null ? `<div class="stat-card"><span class="big">${avgOpp}</span><span class="label">Avg opponent</span></div>` : ''}
    ${perf != null ? `<div class="stat-card"><span class="big">${perf}</span><span class="label">Performance</span></div>` : ''}
  `;

  // Moves from here
  const children = childSummaries(tree, node).filter((c) => c.games >= minGames);
  yourMovesEl.innerHTML = children.length
    ? movesTableHtml(children)
    : `<p class="hint">No branch here reaches at least ${minGames} game(s). ${node.games ? 'Lower the game threshold above to see more.' : 'No games reached this position.'}</p>`;
  yourMovesEl.querySelectorAll<HTMLElement>('.move-row').forEach((row) => {
    row.addEventListener('click', () => {
      path = [...path, row.dataset.san!];
      render();
    });
  });

  renderGamesHere(node);
  debouncedUpdateCandidates();
  debouncedUpdateBookTheory();
  updateUrlForCurrentState();
}

function movesTableHtml(children: ChildSummary[]): string {
  const maxGames = Math.max(...children.map((c) => c.games));
  const rows = children
    .map((c) => {
      const winW = (c.wins / c.games) * 100;
      const drawW = (c.draws / c.games) * 100;
      const lossW = (c.losses / c.games) * 100;
      const barWidth = 40 + (c.games / maxGames) * 60; // relative frequency, floor so thin bars stay visible
      return `<tr class="move-row" data-san="${esc(c.san)}">
        <td><b>${esc(c.san)}</b></td>
        <td class="num">${c.games}</td>
        <td class="num">${c.scorePct}%</td>
        <td class="num">${c.avgOpponentRating ?? '—'}</td>
        <td>
          <div class="score-bar" style="width:${barWidth}%">
            <div class="seg win" style="width:${winW}%"></div>
            <div class="seg draw" style="width:${drawW}%"></div>
            <div class="seg loss" style="width:${lossW}%"></div>
          </div>
        </td>
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Move</th><th class="num">Games</th><th class="num">Score</th><th class="num">Avg Opp</th><th>W/D/L</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Formats a SAN list as a readable move-number-prefixed string, e.g. "1. e4 e5 2. Nf3 Nc6". */
function pgnEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resultToPgnTag(result: Result, trackedColor: Color): string {
  if (result === 'win') return trackedColor === 'w' ? '1-0' : '0-1';
  if (result === 'loss') return trackedColor === 'w' ? '0-1' : '1-0';
  if (result === 'draw') return '1/2-1/2';
  return '*';
}

/** Every game reaching a position, concatenated into one multi-game PGN — headers reconstructed
 *  from what the tree already tracks (opponent, date, link, result relative to the tracked
 *  player) since these games came from parsed PGNs/API fetches that may not have carried full
 *  headers of their own. */
function buildMultiGamePgn(refs: GameRef[], username: string | null, trackedColor: Color): string {
  return refs
    .map((ref) => {
      const you = pgnEscape(username || 'Player');
      const opponent = pgnEscape(ref.opponent || 'Opponent');
      const white = trackedColor === 'w' ? you : opponent;
      const black = trackedColor === 'w' ? opponent : you;
      const resultTag = resultToPgnTag(ref.result, trackedColor);
      const headers = [
        `[Event "OpenFile Opening Explorer"]`,
        `[Date "${pgnEscape(ref.date || '????.??.??')}"]`,
        `[White "${white}"]`,
        `[Black "${black}"]`,
        `[Result "${resultTag}"]`,
      ];
      if (ref.link) headers.push(`[Site "${pgnEscape(ref.link)}"]`);
      const movetext = formatMoves(ref.sans);
      return `${headers.join('\n')}\n\n${movetext}${movetext ? ' ' : ''}${resultTag}\n`;
    })
    .join('\n');
}

function formatMoves(sans: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(sans[i]);
  }
  return parts.join(' ');
}

/** Lists the individual games that reached the current node — opponent, result, date, a link to
 *  the game if the PGN had one, and the full move list on demand. Matches openingtree.com's
 *  per-position games list. */
function renderGamesHere(node: TreeNode) {
  const refs = node.gameRefs;
  gamesHereCountEl.textContent = refs.length ? `(${refs.length})` : '';
  if (!refs.length) {
    gamesHereEl.innerHTML = `<p class="hint">No games reached this position.</p>`;
    return;
  }

  // A different node than last render (moved to a new position in the tree) starts back at
  // page 1; re-rendering the same node for a page-size change or Prev/Next keeps the page.
  const pathKey = path.join('>');
  if (pathKey !== gamesPagePathKey) { gamesPage = 0; gamesPagePathKey = pathKey; }

  const pageSize = gamesPageSize === 'all' ? refs.length : gamesPageSize;
  const totalPages = Math.max(1, Math.ceil(refs.length / pageSize));
  gamesPage = Math.min(gamesPage, totalPages - 1);
  const start = gamesPage * pageSize;
  const shown = refs.slice(start, start + pageSize);

  const resultLabel = (r: Result) => (r === 'win' ? 'Win' : r === 'loss' ? 'Loss' : r === 'draw' ? 'Draw' : '—');
  const resultClass = (r: Result) => (r === 'win' ? 'pos' : r === 'loss' ? 'neg' : r === 'draw' ? 'mid' : '');
  const rows = shown
    .map((g, i) => `
      <tr>
        <td>${esc(g.opponent)}${g.opponentRating != null ? ` <span class="hint">(${g.opponentRating})</span>` : ''}</td>
        <td class="${resultClass(g.result)}">${resultLabel(g.result)}</td>
        <td class="hint">${esc(g.date || '—')}</td>
        <td>${g.link ? `<a href="${esc(g.link)}" target="_blank" rel="noopener">View ↗</a>` : '<span class="hint">—</span>'}</td>
        <td><button class="btn-icon moves-toggle" data-idx="${i}" title="Show moves">☰</button></td>
      </tr>
      <tr class="moves-row" id="moves-row-${i}" hidden>
        <td colspan="5"><div class="game-moves"><p>${esc(formatMoves(g.sans))}</p></div></td>
      </tr>`)
    .join('');

  const pageSizeOptions = [50, 100, 250] as const;
  const pagination = `
    <div class="games-pagination config-row">
      <label>Show
        <select class="games-page-size">
          ${pageSizeOptions.map((n) => `<option value="${n}"${gamesPageSize === n ? ' selected' : ''}>${n}</option>`).join('')}
          <option value="all"${gamesPageSize === 'all' ? ' selected' : ''}>All (${refs.length})</option>
          <option value="download">⬇ Download all ${refs.length} as PGN</option>
        </select>
      </label>
      <button class="btn btn-ghost btn-sm games-prev" ${gamesPage === 0 ? 'disabled' : ''}>◀ Prev</button>
      <span class="hint">Page ${gamesPage + 1} of ${totalPages} · ${refs.length} game${refs.length === 1 ? '' : 's'}</span>
      <button class="btn btn-ghost btn-sm games-next" ${gamesPage >= totalPages - 1 ? 'disabled' : ''}>Next ▶</button>
    </div>`;

  gamesHereEl.innerHTML =
    `${pagination}<table><thead><tr><th>Opponent</th><th>Result</th><th>Date</th><th>Link</th><th></th></tr></thead><tbody>${rows}</tbody></table>${pagination}`;

  gamesHereEl.querySelectorAll<HTMLButtonElement>('.moves-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`moves-row-${btn.dataset.idx}`) as HTMLElement;
      row.hidden = !row.hidden;
    });
  });
  gamesHereEl.querySelectorAll<HTMLSelectElement>('.games-page-size').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (sel.value === 'download') {
        const trackedColor = colorSelect.value as Color;
        const pgn = buildMultiGamePgn(refs, profile.username, trackedColor);
        const safeName = (profile.username || 'games').replace(/[^\w.-]/g, '_').slice(0, 60);
        downloadPgn(`${safeName}_position_games.pgn`, pgn);
        sel.value = gamesPageSize === 'all' ? 'all' : String(gamesPageSize); // not a real page size — snap back
        return;
      }
      gamesPageSize = sel.value === 'all' ? 'all' : parseInt(sel.value, 10);
      gamesPage = 0;
      renderGamesHere(node);
    });
  });
  gamesHereEl.querySelectorAll<HTMLButtonElement>('.games-prev').forEach((btn) => {
    btn.addEventListener('click', () => { gamesPage = Math.max(0, gamesPage - 1); renderGamesHere(node); });
  });
  gamesHereEl.querySelectorAll<HTMLButtonElement>('.games-next').forEach((btn) => {
    btn.addEventListener('click', () => { gamesPage = Math.min(totalPages - 1, gamesPage + 1); renderGamesHere(node); });
  });
}

syncUiToProfile();
void tryLoadFromUrl();
