import './style.css';
import type { ParsedGame } from './pgn';
import type { GameRecord } from './types';
import { analyzeGame } from './analyze';
import { aggregate, scorePct as aggScorePct } from './aggregate';
import type { WDL, OpeningRow } from './aggregate';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const emptyState = $('#empty-state');
const reportCard = $('#report-card');
const reportTitle = $('#report-title');
const reportBody = $('#report-body');

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------- handoff from Opening Explorer ----------
// This page has no load UI of its own — Opening Explorer stashes the currently-loaded profile here
// (sessionStorage, one-time) right before navigating over, the same handoff pattern already used
// for surviving the Lichess OAuth redirect (see openingExplorer.ts). Read once on load; a reload of
// this page after the key is already consumed just shows the empty state again, which is correct —
// there's no "current" profile to re-derive without going back through Opening Explorer.
const HANDOFF_KEY = 'openfile-scouting-handoff';
interface ScoutingHandoff { username: string; matchKeys: string[]; parsedGames: ParsedGame[] }

function readHandoff(): ScoutingHandoff | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  sessionStorage.removeItem(HANDOFF_KEY);
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.username !== 'string' || !Array.isArray(data.matchKeys) || !Array.isArray(data.parsedGames)) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- report building (same logic Opening Explorer's scouting report used) ----------
// Openings/results/time-control only, deliberately no engine pass — analyzeGame() with depth 0 and
// no engine skips move-quality analysis entirely (evalSource stays 'none') but still computes
// opening identification, result, color, and time-class synchronously from the PGN headers alone,
// which is exactly what a scouting report needs and fast enough for a full account's worth of
// games. aggregate()'s accuracy/phase/tactics/pattern numbers are meaningless without evals, so
// only the sections that don't depend on them are rendered.
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

async function renderReport(handoff: ScoutingHandoff) {
  emptyState.hidden = true;
  reportCard.hidden = false;
  reportTitle.textContent = `Report for ${handoff.username}`;
  reportBody.innerHTML = `<p class="hint">Building scouting report for ${handoff.parsedGames.length} game(s)…</p>`;

  const matchKeys = new Set(handoff.matchKeys);
  const records: GameRecord[] = [];
  for (const game of handoff.parsedGames) {
    try {
      records.push(await analyzeGame(game, { username: handoff.username, matchKeys, depth: 0, engine: null }));
    } catch {
      // Skip a game that fails to analyze rather than aborting the whole report over one bad game.
    }
  }

  const a = aggregate(records);
  const unfinished = records.length - a.total.games;
  reportBody.innerHTML = `
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

const handoff = readHandoff();
if (handoff) void renderReport(handoff);
else emptyState.hidden = false;
