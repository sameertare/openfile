import './style.css';
import { Chess } from 'chess.js';
import { Board } from './board';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';
import { newCard, isDue, review } from './srs';
import type { SrsCard } from './srs';
import { REPERTOIRES, buildRepertoireTree, collectQuizPoints, nodeAtPath } from './repertoireBook';
import type { RepertoireDef, RepertoireTree, QuizPoint } from './repertoireBook';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- dom ----------
const repertoireSelect = $('#repertoire-select') as HTMLSelectElement;
const repertoireDescription = $('#repertoire-description');
const board = new Board($('#board'));
const linePgnLabel = $('#line-pgn-label');
const linePgnMoves = $('#line-pgn-moves');
const yourMovesEl = $('#your-moves');

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
const drillBoard = new Board($('#drill-board'));

// ---------- state ----------
let currentDef: RepertoireDef = REPERTOIRES[0];
let tree: RepertoireTree = buildRepertoireTree(currentDef);
let path: string[] = [];

repertoireSelect.innerHTML = REPERTOIRES.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
repertoireSelect.addEventListener('change', () => selectRepertoire(repertoireSelect.value));

function selectRepertoire(id: string) {
  const def = REPERTOIRES.find((r) => r.id === id) ?? REPERTOIRES[0];
  currentDef = def;
  tree = buildRepertoireTree(def);
  path = [];
  repertoireDescription.textContent = def.description;
  board.setOrientation(def.color);
  drillBoard.setOrientation(def.color);
  render();
  stopDrill();
  updateDrillCard();
}

function currentNode() {
  return nodeAtPath(tree, path) ?? tree.root;
}

function render() {
  const node = currentNode();
  if (!node) return;
  board.setFen(node.fen);
  renderLinePgnMoves();

  const children = [...node.children.keys()];
  yourMovesEl.innerHTML = children.length
    ? `<div class="btn-row">${children.map((san) => `<button type="button" class="btn move-btn" data-san="${esc(san)}">${esc(san)}</button>`).join('')}</div>`
    : `<p class="hint">End of this line.</p>`;
  yourMovesEl.querySelectorAll<HTMLElement>('.move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      path = [...path, btn.dataset.san!];
      render();
    });
  });
}

function renderLinePgnMoves() {
  if (!path.length) {
    linePgnLabel.hidden = true;
    linePgnMoves.hidden = true;
    linePgnMoves.innerHTML = '';
    return;
  }
  linePgnLabel.hidden = false;
  linePgnMoves.hidden = false;
  const cell = (i: number) => `<span class="lpm-move ${i === path.length - 1 ? 'cur' : ''}" data-idx="${i}">${esc(path[i])}</span>`;
  const emptyCell = '<span class="lpm-move lpm-empty"></span>';
  const rows: string[] = [];
  for (let i = 0; i < path.length; i += 2) {
    const moveNo = i / 2 + 1;
    const white = cell(i);
    const black = i + 1 < path.length ? cell(i + 1) : emptyCell;
    rows.push(`<span class="lpm-num">${moveNo}.</span>${white}${black}`);
  }
  linePgnMoves.innerHTML = rows.join('');
  linePgnMoves.querySelectorAll<HTMLElement>('.lpm-move[data-idx]').forEach((m) => {
    m.addEventListener('click', () => {
      path = path.slice(0, parseInt(m.dataset.idx!, 10) + 1);
      render();
    });
  });
}

board.onSquareClick = (sq) => {
  const node = currentNode();
  if (!node) return;
  const c = new Chess(node.fen);
  const piece = c.get(sq as any);
  const sel = board.getSelected();
  if (sel && sel !== sq) {
    const moves = c.moves({ square: sel as any, verbose: true }) as any[];
    const m = moves.find((x) => x.to === sq);
    board.setSelected(null);
    if (m && node.children.has(m.san)) {
      path = [...path, m.san];
      render();
      return;
    }
    if (m) board.flashIllegal(sq); // a legal chess move, but not in this repertoire's tree
    else if (!(piece && piece.color === c.turn())) board.flashIllegal(sq);
  }
  if (piece && piece.color === c.turn()) board.setSelected(sq);
  else board.setSelected(null);
};

$('#root-btn').addEventListener('click', () => { path = []; render(); });
$('#up-btn').addEventListener('click', () => { path = path.slice(0, -1); render(); });
$('#flip-btn').addEventListener('click', () => board.flip());

// ---------- drill (spaced repetition) ----------
function srsStorageKey(): string {
  return `openfile-srs-trainer:${currentDef.id}`;
}

function loadSrsData(): Record<string, SrsCard> {
  try {
    const raw = localStorage.getItem(srsStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSrsData(data: Record<string, SrsCard>) {
  try {
    localStorage.setItem(srsStorageKey(), JSON.stringify(data));
  } catch {
    // localStorage unavailable/full — drilling still works for this session, just won't persist
  }
}

function pathKey(p: string[]): string {
  return p.join('|');
}

const DRILL_SESSION_CAP = 25;

let srsData: Record<string, SrsCard> = {};
let drillQueue: QuizPoint[] = [];
let drillCurrent: QuizPoint | null = null;
let drillStats = { correct: 0, incorrect: 0 };
let drillAwaitingNext = false;

function updateDrillCard() {
  const quizzable = collectQuizPoints(tree, currentDef.color);
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

drillStartBtn.addEventListener('click', () => {
  const quizzable = collectQuizPoints(tree, currentDef.color);
  srsData = loadSrsData();
  const now = new Date();
  const withDue = quizzable.map((q) => ({ q, card: srsData[pathKey(q.path)] }));
  drillQueue = withDue.filter((x) => !x.card || isDue(x.card, now)).slice(0, DRILL_SESSION_CAP).map((x) => x.q);
  if (!drillQueue.length) {
    // nothing due yet — let a session start anyway so drilling isn't blocked by the schedule
    drillQueue = withDue.slice(0, DRILL_SESSION_CAP).map((x) => x.q);
  }
  drillStats = { correct: 0, incorrect: 0 };
  drillIntro.hidden = true;
  drillSummary.hidden = true;
  drillSession.hidden = false;
  drillBoard.setOrientation(currentDef.color);
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
  drillBoard.setFen(next.fen);
  drillProgress.textContent = `${drillQueue.length + 1} position(s) left this session · ${drillStats.correct} correct, ${drillStats.incorrect} missed so far`;
}

function answerDrill(playedSan: string) {
  if (!drillCurrent || drillAwaitingNext) return;
  drillAwaitingNext = true;
  const node = nodeAtPath(tree, drillCurrent.path);
  const recommended = node ? [...node.children.keys()] : [];
  const correct = recommended.includes(playedSan);
  const key = pathKey(drillCurrent.path);
  const prior = srsData[key] ?? newCard();
  srsData[key] = review(prior, correct);
  saveSrsData(srsData);

  const list = `<ul>${recommended.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  if (correct) {
    drillStats.correct++;
    drillFeedback.className = 'drill-feedback correct';
    drillFeedback.innerHTML = `<b>✓ Correct</b> — ${esc(playedSan)} is the recommended move here.${recommended.length > 1 ? list : ''}`;
  } else {
    drillStats.incorrect++;
    drillFeedback.className = 'drill-feedback incorrect';
    drillFeedback.innerHTML = `<b>✗ Not the book move</b> — you played ${esc(playedSan)}, but this repertoire recommends:${list}`;
    if (drillCurrent) drillQueue.push(drillCurrent); // one more shot later this session, on top of the sooner SRS due date
  }
  drillNextBtn.hidden = false;
}

drillBoard.onSquareClick = (sq) => {
  if (!drillCurrent || drillAwaitingNext) return;
  const fen = drillCurrent.fen;
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

function stopDrill() {
  drillQueue = [];
  drillCurrent = null;
  drillSession.hidden = true;
  drillSummary.hidden = true;
  drillIntro.hidden = false;
}

// ---------- boot ----------
selectRepertoire(currentDef.id);
