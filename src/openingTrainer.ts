import './style.css';
import { Chess } from 'chess.js';
import { Board } from './board';
import { Engine } from './engine';
import type { EngineEval } from './engine';
import { fmtEval, whiteCp } from './engineFormat';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { CATALOG, catalogById } from './openingCatalog';
import type { CatalogOpening } from './openingCatalog';
import { loadBook, buildLines, practiceSans, nameAt, type LineExtension } from './openingBook';
import extensionsJson from './data/lineExtensions.json';
import type { Book, TrainerLine, RawEntry } from './openingBook';
import {
  classifyLoss, lossBetween, emptyStats, lineStatus, openingStatus, recordStart, recordCompletion, addPoints,
  scoreSummary, viewingLabel, pickLine, exportStats, parseStats, todayKey, STATUS_TAG, STATUS_LABEL,
} from './openingTrainerCore';
import type { Stats, Quality } from './openingTrainerCore';
import { PracticeSession } from './practiceSession';
import type { Color, SessionMove } from './practiceSession';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- settings + stats persistence ----------
type Mode = 'practice' | 'play' | 'explore';
type MoveColors = 'always' | 'after' | 'off';
interface Settings {
  mode: Mode;
  openingId: string; // a catalog id, or ANY
  lineId: string;
  side: 'auto' | Color;
  bookArrows: boolean;
  leastStudied: boolean;
  moveColors: MoveColors;
  fadeAfter: number;
  rating: number;
}
const ANY = '__any__';
const SETTINGS_KEY = 'openfile-ot1:settings';
const STATS_KEY = 'openfile-ot1:stats';
const DEFAULTS: Settings = {
  mode: 'practice', openingId: 'italian', lineId: '', side: 'auto', bookArrows: true, leastStudied: false,
  moveColors: 'always', fadeAfter: 2, rating: 1500,
};

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULTS, ...raw };
  } catch { return { ...DEFAULTS }; }
}
function loadStats(): Stats {
  try {
    const parsed = parseStats(localStorage.getItem(STATS_KEY) ?? '');
    return parsed ?? emptyStats();
  } catch { return emptyStats(); }
}
let settings = loadSettings();
let stats = loadStats();
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable — still works this session */ } }
function saveStats() { try { localStorage.setItem(STATS_KEY, exportStats(stats)); } catch { /* ditto */ } }

// ---------- dom + shared objects ----------
const board = new Board($('#ot-board'));
const el = {
  name: $('#ot-name'), opening: $('#ot-opening') as HTMLSelectElement, line: $('#ot-line') as HTMLSelectElement,
  lineRow: $('#ot-line-row'), side: $('#ot-side') as HTMLSelectElement, arrows: $('#ot-arrows') as HTMLInputElement,
  arrowsRow: $('#ot-arrows-row'), least: $('#ot-least') as HTMLInputElement, priority: $('#ot-priority'),
  aboutBody: $('#ot-about-body'), bookMove: $('#ot-book-move'), bookName: $('#ot-book-name'), hint: $('#ot-hint'),
  bookCard: $('#ot-book-card'), evalEl: $('#ot-eval'), turn: $('#ot-turn'), lineTitle: $('#ot-line-title'),
  lineInfo: $('#ot-line-info'), progress: $('#ot-progress'), feedback: $('#ot-feedback'), done: $('#ot-done'),
  doneMsg: $('#ot-done-msg'), moves: $('#ot-moves'), movesLabel: $('#ot-moves-label'),
  continuations: $('#ot-continuations'), back: $('#ot-back') as HTMLButtonElement, fwd: $('#ot-fwd') as HTMLButtonElement,
  progressMsg: $('#ot-progress-msg'),
};

// ---------- library ----------
let book: Book;
const linesCache = new Map<string, TrainerLine[]>();
function linesOf(op: CatalogOpening): TrainerLine[] {
  let l = linesCache.get(op.id);
  if (!l) { l = buildLines(book, op, undefined, extensionsJson as Record<string, LineExtension>); linesCache.set(op.id, l); }
  return l;
}

// ---------- engines ----------
let analysis: Engine | null = null;
let analysisReady: Promise<Engine> | null = null;
function getAnalysis(): Promise<Engine> {
  if (!analysisReady) analysisReady = (async () => { const e = new Engine(); await e.init(); analysis = e; return e; })();
  return analysisReady;
}
let playEngine: Engine | null = null;
let playReady: Promise<Engine> | null = null;
function getPlayEngine(): Promise<Engine> {
  if (!playReady) playReady = (async () => { const e = new Engine(); await e.init(); e.setStrength(settings.rating); playEngine = e; return e; })();
  return playReady;
}

const EVAL_DEPTH = 12;
const evalCache = new Map<string, EngineEval>();
async function evalOf(fen: string): Promise<EngineEval> {
  const key = fen.split(' ').slice(0, 4).join(' ');
  const hit = evalCache.get(key);
  if (hit) return hit;
  const e = await (await getAnalysis()).evaluate(fen, EVAL_DEPTH);
  evalCache.set(key, e);
  return e;
}

/** Quality of the move that took `before` to `after`, from the mover's side: how much worse the
 *  result is than the engine's best from `before`. */
async function gradeMove(before: string, after: string): Promise<Quality> {
  if (new Chess(after).isCheckmate()) return 'good';
  const [b, a] = await Promise.all([evalOf(before), evalOf(after)]);
  return classifyLoss(lossBetween(b.cp, -a.cp));
}

// ---------- state ----------
interface ViewMove { san: string; fen: string; from: string; to: string; by: 'user' | 'book' | 'engine'; quality?: Quality }
let currentLine: TrainerLine | null = null;
let currentOpening: CatalogOpening = catalogById('italian')!;
let userColor: Color = 'w';
let session: PracticeSession | null = null; // practice mode
let free: Chess | null = null; // play / explore mode board
let freeHistory: ViewMove[] = [];
let inBook = false; // play mode: engine is still following the book
let bookSans: string[] = [];
let gameOver = '';
let viewIdx: number | null = null; // null = live position, else index into the history (0 = start)
let busy = false;
let feedback: { kind: 'ok' | 'bad' | 'info'; text: string } | null = null;
let wrongPreview: { fen: string; from: string; to: string; quality?: Quality } | null = null;
let doneInfo: string | null = null;
let token = 0; // bumps whenever the position/line changes, so stale async work discards itself

const START_FEN = new Chess().fen();

function history(): ViewMove[] {
  if (session) return session.history.map((m) => ({ ...m }));
  return freeHistory;
}
function sansPlayed(): string[] { return history().map((m) => m.san); }
function liveFen(): string { return session ? session.fen : free ? free.fen() : START_FEN; }
function shownFen(): string {
  if (wrongPreview) return wrongPreview.fen;
  const h = history();
  if (viewIdx === null || viewIdx >= h.length) return liveFen();
  return viewIdx === 0 ? START_FEN : h[viewIdx - 1].fen;
}
function isLive(): boolean { return viewIdx === null || viewIdx >= history().length; }

// ---------- opening/line selection ----------
function siblingsOf(line: TrainerLine): TrainerLine[] { return linesOf(catalogById(line.openingId)!); }
function sidesFor(op: CatalogOpening): Color { return settings.side === 'auto' ? op.side : settings.side; }

function selectLine(line: TrainerLine, opts: { countView: boolean } = { countView: true }) {
  token++;
  currentLine = line;
  currentOpening = catalogById(line.openingId)!;
  settings.lineId = line.id;
  if (settings.openingId !== ANY) settings.openingId = currentOpening.id;
  saveSettings();
  userColor = sidesFor(currentOpening);
  board.setOrientation(userColor);
  viewIdx = null; wrongPreview = null; feedback = null; doneInfo = null; busy = false; gameOver = '';
  session = null; free = null; freeHistory = []; inBook = false;

  if (settings.mode === 'practice') {
    const sans = practiceSans(line);
    if (opts.countView) { recordStart(stats, line.id, todayKey()); saveStats(); }
    const viewing = Math.max(1, stats.lines[line.id]?.views ?? 1);
    session = new PracticeSession(sans, userColor, viewing, settings.fadeAfter);
    if (!session.isUserTurn()) scheduleOpponent();
  } else {
    free = new Chess();
    bookSans = line.sans;
    inBook = true;
    if (settings.mode === 'play' && free.turn() !== userColor) scheduleEngineMove();
  }
  renderAll();
}

function pickAndStart(opts: { sameOpening: boolean }) {
  const ops = opts.sameOpening || settings.openingId !== ANY ? [currentOpening] : CATALOG;
  const candidates = ops.flatMap((op) => linesOf(op).map((l) => ({ lineId: l.id, openingId: op.id })));
  const pick = pickLine(candidates, stats, { leastStudiedFirst: settings.leastStudied, exclude: currentLine?.id });
  if (!pick) return;
  const op = catalogById(pick.openingId)!;
  selectLine(linesOf(op).find((l) => l.id === pick.lineId)!);
}

// ---------- practice flow ----------
function scheduleOpponent() {
  const t = token;
  busy = true;
  setTimeout(() => {
    if (t !== token || !session) return;
    const before = session.fen;
    const mv = session.opponentReply();
    busy = false;
    if (mv) gradeAsync(mv, before, t);
    if (session.done) finishLine();
    renderAll();
  }, 380);
}

function gradeAsync(mv: SessionMove | ViewMove, before: string, t: number) {
  gradeMove(before, mv.fen).then((q) => {
    if (t !== token) return;
    mv.quality = q;
    // history() copies session moves, so write the grade back onto the session's own record too.
    if (session) { const own = session.history.find((m) => m.fen === mv.fen && m.san === mv.san); if (own) own.quality = q; }
    renderAll();
  }).catch(() => { /* engine unavailable — moves just stay ungraded */ });
}

function handlePracticeMove(from: string, to: string) {
  const s = session!;
  if (busy || !s.isUserTurn() || !isLive()) return;
  const san = s.legalMove(from, to);
  if (!san) { board.flashIllegal(to); return; }
  const before = s.fen;
  const res = s.attempt(san);
  const t = token;
  if (res.ok) {
    feedback = { kind: 'ok', text: res.points ? `✓ Book move · +${res.points}` : '✓ Book move' };
    addPoints(stats, todayKey(), res.points); // points tick up move by move; the clean-run bonus lands at the end
    saveStats();
    gradeAsync(res.move, before, t);
    if (s.done) finishLine(); else scheduleOpponent();
    renderAll();
    return;
  }
  // Not the book move: show it briefly with its engine grade, say what the book plays, then put it back.
  const probe = new Chess(before);
  const m = probe.move(san);
  wrongPreview = { fen: probe.fen(), from: m.from, to: m.to };
  feedback = { kind: 'bad', text: `Not the book move — the book plays ${res.expected}.` };
  busy = true;
  renderAll();
  gradeMove(before, probe.fen()).then((q) => { if (t === token && wrongPreview) { wrongPreview.quality = q; renderAll(); } }).catch(() => {});
  setTimeout(() => {
    if (t !== token) return;
    wrongPreview = null; busy = false;
    renderAll();
  }, 1400);
}

function finishLine() {
  const s = session!;
  const line = currentLine!;
  const bonus = s.completionBonus();
  const total = s.points + bonus;
  addPoints(stats, todayKey(), bonus);
  recordCompletion(stats, line.id, s.isClean(), s.fromMemory, todayKey());
  saveStats();
  const status = STATUS_LABEL[lineStatus(stats.lines[line.id])];
  doneInfo = s.isClean()
    ? `✓ Line complete — no mistakes${bonus ? ` (+${bonus} bonus)` : ''}. +${total} points. This line is now: ${status}.`
    : `Line complete with ${s.mistakes} slip${s.mistakes === 1 ? '' : 's'}. +${total} points. This line is: ${status}.`;
}

// ---------- play / explore flow ----------
function handleFreeMove(from: string, to: string) {
  if (!free || busy || !isLive() || gameOver) return;
  if (settings.mode === 'play' && free.turn() !== userColor) return;
  const before = free.fen();
  let m;
  try { m = free.move({ from, to, promotion: 'q' }); } catch { board.flashIllegal(to); return; }
  const mv: ViewMove = { san: m.san, fen: free.fen(), from: m.from, to: m.to, by: 'user' };
  freeHistory.push(mv);
  const t = token;
  if (inBook && bookSans[freeHistory.length - 1] !== m.san) inBook = false;
  gradeAsync(mv, before, t);
  checkGameOver();
  if (settings.mode === 'play' && !gameOver) scheduleEngineMove();
  renderAll();
}

function checkGameOver() {
  if (!free) return;
  if (free.isCheckmate()) gameOver = `Checkmate — ${free.turn() === 'w' ? 'Black' : 'White'} wins.`;
  else if (free.isStalemate()) gameOver = 'Stalemate.';
  else if (free.isDraw()) gameOver = 'Draw.';
}

function scheduleEngineMove() {
  if (!free || gameOver) return;
  const t = token;
  busy = true;
  renderAll();
  (async () => {
    const ply = freeHistory.length;
    let san: string | null = null;
    if (inBook && ply < bookSans.length) {
      san = bookSans[ply];
      await new Promise((r) => setTimeout(r, 380));
    } else {
      inBook = false;
      const eng = await getPlayEngine();
      const res = await eng.evaluate(free!.fen(), 10);
      if (res.bestmove) {
        const probe = new Chess(free!.fen());
        san = probe.move({ from: res.bestmove.slice(0, 2), to: res.bestmove.slice(2, 4), promotion: res.bestmove.slice(4) || undefined }).san;
      }
    }
    if (t !== token || !free) return;
    busy = false;
    if (!san) { renderAll(); return; }
    const before = free.fen();
    const m = free.move(san);
    const mv: ViewMove = { san: m.san, fen: free.fen(), from: m.from, to: m.to, by: inBook ? 'book' : 'engine' };
    freeHistory.push(mv);
    gradeAsync(mv, before, t);
    checkGameOver();
    renderAll();
  })().catch(() => { busy = false; renderAll(); });
}

/** Explore: the next moves the library knows from here (within this opening's root), with names. */
function continuationsHere(): { san: string; count: number; name: string }[] {
  const played = sansPlayed();
  const root = currentOpening.root.split(' ');
  const counts = new Map<string, { count: number; name: string; len: number }>();
  for (const e of book.entries) {
    // Must be consistent with the root, and with the moves played so far.
    const n = Math.min(root.length, e.sans.length);
    let ok = true;
    for (let i = 0; i < n; i++) if (e.sans[i] !== root[i]) { ok = false; break; }
    if (!ok || e.sans.length <= played.length) continue;
    for (let i = 0; i < played.length; i++) if (e.sans[i] !== played[i]) { ok = false; break; }
    if (!ok) continue;
    const next = e.sans[played.length];
    const cur = counts.get(next);
    if (!cur) counts.set(next, { count: 1, name: e.name, len: e.sans.length });
    else { cur.count++; if (e.sans.length < cur.len) { cur.len = e.sans.length; cur.name = e.name; } }
  }
  return [...counts.entries()].map(([san, v]) => ({ san, count: v.count, name: v.name })).sort((a, b) => b.count - a.count).slice(0, 10);
}

// ---------- board input ----------
board.onSquareClick = (sq) => {
  const fen = shownFen();
  if (!isLive()) return;
  const c = new Chess(fen);
  const piece = c.get(sq as any);
  const sel = board.getSelected();
  if (sel && sel !== sq) {
    board.setSelected(null);
    const legal = (c.moves({ square: sel as any, verbose: true }) as any[]).some((m) => m.to === sq);
    if (legal) { session ? handlePracticeMove(sel, sq) : handleFreeMove(sel, sq); return; }
    if (!(piece && piece.color === c.turn())) board.flashIllegal(sq);
  }
  const mine = session ? session.isUserTurn() : free ? (settings.mode === 'explore' || c.turn() === userColor) : false;
  if (mine && piece && piece.color === c.turn()) board.setSelected(sq);
  else board.setSelected(null);
};

// ---------- rendering ----------
const QUALITY_CLASS: Record<Quality, string> = { good: 'q-good', inaccurate: 'q-inaccurate', mistake: 'q-mistake', blunder: 'q-blunder' };
const LIST_CLASS: Record<Quality, string> = { good: 'm-best', inaccurate: 'm-inacc', mistake: 'm-mistake', blunder: 'm-blunder' };

function sideName(c: Color) { return c === 'w' ? 'White' : 'Black'; }
function moveNo(plyIdx: number, san: string) {
  return plyIdx % 2 === 0 ? `${plyIdx / 2 + 1}.${san}` : `${(plyIdx - 1) / 2 + 1}...${san}`;
}

function renderBoard() {
  const h = history();
  const fen = shownFen();
  board.setFen(fen);
  // last-move + quality marks
  const marks: Record<string, string> = {};
  let last: [string, string] | null = null;
  const viewed = wrongPreview ? wrongPreview : (viewIdx === null || viewIdx >= h.length ? h[h.length - 1] : viewIdx > 0 ? h[viewIdx - 1] : undefined);
  if (viewed) {
    last = [viewed.from, viewed.to];
    const q = (viewed as any).quality as Quality | undefined;
    const showColor = settings.moveColors === 'always' || (settings.moveColors === 'after' && (wrongPreview || (isLive() && h.length && viewed === h[h.length - 1])));
    if (q && showColor) { marks[viewed.from] = QUALITY_CLASS[q]; marks[viewed.to] = QUALITY_CLASS[q]; }
  }
  board.setLastMove(last);
  board.setMarks(marks);
  // arrows
  const arrows: { from: string; to: string; rank: 4 }[] = [];
  if (isLive() && !wrongPreview) {
    if (session && session.isUserTurn() && settings.bookArrows && session.arrowShown()) {
      const sq = session.expectedSquares();
      if (sq) arrows.push({ ...sq, rank: 4 });
    } else if (free && settings.mode === 'play' && inBook && settings.bookArrows && free.turn() === userColor && freeHistory.length < bookSans.length) {
      const probe = new Chess(free.fen());
      try { const m = probe.move(bookSans[freeHistory.length]); arrows.push({ from: m.from, to: m.to, rank: 4 }); } catch { /* line no longer applies */ }
    }
  }
  if (session && session.isUserTurn() && feedback?.kind === 'bad' && !wrongPreview) {
    const sq = session.expectedSquares();
    if (sq) arrows.splice(0, arrows.length, { ...sq, rank: 4 });
  }
  board.setArrows(arrows);
  board.setSelected(null);
}

function renderMoves() {
  const h = history();
  const colored = settings.moveColors === 'always';
  const cell = (i: number) => {
    const m = h[i];
    const cls = ['lpm-move'];
    if (colored && m.quality) cls.push(LIST_CLASS[m.quality]);
    const cur = viewIdx === null ? i === h.length - 1 : i === viewIdx - 1;
    if (cur) cls.push('cur');
    return `<span class="${cls.join(' ')}" data-i="${i}">${esc(m.san)}</span>`;
  };
  if (!h.length) {
    el.moves.innerHTML = '<div class="live-pgn-empty hint">No moves yet.</div>';
    return;
  }
  const rows: string[] = [];
  for (let i = 0; i < h.length; i += 2) {
    rows.push(`<span class="lpm-num">${i / 2 + 1}.</span>${cell(i)}${i + 1 < h.length ? cell(i + 1) : '<span class="lpm-move lpm-empty"></span>'}`);
  }
  el.moves.innerHTML = rows.join('');
  el.moves.querySelectorAll<HTMLElement>('.lpm-move[data-i]').forEach((n) => n.addEventListener('click', () => {
    viewIdx = parseInt(n.dataset.i!, 10) + 1;
    renderAll();
  }));
}

async function renderEval() {
  const fen = shownFen();
  const t = token;
  try {
    const e = await evalOf(fen);
    if (t !== token || fen !== shownFen()) return;
    const stmWhite = fen.split(' ')[1] === 'w';
    if (e.mateIn !== null) {
      const whiteMates = stmWhite ? e.mateIn > 0 : e.mateIn < 0;
      el.evalEl.textContent = `${whiteMates ? 'White' : 'Black'} mates in ${Math.abs(e.mateIn)}`;
      return;
    }
    const wc = whiteCp(fen, e.cp);
    const txt = fmtEval(wc, null, stmWhite);
    el.evalEl.textContent = `${wc >= 0 ? 'White' : 'Black'} ${wc >= 0 ? txt : txt.replace('-', '+')}`;
  } catch { el.evalEl.textContent = '—'; }
}

function turnText(): string {
  const fen = shownFen();
  const turn = fen.split(' ')[1] as Color;
  if (gameOver) return gameOver;
  const who = settings.mode === 'explore' ? '' : turn === userColor ? ' (you)' : ' (engine)';
  return `${sideName(turn)} to move${who}`;
}

function bookMoveText(): { text: string; name: string; showHint: boolean } {
  if (!session) {
    const exp = free && inBook && freeHistory.length < bookSans.length ? bookSans[freeHistory.length] : null;
    return { text: settings.mode === 'explore' ? '—' : exp ? `${moveNo(freeHistory.length, exp)}` : 'out of book', name: '', showHint: false };
  }
  if (session.done) return { text: '—', name: '', showHint: false };
  const exp = session.expected()!;
  const mine = session.isUserTurn();
  const shown = mine ? session.arrowShown() : true;
  if (mine && !shown) return { text: '?', name: 'Arrow faded — recall it from memory.', showHint: true };
  const nm = nameAt(book, [...session.history.map((m) => m.san), exp])?.name ?? '';
  return { text: moveNo(session.ply, exp), name: nm, showHint: false };
}

function renderCards() {
  const sc = scoreSummary(stats, todayKey());
  $('#ot-score-today').textContent = String(sc.today);
  $('#ot-score-best').textContent = String(sc.bestDay);
  $('#ot-score-all').textContent = String(sc.allTime);
  $('#ot-score-days').textContent = String(sc.daysPracticed);

  const nm = nameAt(book, sansPlayed());
  el.name.textContent = nm ? nm.name : 'Starting position';

  const bm = bookMoveText();
  el.bookMove.textContent = bm.text;
  el.bookName.textContent = bm.name;
  (el.hint as HTMLElement).hidden = !bm.showHint;
  el.turn.textContent = turnText();

  const line = currentLine;
  const explore = settings.mode === 'explore';
  el.lineTitle.textContent = explore ? currentOpening.name : line ? line.label : '—';
  if (session && line) {
    const full = Math.ceil(line.sans.length / 2);
    const used = Math.ceil(session.sans.length / 2);
    el.lineInfo.textContent = `${used} move${used === 1 ? '' : 's'} (of ${full} in the full line) · you play ${sideName(userColor)}. The engine plays the book moves for the other side.`;
    el.progress.textContent = `Move ${session.ply}/${session.sans.length} · ${viewingLabel(session.viewing, session.fadeAfter)}`;
  } else if (settings.mode === 'play') {
    el.lineInfo.textContent = `You play ${sideName(userColor)} against Stockfish (~${settings.rating}). The engine follows the book line while you do, then plays on its own.`;
    el.progress.textContent = inBook ? 'Still in book.' : 'Out of book — you are on your own.';
  } else {
    el.lineInfo.textContent = `Move freely and see which book continuations the library knows from each position.`;
    el.progress.textContent = '';
  }

  (el.feedback as HTMLElement).hidden = !feedback;
  if (feedback) { el.feedback.className = `ot-feedback ot-fb-${feedback.kind}`; el.feedback.textContent = feedback.text; }
  (el.done as HTMLElement).hidden = !doneInfo;
  if (doneInfo) el.doneMsg.textContent = doneInfo;

  const conts = $('#ot-continuations');
  conts.hidden = !explore;
  $('#ot-moves-label').textContent = explore ? 'Moves' : 'Moves';
  if (explore) {
    const list = continuationsHere();
    conts.innerHTML = `<div class="ot-card-label" style="margin:12px 0 6px;">Book continuations</div>` +
      (list.length
        ? `<div class="ot-cont-list">${list.map((c) => `<button type="button" class="btn btn-sm ot-cont" data-san="${esc(c.san)}" title="${esc(c.name)}">${esc(c.san)} <span class="hint">${esc(c.name)}</span></button>`).join('')}</div>`
        : '<p class="hint">No further book moves from here within this opening.</p>');
    conts.querySelectorAll<HTMLElement>('.ot-cont').forEach((b) => b.addEventListener('click', () => playBookSan(b.dataset.san!)));
  }

  el.back.disabled = history().length === 0 || viewIdx === 0;
  el.fwd.disabled = isLive();
  (el.arrowsRow as HTMLElement).hidden = explore;
  el.priority.classList.toggle('active', !!stats.priority[currentOpening.id]);
  el.priority.textContent = stats.priority[currentOpening.id] ? '⚑ Priority ✓' : '⚑ Priority';
}

function playBookSan(san: string) {
  if (!free || !isLive() || gameOver) return;
  const probe = new Chess(free.fen());
  let m; try { m = probe.move(san); } catch { return; }
  handleFreeMove(m.from, m.to);
}

function renderAbout() {
  const op = currentOpening;
  const lines = linesOf(op);
  const root = op.root.split(' ');
  const rootText = root.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(' ');
  const rows = lines.map((l) => {
    const st = lineStatus(stats.lines[l.id]);
    const cut = practiceSans(l).length;
    return `<li><span title="${STATUS_LABEL[st]}">${STATUS_TAG[st]}</span> ${esc(l.label)} <span class="hint">· ${Math.ceil(cut / 2)} moves practiced of ${Math.ceil(l.sans.length / 2)}</span></li>`;
  }).join('');
  el.aboutBody.innerHTML = `<p><b>${esc(op.name)}</b> — ${sideName(op.side)}'s opening${op.traps ? ' (trap-heavy)' : ''}. Defining moves: <code>${esc(rootText)}</code></p>` +
    `<p class="hint">${lines.length} line${lines.length === 1 ? '' : 's'} to learn, built from the named variations in the lichess opening library.</p><ul class="ot-about-lines">${rows}</ul>`;
}

function fillPickers() {
  const opts = [`<option value="${ANY}">🎲 Any opening (priority-weighted)</option>`].concat(
    CATALOG.map((o) => {
      const st = openingStatus(linesOf(o).map((l) => l.id), stats);
      return `<option value="${o.id}">${STATUS_TAG[st]} ${esc(o.name)} (${o.side === 'w' ? 'White' : 'Black'})${o.traps ? ' · traps' : ''}</option>`;
    })
  );
  el.opening.innerHTML = opts.join('');
  el.opening.value = settings.openingId;
  const lines = linesOf(currentOpening);
  el.line.innerHTML = lines.map((l) => `<option value="${esc(l.id)}">${STATUS_TAG[lineStatus(stats.lines[l.id])]} ${esc(l.label)}</option>`).join('');
  if (currentLine) el.line.value = currentLine.id;
}

function renderSettingsUi() {
  document.querySelectorAll<HTMLElement>('#ot-mode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
  document.querySelectorAll<HTMLElement>('#ot-colors .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.colors === settings.moveColors));
  el.side.value = settings.side;
  el.arrows.checked = settings.bookArrows;
  el.least.checked = settings.leastStudied;
  ($('#ot-fade') as HTMLSelectElement).value = String(settings.fadeAfter);
  ($('#ot-rating') as HTMLInputElement).value = String(settings.rating);
  $('#ot-rating-label').textContent = String(settings.rating);
  (el.lineRow as HTMLElement).hidden = settings.mode === 'explore';
}

function renderAll() {
  renderSettingsUi();
  fillPickers();
  renderAbout();
  renderBoard();
  renderMoves();
  renderCards();
  void renderEval();
}

// ---------- controls ----------
function restartLine(countView = true) {
  if (currentLine) selectLine(currentLine, { countView });
}

document.querySelectorAll<HTMLElement>('#ot-mode .seg-btn').forEach((b) => b.addEventListener('click', () => {
  settings.mode = b.dataset.mode as Mode;
  saveSettings();
  restartLine(false);
}));
document.querySelectorAll<HTMLElement>('#ot-colors .seg-btn').forEach((b) => b.addEventListener('click', () => {
  settings.moveColors = b.dataset.colors as MoveColors; saveSettings(); renderAll();
}));
el.opening.addEventListener('change', () => {
  settings.openingId = el.opening.value;
  saveSettings();
  if (settings.openingId === ANY) { pickAndStart({ sameOpening: false }); return; }
  const op = catalogById(settings.openingId)!;
  const lines = linesOf(op);
  const pick = pickLine(lines.map((l) => ({ lineId: l.id, openingId: op.id })), stats, { leastStudiedFirst: settings.leastStudied });
  selectLine(lines.find((l) => l.id === pick!.lineId) ?? lines[0]);
});
el.line.addEventListener('change', () => {
  const l = linesOf(currentOpening).find((x) => x.id === el.line.value);
  if (l) selectLine(l);
});
el.side.addEventListener('change', () => { settings.side = el.side.value as Settings['side']; saveSettings(); restartLine(false); });
el.arrows.addEventListener('change', () => { settings.bookArrows = el.arrows.checked; saveSettings(); renderAll(); });
el.least.addEventListener('change', () => { settings.leastStudied = el.least.checked; saveSettings(); });
el.priority.addEventListener('click', () => {
  if (stats.priority[currentOpening.id]) delete stats.priority[currentOpening.id]; else stats.priority[currentOpening.id] = true;
  saveStats(); renderAll();
});
el.hint.addEventListener('click', () => { session?.requestHint(); renderAll(); });

$('#ot-fade').addEventListener('change', () => {
  settings.fadeAfter = parseInt(($('#ot-fade') as HTMLSelectElement).value, 10);
  saveSettings();
  if (settings.mode === 'practice' && session && session.ply <= 1) restartLine(false); else renderAll();
});
$('#ot-rating').addEventListener('input', () => {
  settings.rating = parseInt(($('#ot-rating') as HTMLInputElement).value, 10);
  $('#ot-rating-label').textContent = String(settings.rating);
  saveSettings();
  playEngine?.setStrength(settings.rating);
});

$('#ot-back').addEventListener('click', () => {
  const n = history().length;
  if (!n) return;
  viewIdx = viewIdx === null ? n - 1 : Math.max(0, viewIdx - 1);
  renderAll();
});
$('#ot-fwd').addEventListener('click', () => {
  const n = history().length;
  if (viewIdx === null) return;
  viewIdx = viewIdx + 1 >= n ? null : viewIdx + 1;
  renderAll();
});
$('#ot-flip').addEventListener('click', () => { board.flip(); renderBoard(); });
$('#ot-restart').addEventListener('click', () => restartLine(true));
$('#ot-next-line').addEventListener('click', () => pickAndStart({ sameOpening: true }));
$('#ot-next-opening').addEventListener('click', () => pickAndStart({ sameOpening: false }));

// progress: export / import / reset
$('#ot-export').addEventListener('click', () => {
  const blob = new Blob([exportStats(stats)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `opening-trainer-progress-${todayKey()}.json`; a.click();
  URL.revokeObjectURL(url);
  el.progressMsg.textContent = 'Progress exported.';
});
($('#ot-import-file') as HTMLInputElement).addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const parsed = parseStats(await f.text());
  if (!parsed) { el.progressMsg.textContent = 'Could not read that file — it is not an Opening Trainer progress export.'; return; }
  stats = parsed; saveStats(); renderAll();
  el.progressMsg.textContent = 'Progress imported.';
});
$('#ot-reset').addEventListener('click', () => { ($('#ot-reset-sheet') as HTMLElement).hidden = false; });
$('#ot-reset-cancel').addEventListener('click', () => { ($('#ot-reset-sheet') as HTMLElement).hidden = true; });
function resetDone(msg: string) { ($('#ot-reset-sheet') as HTMLElement).hidden = true; saveStats(); renderAll(); el.progressMsg.textContent = msg; }
$('#ot-reset-line').addEventListener('click', () => { if (currentLine) delete stats.lines[currentLine.id]; resetDone('This line was reset.'); });
$('#ot-reset-opening').addEventListener('click', () => {
  for (const l of linesOf(currentOpening)) delete stats.lines[l.id];
  delete stats.priority[currentOpening.id];
  resetDone('This opening was reset.');
});
$('#ot-reset-all').addEventListener('click', () => { stats = emptyStats(); resetDone('All progress was reset.'); });

// ---------- boot ----------
(async function boot() {
  el.lineTitle.textContent = 'Loading the opening library…';
  const data = (await import('./data/openings.json')).default as unknown as { entries: RawEntry[] };
  book = loadBook(data.entries);
  const op = catalogById(settings.openingId) ?? catalogById('italian')!;
  currentOpening = op;
  const lines = linesOf(op);
  const saved = lines.find((l) => l.id === settings.lineId);
  if (settings.openingId !== ANY && !catalogById(settings.openingId)) settings.openingId = 'italian';
  if (settings.openingId === ANY) { pickAndStart({ sameOpening: false }); return; }
  selectLine(saved ?? lines[0]);
})();
