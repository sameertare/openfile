import './style.css';
import {
  commitRound, createTournament, estimatedCurrentRating,
  nextRoundNumber, pairNextRound,
  parseRoster, recommendedRoundsRoundRobin, redoLatestRound,
  setResult, swapByeWithPlayer, swapColors, swapPlayersAcrossBoards,
} from './swissEngine';
import type { GameResult, Round, Tournament } from './swissEngine';
import { standingsTableHtml, wallChartHtml } from './swissViews';
import { splitIntoQuads } from './quadsSplit';
import { downloadTrf } from './trfExport';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
// Same storage key as Swiss Pairings / NWChess Pairings on purpose — this page is a third
// front-door onto the same single active event/tournament the app only ever holds one of at a
// time. A quads event created here can equally be viewed/managed from swiss.html or
// nwchess-pairings.html afterward (each quad shows up as one of that page's "sections"), and
// wallchart-display.html already reads this key too, so it works with quads with no changes there.
const STORE_KEY = 'openfile-swiss';

/** An event holds one round-robin Tournament per quad; all quads advance round-by-round together. */
interface QuadsEvent { name: string; sections: Tournament[]; active: number; }
let ev: QuadsEvent | null = null;

function cur(): Tournament | null { return ev ? ev.sections[ev.active] : null; }

// Every mutating handler in this file follows `mutate(); save(); render...()` — if setItem throws
// (storage quota exceeded after many rounds/quads, or Safari private browsing where it always
// throws) an uncaught exception here would silently abort the rest of that handler, skipping the
// render calls that follow. The in-memory `ev` mutation already happened, so the UI would show the
// change as if it worked while nothing was actually persisted — and a page refresh loses it with no
// warning. Catch it, keep rendering working, and tell the TD once rather than failing silently.
let saveWarningShown = false;
function save() {
  if (!ev) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ev));
  } catch (e) {
    console.error('Failed to save tournament to localStorage', e);
    if (!saveWarningShown) {
      saveWarningShown = true;
      const banner = document.createElement('div');
      banner.className = 'format-warning';
      banner.style.margin = '0 0 14px';
      banner.textContent = '⚠ Could not save your changes to this browser (storage may be full, or private/incognito browsing blocks it) — edits will be lost on refresh until this is resolved.';
      document.querySelector('#app')?.prepend(banner);
    }
  }
}

// A cheap structural check on imported/loaded data — catches the common cases (a hand-edited or
// wrong-schema file missing a field every render function assumes is an array) before it's ever
// assigned to `ev` or persisted. Not exhaustive on its own; the import handler backs it with an
// actual render-and-rollback, and boot wraps its initial render too, so neither path can leave the
// app permanently stuck on a shape this check didn't anticipate.
function isValidTournament(t: any): t is Tournament {
  if (!(!!t && typeof t === 'object' &&
    typeof t.name === 'string' &&
    Array.isArray(t.players) &&
    Array.isArray(t.rounds) &&
    Array.isArray(t.familyGroups) &&
    typeof t.totalRounds === 'number')) return false;
  const ids = new Set<number>();
  for (const p of t.players) {
    if (typeof p?.id !== 'number' || !Number.isFinite(p.id) || ids.has(p.id)) return false;
    ids.add(p.id);
  }
  return true;
}
function isValidEvent(data: any): data is QuadsEvent {
  return !!data && typeof data === 'object' && Array.isArray(data.sections) && data.sections.every(isValidTournament);
}

/** Which bye row (if any) currently has its "add extra game" form open — transient UI state, not
 *  saved. */
let addingExtraFor: { round: number; byeId: number } | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
/** Name with rating in brackets, e.g. "Ava Thompson (1580)" — "(unrated)" when there's none. When
 *  `showEstimate` is true and the player has actual result history this event, also appends a
 *  second bracket with a lightweight running rating estimate reflecting results so far — purely
 *  informational, never used for pairing/seeding. */
function nameWithRatingOf(t: Tournament, id: number | null, showEstimate = false): string {
  if (id == null) return '—';
  const p = t.players.find((p) => p.id === id);
  if (!p) return '—';
  const base = `${p.name} (${p.rating ?? 'unrated'})`;
  if (!showEstimate) return base;
  const est = estimatedCurrentRating(t, id);
  return est != null && est !== p.rating ? `${base} [~${est}]` : base;
}

// ---------- setup ----------
const SAMPLE_NWCHESS = {
  tname: 'Spring Quads',
  text: `" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"
"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"
"Open","Smith","Alice","6","Sample ES","1850","SMP001A","1820","30000001","01/2027","0","0","","","","Paid"
"Open","Jones","Bob","7","Sample MS","1790","SMP002B","1760","30000002","01/2027","0","0","","","","Paid"
"Open","Chen","Cara","5","Sample ES","1740","SMP003C","1700","30000003","01/2027","0","0","","","","Paid"
"Open","Lee","Dan","8","Sample MS","1680","SMP004D","1650","30000004","01/2027","0","0","","","","Paid"
"Open","Kim","Eve","6","Sample ES","1520","SMP005E","1500","30000005","01/2027","0","0","","","","Paid"
"Open","Park","Zoe","7","Sample MS","1470","SMP006Z","1440","30000006","01/2027","0","0","","","","Paid"
"Open","Diaz","Sam","5","Sample ES","1390","SMP007S","1360","30000007","01/2027","0","0","","","","Paid"
"Open","Wong","Ivy","8","Sample MS","1310","SMP008I","1280","30000008","01/2027","0","0","","","","Paid"
"Open","Patel","Raj","6","Sample ES","1150","SMP009R","1120","30000009","01/2027","0","0","","","","Paid"
"Open","Nash","Amy","7","Sample MS","980","SMP010A","950","30000010","01/2027","0","0","","","","Paid"
"Open","Cruz","Leo","5","Sample ES","900","SMP011L","0","","","0","0","","","","Paid"
"Open","Ford","Mia","8","Sample MS","1050","SMP012M","1020","30000012","01/2027","0","0","","","","Withdrew"`,
};

$('#sample-roster').addEventListener('click', () => {
  ($('#roster-text') as HTMLTextAreaElement).value = SAMPLE_NWCHESS.text;
  if (!($('#tname') as HTMLInputElement).value) ($('#tname') as HTMLInputElement).value = SAMPLE_NWCHESS.tname;
  previewRoster();
});
($('#roster-text') as HTMLTextAreaElement).addEventListener('input', previewRoster);
$('#roster-file').addEventListener('change', async () => {
  const f = ($('#roster-file') as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  ($('#roster-text') as HTMLTextAreaElement).value = text;
  previewRoster();
});

function previewRoster() {
  const text = ($('#roster-text') as HTMLTextAreaElement).value;
  const roster = parseRoster(text, 'nwchess');
  const prev = $('#roster-preview');
  if (!roster.length) {
    prev.innerHTML = text.trim()
      ? `<p class="neg">No players parsed. Make sure this is an NWChess RosterTable.csv export — check for the header row containing "NWSRS", "USCF", and "FIDE".</p>`
      : '';
    return;
  }
  const groups = splitIntoQuads(roster);
  const numQuads = groups.filter((g) => !g.isLeftover).length;
  const hasLeftover = groups.some((g) => g.isLeftover);
  const unrated = roster.filter((p) => p.rating == null).length;

  const note = `<p class="hint">📋 FIDE ratings ignored, seeding by <b>max(NWSRS, USCF)</b>; withdrawn players excluded. ${numQuads} quad${numQuads === 1 ? '' : 's'} of 4 formed by rating, highest first${hasLeftover ? ', with the leftover players below 4 in their own round-robin group' : ''}.</p>`;

  const groupsHtml = groups
    .map((g, i) => {
      const rounds = recommendedRoundsRoundRobin(g.players.length);
      const label = g.isLeftover ? 'Leftover group' : `Quad ${i + 1}`;
      const rows = g.players
        .map(
          (p, j) => `<tr>
            <td class="num">${j + 1}</td>
            <td>${esc(p.name)}</td>
            <td class="num">${p.rating ?? '<span class="hint">unrated</span>'}</td>
          </tr>`
        )
        .join('');
      return `<div class="plan-section">
        <h3>${esc(label)} <span class="hint">(${g.players.length} player${g.players.length === 1 ? '' : 's'} · round-robin · ${rounds} round${rounds === 1 ? '' : 's'})</span></h3>
        <div class="roster-table-wrap"><table class="roster-table"><thead><tr>
            <th class="num">#</th><th>Name</th><th class="num">Rating</th>
          </tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    })
    .join('');

  prev.innerHTML =
    note +
    `<p class="hint">Previewing ${roster.length} players${unrated ? ` · ${unrated} unrated` : ''}</p>` +
    groupsHtml;
}

$('#parse-btn').addEventListener('click', () => {
  const roster = parseRoster(($('#roster-text') as HTMLTextAreaElement).value, 'nwchess');
  if (roster.length < 3) { $('#roster-preview').innerHTML = `<p class="neg">Need at least 3 players parsed as an NWChess roster.</p>`; return; }
  const eventName = ($('#tname') as HTMLInputElement).value.trim() || 'Quads';
  const groups = splitIntoQuads(roster);
  const usable = groups.filter((g) => g.players.length >= 2);
  if (!usable.length) { $('#roster-preview').innerHTML = `<p class="neg">Each quad needs at least 2 players.</p>`; return; }
  let quadNo = 0;
  ev = {
    name: eventName,
    sections: usable.map((g) => {
      const name = g.isLeftover ? 'Leftover group' : `Quad ${++quadNo}`;
      return createTournament(name, g.players, undefined, 'round-robin', 'swiss');
    }),
    active: 0,
  };
  save();
  renderAll();
});

// ---------- rounds ----------
$('#pair-btn').addEventListener('click', () => {
  if (!ev) return;
  const anyIncomplete = ev.sections.some((s) => {
    const last = s.rounds[s.rounds.length - 1];
    return last && !last.complete;
  });
  if (anyIncomplete &&
      !confirm('Some quads have unfinished games in the current round. Pair the next round for ALL quads anyway? Unentered games count as not yet played.')) {
    return;
  }
  const anyAtLimit = ev.sections.some((s) => s.rounds.length >= (s.totalRounds ?? Infinity));
  if (anyAtLimit &&
      !confirm(`At least one quad has already reached its scheduled round count (quads can differ in size, so some finish sooner). Pair an extra round anyway?`)) {
    return;
  }
  // Pair every quad before committing any of them — an error partway through the loop would
  // otherwise leave an earlier quad's round mutated in memory but never saved, silently
  // double-pairing it on the next successful click.
  const paired: { section: Tournament; round: Round }[] = [];
  try {
    for (const s of ev.sections) paired.push({ section: s, round: pairNextRound(s) });
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
    return;
  }
  for (const { section, round } of paired) commitRound(section, round);
  viewingRoundNo = null; // jump the round-tab strip to the freshly paired round
  save();
  renderAll();
});

// ---------- player status (withdraw / reactivate) ----------
$('#mark-withdrawn-btn').addEventListener('click', () => {
  const t = cur();
  if (!t) return;
  const checked = [...document.querySelectorAll<HTMLInputElement>('#active-player-list input[type="checkbox"]:checked')];
  if (!checked.length) return;
  const ids = new Set(checked.map((box) => parseInt(box.dataset.pid!, 10)));
  for (const p of t.players) if (ids.has(p.id)) p.withdrawn = true;
  save();
  renderAll();
});

$('#withdrawn-players-list').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.reactivate-player-btn') as HTMLButtonElement | null;
  const t = cur();
  if (!btn || !t) return;
  const pid = parseInt(btn.dataset.pid!, 10);
  const p = t.players.find((pl) => pl.id === pid);
  if (p) p.withdrawn = false;
  save();
  renderAll();
});

$('#reset-tourn').addEventListener('click', () => {
  if (confirm('Delete this event (all quads) and start over?')) {
    ev = null;
    localStorage.removeItem(STORE_KEY);
    renderAll();
  }
});

// Non-destructive: reveal the roster screen again (same roster text still in the textarea) so a
// broken tournament can be fixed and re-created, without deleting anything unless "Create quads"
// is actually clicked again.
$('#edit-roster-btn').addEventListener('click', () => {
  ($('#setup-card') as HTMLElement).hidden = false;
  ($('#control-card') as HTMLElement).hidden = true;
  ($('#standings-card') as HTMLElement).hidden = true;
  ($('#wallchart-card') as HTMLElement).hidden = true;
  ($('#player-status-card') as HTMLElement).hidden = true;
  previewRoster();
  ($('#setup-card') as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#export-json').addEventListener('click', () => {
  if (!ev) return;
  const blob = new Blob([JSON.stringify(ev, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quads-${(ev.name || 'event').replace(/[^\w.-]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('#export-trf').addEventListener('click', () => {
  const t = cur();
  if (!t) return;
  // TRF is a single-tournament format — for a multi-quad event, this exports whichever quad is
  // currently active; switch quads (above) and export again for the others.
  downloadTrf(t, `${(t.name || 'tournament').replace(/[^\w.-]/g, '_')}.trf`);
});
$('#import-json').addEventListener('change', async () => {
  const input = $('#import-json') as HTMLInputElement;
  const f = input.files?.[0];
  input.value = ''; // reset so re-selecting the same file after a fix re-fires change
  if (!f) return;

  let data: any;
  try {
    data = JSON.parse(await f.text());
  } catch { alert('Could not read that tournament file — it doesn\'t look like valid JSON.'); return; }

  let candidate: QuadsEvent;
  if (isValidEvent(data)) candidate = data;
  else if (isValidTournament(data)) candidate = { name: data.name || 'Quads', sections: [data], active: 0 };
  else { alert('Could not read that tournament file — it\'s missing fields a valid export always has.'); return; }
  candidate.active = 0;

  // Render the candidate before persisting anything — a malformed shape that slipped past the
  // structural check above would otherwise get written to localStorage by save() and then crash
  // every future page load's own renderAll() with no way back in except manually clearing storage.
  const previous = ev;
  ev = candidate;
  try {
    renderAll();
  } catch (e) {
    console.error('Import produced an unrenderable tournament:', e);
    ev = previous;
    renderAll();
    alert('That file loaded but produced an invalid tournament — import cancelled, nothing was changed.');
    return;
  }
  save();
});
$('#print-btn').addEventListener('click', () => window.print());

// ---------- rendering ----------
function renderAll() {
  const hasE = !!ev;
  ($('#control-card') as HTMLElement).hidden = !hasE;
  ($('#player-status-card') as HTMLElement).hidden = !hasE;
  ($('#setup-card') as HTMLElement).hidden = hasE;
  const t = cur();
  ($('#standings-card') as HTMLElement).hidden = !t || !t.rounds.length;
  renderPrintArea();
  if (!ev || !t) {
    ($('#wallchart-card') as HTMLElement).hidden = true;
    $('#wallchart').innerHTML = '';
    return;
  }

  renderSectionTabs();
  const rr = t.totalRounds ?? recommendedRoundsRoundRobin(t.players.length);
  const pairedRounds = t.rounds.length; // rounds paired/created so far, including one still in progress
  const completedRounds = t.rounds.filter((r) => r.complete).length;
  const evLabel = ev.sections.length > 1
    ? `<b>${esc(ev.name)}</b> · ${ev.sections.length} quads · round ${pairedRounds} · viewing <b>${esc(t.name)}</b> (${t.players.length} players, ${completedRounds}/${rr} rounds)`
    : `<b>${esc(t.name)}</b> · ${t.players.length} players · ${completedRounds}/${rr} rounds played`;
  $('#round-info').innerHTML = evLabel;

  renderRounds(t);
  renderPlayerStatusCard(t);
  renderStandings(t);
  renderWallChart(t);
}

function renderPlayerStatusCard(t: Tournament) {
  const active = t.players.filter((p) => !p.withdrawn && !p.isHouse).sort((a, b) => a.name.localeCompare(b.name));
  $('#active-player-list').innerHTML = active.length
    ? active
        .map(
          (p) =>
            `<label class="bye-player-item"><input type="checkbox" data-pid="${p.id}"> ${esc(p.name)}${p.rating ? ` (${p.rating})` : ''}</label>`
        )
        .join('')
    : '<p class="hint">No active players.</p>';

  const withdrawn = t.players.filter((p) => p.withdrawn && !p.isHouse).sort((a, b) => a.name.localeCompare(b.name));
  $('#withdrawn-players-list').innerHTML = withdrawn.length
    ? `<h3>Withdrawn</h3><ul class="pattern-list">${withdrawn
        .map(
          (p) =>
            `<li>${esc(p.name)}${p.rating ? ` (${p.rating})` : ''} <button class="btn-icon reactivate-player-btn" data-pid="${p.id}" title="Reactivate — eligible for pairing again from the next round">↩ Reactivate</button></li>`
        )
        .join('')}</ul>`
    : '';
  $('#withdrawn-count').textContent = withdrawn.length ? `(${withdrawn.length} withdrawn)` : '';
}

function renderSectionTabs() {
  const el = $('#section-tabs');
  if (!ev || ev.sections.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = ev.sections
    .map((s, i) => {
      const done = s.rounds.length && s.rounds[s.rounds.length - 1].complete;
      return `<button class="sec-tab ${i === ev!.active ? 'active' : ''}" data-i="${i}">${esc(s.name)} <span class="hint">${s.players.length}p · R${s.rounds.length}${done ? ' ✓' : ''}</span></button>`;
    })
    .join('');
  el.querySelectorAll<HTMLElement>('.sec-tab').forEach((b) =>
    b.addEventListener('click', () => {
      if (!ev) return;
      ev.active = parseInt(b.dataset.i!, 10);
      save();
      renderAll();
    })
  );
}

/** Round-tab strip so a long event doesn't force scrolling past every earlier round to see the
 *  current one (or vice versa) — defaults to the latest round, remembers whichever round the TD
 *  last picked across re-renders, and snaps back to latest once a new round is paired past
 *  whatever was being viewed. */
let viewingRoundNo: number | null = null;

function roundBlockHtml(t: Tournament, round: Round): string {
      const isLatestRound = round.number === t.rounds.length;
      const unplayedPairings = isLatestRound ? round.pairings.filter((p) => p.byeId == null && p.result == null) : [];
      const swapCandidates = unplayedPairings
        .flatMap((p) => [p.whiteId!, p.blackId!])
        .map((id) => t.players.find((pl) => pl.id === id)!)
        .filter(Boolean);
      const swapBoardOptions = unplayedPairings.flatMap((p) => [
        { id: p.whiteId!, label: `Bd ${p.board} · White: ${t.players.find((pl) => pl.id === p.whiteId)?.name ?? '—'}` },
        { id: p.blackId!, label: `Bd ${p.board} · Black: ${t.players.find((pl) => pl.id === p.blackId)?.name ?? '—'}` },
      ]);
      const rows = round.pairings
        .map((pr) => {
          if (pr.byeId != null) {
            const pts = pr.byePoints ?? 1;
            const label = pts === 0.5 ? 'REQUESTED BYE (+½)' : 'BYE (+1)';
            const isAdding = isLatestRound && addingExtraFor?.round === round.number && addingExtraFor?.byeId === pr.byeId;
            if (isAdding) {
              return `<tr><td class="num">${pr.board}</td><td colspan="3">
                <div class="extra-game-form">
                  <b>${esc(nameWithRatingOf(t, pr.byeId, isLatestRound))}</b> vs
                  <input type="text" class="text-input extra-name" placeholder="Opponent name" />
                  <input type="number" class="text-input extra-rating" placeholder="Rating (optional)" min="100" max="3500" />
                  <button class="btn btn-primary btn-sm add-extra-confirm" data-round="${round.number}" data-bye="${pr.byeId}">Pair →</button>
                  <button class="btn btn-ghost btn-sm add-extra-cancel">Cancel</button>
                </div>
              </td></tr>`;
            }
            return `<tr><td class="num">${pr.board}</td><td colspan="2"><b>${esc(nameWithRatingOf(t, pr.byeId, isLatestRound))}</b></td><td class="mid">${label}</td></tr>`;
          }
          const sel = (val: string, cur: GameResult) => `<option value="${val}"${cur === val ? ' selected' : ''}>`;
          return `<tr>
            <td class="num">${pr.board}</td>
            <td>♔ ${esc(nameWithRatingOf(t, pr.whiteId, isLatestRound))}</td>
            <td>♚ ${esc(nameWithRatingOf(t, pr.blackId, isLatestRound))}</td>
            <td>
              <select class="result-sel" data-round="${round.number}" data-board="${pr.board}">
                <option value=""${pr.result == null ? ' selected' : ''}>— result —</option>
                ${sel('1-0', pr.result)}White wins (1-0)</option>
                ${sel('1/2-1/2', pr.result)}Draw (½-½)</option>
                ${sel('0-1', pr.result)}Black wins (0-1)</option>
              </select>
            </td>
          </tr>`;
        })
        .join('');

      // Correction tools are tucked behind a collapsed panel — for fixing a mistake, not part of
      // the normal per-round flow.
      let advancedBody = '';
      if (isLatestRound) {
        const realPairings = round.pairings.filter((p) => p.byeId == null);
        const byeRows = round.pairings
          .filter((p) => p.byeId != null)
          .map((pr) => {
            const addBtn = `<button class="btn btn-ghost btn-sm add-extra-btn" data-round="${round.number}" data-bye="${pr.byeId}">+ Add extra game</button>`;
            const swapControl = swapCandidates.length
              ? `<select class="swap-bye-select" data-round="${round.number}" data-bye="${pr.byeId}">
                   <option value="">Swap bye with…</option>
                   ${swapCandidates.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                 </select>
                 <button class="btn btn-ghost btn-sm swap-bye-btn" data-round="${round.number}" data-bye="${pr.byeId}">Swap</button>`
              : '';
            return `<div class="advanced-row"><b>${esc(nameWithRatingOf(t, pr.byeId!, isLatestRound))}</b>'s bye — ${addBtn} ${swapControl}</div>`;
          })
          .join('');
        const swapColorsRow = realPairings.length
          ? `<div class="advanced-row"><span class="hint">Swap colors:</span> ${realPairings
              .map((p) => `<button class="btn btn-ghost btn-sm swap-colors-btn" data-round="${round.number}" data-board="${p.board}">Bd ${p.board} ⇅</button>`)
              .join(' ')}</div>`
          : '';
        const swapBoardsControl = swapBoardOptions.length >= 2
          ? `<div class="advanced-row swap-players-row">
              <span class="hint">Swap two players between boards:</span>
              <select class="swap-board-select" data-slot="a">
                ${swapBoardOptions.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}
              </select>
              <span>⇄</span>
              <select class="swap-board-select" data-slot="b">
                ${swapBoardOptions.map((o, i) => `<option value="${o.id}"${i === 1 ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
              </select>
              <button class="btn btn-ghost btn-sm swap-players-btn" data-round="${round.number}">Swap</button>
            </div>`
          : '';
        const anyResultEntered = round.pairings.some((p) => p.result != null);
        const redoRow = !anyResultEntered
          ? `<div class="advanced-row"><button class="btn btn-ghost btn-sm redo-round-btn" data-round="${round.number}">🔁 Re-pair this round</button> <span class="hint">Discards these pairings and generates a fresh set — useful if you withdrew a player after this round was already paired.</span></div>`
          : '';
        advancedBody = redoRow + byeRows + swapColorsRow + swapBoardsControl;
      }
      const advancedPanel = advancedBody
        ? `<details class="round-advanced"><summary>⚙ Fix a mistake in this round</summary>${advancedBody}</details>`
        : '';

      const estimateHint = isLatestRound && round.number > 1
        ? `<p class="hint">Ratings in <code>[~brackets]</code> are an unofficial running estimate from this event's results so far — not the player's real rating, and never used for pairing.</p>`
        : '';
      return `<div class="round-block">
        <h3>Round ${round.number} ${round.complete ? '<span class="pos">✓ complete</span>' : '<span class="hint">in progress</span>'}</h3>
        ${estimateHint}
        <table><thead><tr><th class="num">Bd</th><th>White</th><th>Black</th><th>Result</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${advancedPanel}
      </div>`;
}

function renderRounds(t: Tournament) {
  const el = $('#rounds');
  const tabsEl = $('#round-tabs');
  if (!t.rounds.length) {
    el.innerHTML = `<p class="hint">No rounds yet — click “Pair next round”.</p>`;
    tabsEl.hidden = true;
    tabsEl.innerHTML = '';
    return;
  }
  const latestNo = t.rounds.length;
  const shown = viewingRoundNo != null && t.rounds.some((r) => r.number === viewingRoundNo) ? viewingRoundNo : latestNo;
  viewingRoundNo = shown;

  tabsEl.hidden = t.rounds.length < 2;
  tabsEl.innerHTML = t.rounds
    .map((r) => `<button class="round-tab${r.number === shown ? ' active' : ''}" data-round="${r.number}">R${r.number}${r.number === latestNo ? ' •' : ''}</button>`)
    .join('');
  tabsEl.querySelectorAll<HTMLButtonElement>('.round-tab').forEach((b) => {
    b.addEventListener('click', () => {
      viewingRoundNo = parseInt(b.dataset.round!, 10);
      const t2 = cur();
      if (t2) renderRounds(t2);
    });
  });

  const round = t.rounds.find((r) => r.number === shown)!;
  el.innerHTML = roundBlockHtml(t, round);

  el.querySelectorAll<HTMLSelectElement>('.result-sel').forEach((s) => {
    s.addEventListener('change', () => {
      const t2 = cur();
      if (!t2) return;
      setResult(t2, parseInt(s.dataset.round!, 10), parseInt(s.dataset.board!, 10), (s.value || null) as GameResult);
      save();
      renderStandings(t2);
      renderWallChart(t2);
      renderSectionTabs();
      renderRounds(t2);
      renderPrintArea();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.add-extra-btn').forEach((b) => {
    b.addEventListener('click', () => {
      addingExtraFor = { round: parseInt(b.dataset.round!, 10), byeId: parseInt(b.dataset.bye!, 10) };
      const t2 = cur();
      if (t2) renderRounds(t2);
    });
  });
  el.querySelectorAll<HTMLButtonElement>('.add-extra-cancel').forEach((b) => {
    b.addEventListener('click', () => {
      addingExtraFor = null;
      const t2 = cur();
      if (t2) renderRounds(t2);
    });
  });
  el.querySelectorAll<HTMLButtonElement>('.add-extra-confirm').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      const row = b.closest('tr')!;
      const name = (row.querySelector('.extra-name') as HTMLInputElement).value.trim();
      const ratingStr = (row.querySelector('.extra-rating') as HTMLInputElement).value.trim();
      if (!name) { alert('Enter a name for the extra player.'); return; }
      let rating: number | null = null;
      if (ratingStr) {
        rating = parseInt(ratingStr, 10);
        if (!Number.isFinite(rating) || rating < 100 || rating > 3500) {
          alert('Rating must be between 100 and 3500, or left blank.');
          return;
        }
      }
      addingExtraFor = null;
      save();
      renderAll();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.redo-round-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      if (!confirm('Discard this round\'s pairings and generate a fresh set? This will not touch any earlier round.')) return;
      let ok: boolean;
      try {
        ok = redoLatestRound(t2);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!ok) { alert('Could not re-pair this round — a result may already have been entered on one of its boards.'); return; }
      save();
      renderAll();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.swap-colors-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      const ok = swapColors(t2, parseInt(b.dataset.round!, 10), parseInt(b.dataset.board!, 10));
      if (!ok) { alert('Could not swap colors on this board.'); return; }
      save();
      renderAll();
    });
  });
  el.querySelectorAll<HTMLButtonElement>('.swap-bye-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      const row = b.closest('.advanced-row')!;
      const select = row.querySelector('.swap-bye-select') as HTMLSelectElement;
      const otherId = parseInt(select.value, 10);
      if (!select.value || !Number.isFinite(otherId)) { alert('Pick a player to swap the bye with.'); return; }
      const roundNo = parseInt(b.dataset.round!, 10);
      const byeId = parseInt(b.dataset.bye!, 10);
      const ok = swapByeWithPlayer(t2, roundNo, byeId, otherId);
      if (!ok) { alert('Could not swap the bye — that player may already have a result entered.'); return; }
      save();
      renderAll();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.swap-players-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      const wrap = b.closest('.swap-players-row')!;
      const selA = wrap.querySelector('.swap-board-select[data-slot="a"]') as HTMLSelectElement;
      const selB = wrap.querySelector('.swap-board-select[data-slot="b"]') as HTMLSelectElement;
      const aId = parseInt(selA.value, 10);
      const bId = parseInt(selB.value, 10);
      if (aId === bId) { alert('Pick two different players.'); return; }
      const roundNo = parseInt(b.dataset.round!, 10);
      const ok = swapPlayersAcrossBoards(t2, roundNo, aId, bId);
      if (!ok) { alert('Could not swap those players — they may already be on the same board, or one of their boards may already have a result entered.'); return; }
      save();
      renderAll();
    });
  });
}

function renderStandings(t: Tournament) {
  if (!t.rounds.length) { ($('#standings-card') as HTMLElement).hidden = true; return; }
  ($('#standings-card') as HTMLElement).hidden = false;
  $('#standings-title').textContent = 'Standings';
  $('#standings').innerHTML = standingsTableHtml(t);
}

function renderWallChart(t: Tournament) {
  const card = $('#wallchart-card') as HTMLElement;
  if (!t.rounds.length) { card.hidden = true; $('#wallchart').innerHTML = ''; return; }
  card.hidden = false;
  $('#wallchart').innerHTML = wallChartHtml(t);
}

/** Print view: standings for every quad (a wall chart for posting). */
function renderPrintArea() {
  const el = $('#print-area');
  if (!ev) { el.innerHTML = ''; return; }
  el.innerHTML =
    `<h1>${esc(ev.name)} — Standings</h1>` +
    ev.sections.map((s) =>
      `<h2>${esc(s.name)} <span style="font-weight:400">· ${s.players.length} players · ${s.rounds.length} rounds</span></h2>` +
      (s.rounds.length ? standingsTableHtml(s) : '<p>No rounds played.</p>')
    ).join('');
}

// ---------- boot ----------
const saved = localStorage.getItem(STORE_KEY);
if (saved) {
  try {
    const data = JSON.parse(saved);
    if (isValidEvent(data)) ev = data;
    else if (isValidTournament(data)) ev = { name: data.name || 'Quads', sections: [data], active: 0 }; // migrate old single-tournament save
  } catch { ev = null; }
}
try {
  renderAll();
} catch (e) {
  console.error('Saved tournament data is corrupted — resetting:', e);
  ev = null;
  localStorage.removeItem(STORE_KEY);
  renderAll();
  alert('Your saved tournament data was corrupted and had to be reset. If you have an exported JSON backup, you can re-import it from "⋯ More options".');
}
previewRoster();
