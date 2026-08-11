import './style.css';
import {
  addExtraGameForBye, addFamilyGroup, cancelByeRequest, commitRound, createTournament, estimatedCurrentRating,
  explainPairing, explainPairingDetail, explainRound, nextRoundNumber, pairingMethod, pairNextRound,
  parseRoster, recommendedRounds, recommendedRoundsKnockout, recommendedRoundsRoundRobin, redoLatestRound,
  removeFamilyGroup, requestByeForRound, setResult, swapByeWithPlayer, swapColors, swapPlayersAcrossBoards,
  tournamentFormat,
} from './swissEngine';
import type { GameResult, PairingMethod, Round, RosterEntry, Tournament, TournamentFormat } from './swissEngine';
import { knockoutPlacementsTableHtml, standingsTableHtml, wallChartHtml } from './swissViews';
import { downloadTrf } from './trfExport';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
// Same storage key as swiss.html on purpose — this page and Swiss Pairings are two different setup
// front-doors onto the same single active event/tournament the app already only ever holds one of
// at a time (see SwissEvent below); a tournament created here can equally be viewed/managed from
// swiss.html afterward, and vice versa. wallchart-display.html already reads this key too, so
// sharing it means no changes were needed there for this page to work with the big-screen display.
const STORE_KEY = 'openfile-swiss';

/** An event holds one Swiss tournament per section; all sections advance round-by-round together. */
interface SwissEvent { name: string; sections: Tournament[]; active: number; }
let ev: SwissEvent | null = null;

function cur(): Tournament | null { return ev ? ev.sections[ev.active] : null; }

// Every mutating handler in this file follows `mutate(); save(); render...()` — if setItem throws
// (storage quota exceeded after many rounds/sections, or Safari private browsing where it always
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
  // Every player lookup site-wide (nameOf, wall chart, TRF export, withdrawn-status checks) resolves
  // by `id`, and never checks for a match failure beyond falling back to a placeholder — a
  // non-numeric or duplicate id doesn't crash anything, it just silently resolves to the wrong
  // player (or none), which is worse than rejecting the file outright.
  const ids = new Set<number>();
  for (const p of t.players) {
    if (typeof p?.id !== 'number' || !Number.isFinite(p.id) || ids.has(p.id)) return false;
    ids.add(p.id);
  }
  return true;
}
function isValidEvent(data: any): data is SwissEvent {
  return !!data && typeof data === 'object' && Array.isArray(data.sections) && data.sections.every(isValidTournament);
}

/** Which bye row (if any) currently has its "add extra game" form open — transient UI state, not saved. */
let addingExtraFor: { round: number; byeId: number } | null = null;
/** Which board's pairing explanation (if any) is currently expanded — transient UI state, not saved. */
let explainingFor: { round: number; board: number } | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function nameOf(t: Tournament, id: number | null): string {
  if (id == null) return '—';
  return t.players.find((p) => p.id === id)?.name ?? '—';
}
/** Name with rating in brackets, e.g. "Ava Thompson (1580)" — "(unrated)" when there's none. When
 *  `showEstimate` is true and the player has actual result history this event, also appends a
 *  second bracket with a lightweight running rating estimate reflecting results so far — purely
 *  informational, never used for pairing/seeding (see estimatedCurrentRating's own doc comment). */
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
// This page only ever imports an NWChess RosterTable.csv — unlike swiss.html, there's no roster
// format picker at all.
function currentTourneyFormat(): TournamentFormat {
  return (($('#tourney-format-select') as HTMLSelectElement).value as TournamentFormat) || 'swiss';
}
function currentPairingMethod(): PairingMethod {
  return (($('#pairing-method-select') as HTMLSelectElement).value as PairingMethod) || 'swiss';
}
/** Round-robin and knockout both pair strictly by a fixed schedule/bracket, with no per-round
 *  score-group decision to explain, avoid a rematch in, or steer with a bye/family-group request. */
function isFixedFormat(t: Tournament): boolean {
  const fmt = tournamentFormat(t);
  return fmt === 'round-robin' || fmt === 'knockout';
}
/** The pairing-method choice (Swiss vs. FIDE) only makes sense for a Swiss-format tournament —
 *  round-robin/knockout pair by a fixed schedule regardless. */
function pairingMethodApplies(tfmt: TournamentFormat): boolean {
  return tfmt === 'swiss';
}

const SAMPLE_NWCHESS = {
  tname: 'Scholastic Championship',
  text: `" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"
"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"
"Open","Smith","Alice","6","Sample ES","1600","SMP001A","1550","30000001","01/2027","0","0","","","","Paid"
"Open","Jones","Bob","7","Sample MS","1400","SMP002B","1480","30000002","01/2027","0","0","","","","Paid"
"Open","Chen","Cara","5","Sample ES","1520","SMP003C","1495","30000003","01/2027","0","0","","","","Paid"
"U1000","Lee","Dan","4","Sample ES","1000","SMP004D","950","30000004","01/2027","0","0","","","","Paid"
"U1000","Kim","Eve","3","Sample ES","900","SMP005E","0","","","0","0","","","","Paid"
"U1000","Park","Zoe","6","Sample ES","1100","SMP006Z","1080","30000006","01/2027","0","0","","","","Withdrew"`,
};

$('#sample-roster').addEventListener('click', () => {
  ($('#roster-text') as HTMLTextAreaElement).value = SAMPLE_NWCHESS.text;
  if (!($('#tname') as HTMLInputElement).value) ($('#tname') as HTMLInputElement).value = SAMPLE_NWCHESS.tname;
  previewRoster();
});
($('#tourney-format-select') as HTMLSelectElement).addEventListener('change', previewRoster);
($('#pairing-method-select') as HTMLSelectElement).addEventListener('change', previewRoster);
($('#roster-text') as HTMLTextAreaElement).addEventListener('input', previewRoster);
$('#roster-file').addEventListener('change', async () => {
  const f = ($('#roster-file') as HTMLInputElement).files?.[0];
  if (!f) return;
  const text = await f.text();
  ($('#roster-text') as HTMLTextAreaElement).value = text;
  previewRoster();
});

function distinctSections(roster: RosterEntry[]): string[] {
  return [...new Set(roster.filter((p) => p.section).map((p) => p.section as string))];
}

/** Section <select> in setup is preview-only — creating always sets up every section. */
function syncSectionUI(roster: RosterEntry[]): string[] {
  const secs = distinctSections(roster);
  const row = $('#section-row') as HTMLElement;
  const sel = $('#section-filter') as HTMLSelectElement;
  if (secs.length > 1) {
    const keep = sel.value;
    sel.innerHTML =
      `<option value="__ALL__">All sections (${roster.length})</option>` +
      secs.map((s) => `<option value="${esc(s)}">${esc(s)} (${roster.filter((p) => p.section === s).length})</option>`).join('');
    if (keep && (secs.includes(keep) || keep === '__ALL__')) sel.value = keep;
    row.hidden = false;
  } else {
    row.hidden = true;
    sel.innerHTML = '';
  }
  return secs;
}
function previewSelection(roster: RosterEntry[]): RosterEntry[] {
  const secs = distinctSections(roster);
  if (secs.length <= 1) return roster;
  const sel = ($('#section-filter') as HTMLSelectElement).value;
  return !sel || sel === '__ALL__' ? roster : roster.filter((p) => p.section === sel);
}

function previewRoster() {
  const text = ($('#roster-text') as HTMLTextAreaElement).value;
  const all = parseRoster(text, 'nwchess');
  const prev = $('#roster-preview');
  const tfmt = currentTourneyFormat();
  const showPairingMethod = pairingMethodApplies(tfmt);
  ($('#pairing-method-row') as HTMLElement).hidden = !showPairingMethod;
  $('#pairing-method-hint').textContent = showPairingMethod
    ? (currentPairingMethod() === 'fide'
        ? 'FIDE mode never produces a repeat pairing or an absolute-colour clash, even as a last resort — pairing a round fails loudly with an explanation instead, rather than silently bending a rule.'
        : 'Swiss mode (default) guarantees every round gets paired, relaxing rematch-avoidance or colour balance only if the field genuinely leaves no other option.')
    : '';
  if (!all.length) {
    ($('#section-row') as HTMLElement).hidden = true;
    $('#rounds-hint').textContent = '';
    prev.innerHTML = text.trim()
      ? `<p class="neg">No players parsed. Make sure this is an NWChess RosterTable.csv export — check for the header row containing "NWSRS", "USCF", and "FIDE".</p>`
      : '';
    return;
  }
  const secs = syncSectionUI(all);
  const roster = previewSelection(all);
  const rr =
    tfmt === 'round-robin' ? recommendedRoundsRoundRobin(roster.length)
    : tfmt === 'knockout' ? recommendedRoundsKnockout(roster.length)
    : recommendedRounds(roster.length);
  ($('#rounds-input') as HTMLInputElement).placeholder = String(rr);
  $('#rounds-hint').textContent =
    tfmt === 'round-robin'
      ? `A single round-robin with ${roster.length} players needs ${rr} rounds so everyone meets once — leave blank to use that, or set a different count for a double round-robin etc.`
      : tfmt === 'knockout'
        ? `A single-elimination bracket for ${roster.length} players needs ${rr} rounds. Byes (if the field isn't a power of 2) go to the highest-rated players in round 1.`
        : `Leave blank to use the recommended ${rr} rounds for ${roster.length} players, or set your own.`;
  $('#tourney-format-hint').textContent =
    tfmt === 'round-robin'
      ? 'Round-robin: pairings for every round are fixed by roster order up front — no bye requests or family-group avoidance (there\'s no dynamic pairing to steer). Withdrawing a player still works; their remaining opponents get a walkover.'
      : tfmt === 'knockout'
      ? 'Knockout: round 1 is seeded by rating; later rounds pair whoever won each side of the bracket. Drawn games aren\'t allowed on the result — settle a tie with a playoff/Armageddon game before entering the result here. No bye requests or family-group avoidance, and the pairing method choice above has no effect (there\'s no dynamic pairing to steer).'
      : '';
  const note = `<p class="hint">📋 FIDE ratings ignored, seeding by <b>max(NWSRS, USCF)</b>; withdrawn players excluded.` +
      (secs.length > 1 ? ` Creating sets up all <b>${secs.length}</b> sections; “Pair next round” pairs them together.` : '') + `</p>`;
  const unrated = roster.filter((p) => p.rating == null).length;
  const withByes = roster.filter((p) => p.byeRounds && p.byeRounds.length).length;

  const showSection = secs.length > 1;
  const rows = roster
    .map(
      (p, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(p.name)}</td>
        <td class="num">${p.rating ?? '<span class="hint">unrated</span>'}</td>
        <td class="num">${p.byeRounds && p.byeRounds.length ? `R${p.byeRounds.join(', R')}` : '—'}</td>
        ${showSection ? `<td>${esc(p.section ?? '—')}</td>` : ''}
      </tr>`
    )
    .join('');

  prev.innerHTML =
    note +
    `<p class="hint">Previewing ${roster.length} players${secs.length > 1 ? '' : ` · recommended rounds: <b>${rr}</b>`}${unrated ? ` · ${unrated} unrated` : ''}${withByes ? ` · ${withByes} with a requested bye` : ''}</p>` +
    `<div class="roster-table-wrap"><table class="roster-table"><thead><tr>
        <th class="num">#</th><th>Name</th><th class="num">Rating</th><th class="num">Bye</th>${showSection ? '<th>Section</th>' : ''}
      </tr></thead><tbody>${rows}</tbody></table></div>`;
}

($('#section-filter') as HTMLSelectElement).addEventListener('change', previewRoster);

/** Group the roster into one {name, roster} per section (or a single section for a plain list). */
function buildSectionGroups(all: RosterEntry[], eventName: string): { name: string; roster: RosterEntry[] }[] {
  const secs = distinctSections(all);
  if (secs.length <= 1) return [{ name: eventName, roster: all }];
  return secs.map((s) => ({ name: s, roster: all.filter((p) => p.section === s) }));
}

$('#parse-btn').addEventListener('click', () => {
  const all = parseRoster(($('#roster-text') as HTMLTextAreaElement).value, 'nwchess');
  if (all.length < 2) { $('#roster-preview').innerHTML = `<p class="neg">Need at least 2 players parsed as an NWChess roster.</p>`; return; }
  const eventName = ($('#tname') as HTMLInputElement).value.trim() || 'Swiss Tournament';
  const groups = buildSectionGroups(all, eventName);
  const usable = groups.filter((g) => g.roster.length >= 2);
  const skipped = groups.filter((g) => g.roster.length < 2);
  if (!usable.length) { $('#roster-preview').innerHTML = `<p class="neg">Each section needs at least 2 players.</p>`; return; }
  const roundsRaw = ($('#rounds-input') as HTMLInputElement).value.trim();
  const roundsOverride = roundsRaw ? Math.max(1, Math.min(30, parseInt(roundsRaw, 10))) : undefined;
  const tfmt = currentTourneyFormat();
  const pmethod = pairingMethodApplies(tfmt) ? currentPairingMethod() : 'swiss';
  ev = { name: eventName, sections: usable.map((g) => createTournament(g.name, g.roster, roundsOverride, tfmt, pmethod)), active: 0 };
  save();
  renderAll();
  if (skipped.length) {
    $('#round-info').innerHTML += ` <span class="hint">(skipped ${skipped.map((g) => esc(g.name)).join(', ')} — fewer than 2 players)</span>`;
  }
});

// ---------- rounds ----------
$('#pair-btn').addEventListener('click', () => {
  if (!ev) return;
  const anyIncomplete = ev.sections.some((s) => {
    const last = s.rounds[s.rounds.length - 1];
    return last && !last.complete;
  });
  if (anyIncomplete &&
      !confirm('Some sections have unfinished games in the current round. Pair the next round for ALL sections anyway? Unentered games count as not yet played.')) {
    return;
  }
  const anyAtLimit = ev.sections.some((s) => s.rounds.length >= (s.totalRounds ?? Infinity));
  if (anyAtLimit &&
      !confirm(`This event was set up for ${ev.sections[0].totalRounds} round(s), which have already been paired. Pair an extra round anyway?`)) {
    return;
  }
  // Pair every section before committing any of them — a FIDE-mode section can throw (no
  // conflict-free pairing exists under strict rules) partway through the loop, and committing
  // section 1 before section 2 fails would leave that section's round mutated in memory but never
  // saved, silently double-pairing it on the next successful click.
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

// ---------- bye requests ----------
$('#add-bye-request-btn').addEventListener('click', () => {
  const t = cur();
  if (!t) return;
  const round = parseInt(($('#bye-round-select') as HTMLSelectElement).value, 10);
  const checked = [...document.querySelectorAll<HTMLInputElement>('#bye-player-list input[type="checkbox"]:checked')];
  if (!checked.length) return;
  for (const box of checked) requestByeForRound(t, parseInt(box.dataset.pid!, 10), round);
  save();
  renderAll();
});

$('#pending-byes').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.cancel-bye-btn') as HTMLButtonElement | null;
  const t = cur();
  if (!btn || !t) return;
  cancelByeRequest(t, parseInt(btn.dataset.pid!, 10), parseInt(btn.dataset.round!, 10));
  save();
  renderAll();
});

// ---------- family / sibling groups ----------
$('#add-family-group-btn').addEventListener('click', () => {
  const t = cur();
  if (!t) return;
  const checked = [...document.querySelectorAll<HTMLInputElement>('#family-player-list input[type="checkbox"]:checked')];
  if (checked.length < 2) { alert('Select at least 2 players to mark as a family/sibling group.'); return; }
  const label = ($('#family-label-input') as HTMLInputElement).value.trim();
  const ok = addFamilyGroup(t, label, checked.map((box) => parseInt(box.dataset.pid!, 10)));
  if (!ok) { alert('Could not add that group.'); return; }
  ($('#family-label-input') as HTMLInputElement).value = '';
  checked.forEach((box) => (box.checked = false));
  save();
  renderAll();
});

$('#family-groups-list').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.remove-family-group-btn') as HTMLButtonElement | null;
  const t = cur();
  if (!btn || !t) return;
  removeFamilyGroup(t, parseInt(btn.dataset.gid!, 10));
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
  if (confirm('Delete this event (all sections) and start over?')) {
    ev = null;
    localStorage.removeItem(STORE_KEY);
    renderAll();
  }
});

// Non-destructive: reveal the roster screen again (same roster text still in the textarea) so a
// broken tournament can be fixed and re-created, without deleting anything unless "Create
// tournament" is actually clicked again.
$('#edit-roster-btn').addEventListener('click', () => {
  ($('#setup-card') as HTMLElement).hidden = false;
  ($('#control-card') as HTMLElement).hidden = true;
  ($('#standings-card') as HTMLElement).hidden = true;
  // This is non-destructive — ev still points at the old tournament until "Create tournament" is
  // actually clicked again — but none of these are something the setup screen should keep showing
  // in the meantime; without explicitly hiding each one here, it lingers with stale data from the
  // tournament being replaced while the user is in the middle of uploading a new roster. These are
  // exactly the cards renderAll() hides via `hidden = !hasE` on its normal path — this handler
  // doesn't call renderAll() (it's non-destructive, ev is untouched), so it has to hide them itself.
  ($('#wallchart-card') as HTMLElement).hidden = true;
  ($('#bye-request-card') as HTMLElement).hidden = true;
  ($('#family-group-card') as HTMLElement).hidden = true;
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
  a.download = `swiss-${(ev.name || 'event').replace(/[^\w.-]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('#export-trf').addEventListener('click', () => {
  const t = cur();
  if (!t) return;
  // TRF is a single-tournament format — for a multi-section event, this exports whichever
  // section is currently active; switch sections (above) and export again for the others.
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

  let candidate: SwissEvent;
  if (isValidEvent(data)) candidate = data;
  else if (isValidTournament(data)) candidate = { name: data.name || 'Swiss', sections: [data], active: 0 };
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
  ($('#bye-request-card') as HTMLElement).hidden = !hasE;
  ($('#family-group-card') as HTMLElement).hidden = !hasE;
  ($('#player-status-card') as HTMLElement).hidden = !hasE;
  ($('#setup-card') as HTMLElement).hidden = hasE;
  const t = cur();
  ($('#standings-card') as HTMLElement).hidden = !t || !t.rounds.length;
  renderPrintArea();
  if (!ev || !t) {
    // No current tournament (just deleted/reset, or none created yet) — renderWallChart() below
    // never runs past this point, so without this it would leave whatever the *previous*
    // tournament last rendered sitting on screen instead of resetting.
    ($('#wallchart-card') as HTMLElement).hidden = true;
    $('#wallchart').innerHTML = '';
    return;
  }

  renderSectionTabs();
  const rr = t.totalRounds ?? recommendedRounds(t.players.length);
  const pairedRounds = t.rounds.length; // rounds paired/created so far, including one still in progress
  // "Rounds played" means results are actually in, not just paired — a freshly-paired round with
  // no results entered yet shouldn't count, or the summary reads as the event being further along
  // (even fully done, if it happens to be the last scheduled round) than it actually is.
  const completedRounds = t.rounds.filter((r) => r.complete).length;
  const evLabel = ev.sections.length > 1
    ? `<b>${esc(ev.name)}</b> · ${ev.sections.length} sections · round ${pairedRounds} · viewing <b>${esc(t.name)}</b> (${t.players.length} players, ${completedRounds}/${rr} rounds)`
    : `<b>${esc(t.name)}</b> · ${t.players.length} players · ${completedRounds}/${rr} rounds played`;
  const fideBadge = pairingMethod(t) === 'fide' ? ` <span class="dev-status-chip dev-full" title="Strict FIDE rules: never a repeat pairing or an absolute colour clash, even as a last resort.">FIDE pairing</span>` : '';
  $('#round-info').innerHTML = evLabel + fideBadge;

  renderRounds(t);
  renderByeRequestCard(t);
  renderFamilyGroupCard(t);
  renderPlayerStatusCard(t);
  renderStandings(t);
  renderWallChart(t);

  // Round-robin's whole schedule is fixed by roster order up front, and knockout only ever pairs
  // the winners of the previous round — neither has a per-round pairing decision left for a
  // requested bye or family-group avoidance to steer, so those controls (and the Swiss-only
  // pairing-logic guide) would just be dead UI for these formats.
  const locked = isFixedFormat(t);
  ($('#bye-request-card') as HTMLElement).hidden = ($('#bye-request-card') as HTMLElement).hidden || locked;
  ($('#family-group-card') as HTMLElement).hidden = ($('#family-group-card') as HTMLElement).hidden || locked;
  const guide = document.querySelector<HTMLElement>('.swiss-guide');
  if (guide) guide.hidden = locked;
}

function renderByeRequestCard(t: Tournament) {
  const nextRound = nextRoundNumber(t);
  const roundSelect = $('#bye-round-select') as HTMLSelectElement;
  const prevSelected = roundSelect.value ? parseInt(roundSelect.value, 10) : nextRound;
  const roundOptions = Array.from({ length: 6 }, (_, i) => nextRound + i);
  roundSelect.innerHTML = roundOptions.map((r) => `<option value="${r}">Round ${r}</option>`).join('');
  roundSelect.value = String(roundOptions.includes(prevSelected) ? prevSelected : nextRound);

  const active = t.players.filter((p) => !p.withdrawn && !p.isHouse).sort((a, b) => a.name.localeCompare(b.name));
  $('#bye-player-list').innerHTML = active.length
    ? active
        .map(
          (p) =>
            `<label class="bye-player-item"><input type="checkbox" data-pid="${p.id}"> ${esc(p.name)}${p.rating ? ` (${p.rating})` : ''}</label>`
        )
        .join('')
    : '<p class="hint">No active players.</p>';

  const pending = active
    .flatMap((p) => (p.byeRequests ?? []).filter((r) => r >= nextRound).map((r) => ({ player: p, round: r })))
    .sort((a, b) => a.round - b.round || a.player.name.localeCompare(b.player.name));
  $('#pending-byes').innerHTML = pending.length
    ? `<h3>Pending bye requests</h3><ul class="pattern-list">${pending
        .map(
          ({ player, round }) =>
            `<li>${esc(player.name)} — Round ${round} <button class="btn-icon cancel-bye-btn" data-pid="${player.id}" data-round="${round}" title="Cancel this bye request">✕</button></li>`
        )
        .join('')}</ul>`
    : '';
  $('#bye-request-count').textContent = pending.length ? `(${pending.length} pending)` : '';
}

function renderFamilyGroupCard(t: Tournament) {
  const active = t.players.filter((p) => !p.withdrawn && !p.isHouse).sort((a, b) => a.name.localeCompare(b.name));
  $('#family-player-list').innerHTML = active.length
    ? active
        .map(
          (p) =>
            `<label class="bye-player-item"><input type="checkbox" data-pid="${p.id}"> ${esc(p.name)}${p.rating ? ` (${p.rating})` : ''}</label>`
        )
        .join('')
    : '<p class="hint">No active players.</p>';

  $('#family-groups-list').innerHTML = t.familyGroups.length
    ? `<h3>Groups</h3><ul class="pattern-list">${t.familyGroups
        .map((g) => {
          const names = g.playerIds.map((id) => t.players.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
          return `<li><b>${esc(g.label)}</b>: ${esc(names)} <button class="btn-icon remove-family-group-btn" data-gid="${g.id}" title="Remove this group">✕</button></li>`;
        })
        .join('')}</ul>`
    : '';
  $('#family-group-count').textContent = t.familyGroups.length ? `(${t.familyGroups.length})` : '';
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
      // Both are keyed only by round/board/byeId, not by section — since board numbers and bye
      // player ids restart independently per section, a panel left open in one section's Round 3
      // Board 2 would otherwise reopen for a completely different pairing after switching to
      // another section that happens to also have a Round 3 Board 2.
      addingExtraFor = null;
      explainingFor = null;
      save();
      renderAll();
    })
  );
}

/** Diagram for a single board's pairing: which score group each player entered with (with a ⇣
 *  float marker if one of them dropped down a group), a color-due flow showing what each player
 *  was due and whether they got it, and badges for rematch / family-group status. The per-board
 *  counterpart to roundMethodologyHtml's whole-round view — same visual language, zoomed to one
 *  pairing so a TD can see exactly which criteria produced this specific board. */
function pairingDiagramHtml(t: Tournament, roundNo: number, board: number): string {
  const d = explainPairingDetail(t, roundNo, board);
  if (!d) return '';

  if (d.kind === 'bye') {
    const bye = d.bye!;
    const candidatesHtml = bye.candidates?.length
      ? `<div class="bracket-panel">
          <div class="bracket-panel-label">Bye order — fewest prior byes, then lowest score, then lowest rating</div>
          <div class="bracket-half">${bye.candidates
            .map(
              (c) =>
                `<span class="player-chip rank-tag${c.id === bye.chosenId ? ' paired-white' : ''}">${esc(c.name)} · ${c.byes} bye${c.byes === 1 ? '' : 's'} · ${c.score} pt${c.score === 1 ? '' : 's'}${c.rating != null ? ` · ${c.rating}` : ''}</span>`
            )
            .join('')}</div>
        </div>`
      : '';
    return `<div class="pairing-diagram">
      <div class="score-group-row">
        <div class="score-group-label">${bye.score} pt${bye.score === 1 ? '' : 's'}</div>
        <div class="score-group-players"><span class="player-chip">${esc(bye.name)} <span class="hint">(${bye.requested ? '+½ requested bye' : '+1 field-odd bye'})</span></span></div>
      </div>
      ${candidatesHtml}
    </div>`;
  }

  const w = d.white!;
  const b = d.black!;
  const wFloated = d.floatedId === w.id;
  const bFloated = d.floatedId === b.id;
  const svgId = `pd-${roundNo}-${board}`;
  const warn = d.familyLabel != null;

  // Board-vs-board SVG: a box per player (name, score, assigned color), a connecting line
  // labeled with the board number and rematch/family status, and a float arrow above whichever
  // player dropped down a score group to reach this pairing — same visual language as the
  // static "How pairing logic works" guide's score-group diagram, but for this exact board.
  const boxW = 210;
  const boxH = 54;
  const leftX = 10;
  const rightX = 420;
  const boxY = 54;
  const midX = (leftX + boxW + rightX) / 2;
  const floatMark = (x: number, score: number) => `
    <path d="M ${x} 6 L ${x} ${boxY - 2}" class="diagram-line warn" marker-end="url(#${svgId}-arrow)" />
    <text x="${x}" y="18" class="diagram-label warn" text-anchor="middle">⇣ floated from ${score} pt${score === 1 ? '' : 's'}</text>`;
  const playerBox = (x: number, glyph: string, name: string, score: number) => `
    <rect x="${x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" class="diagram-box" />
    <text x="${x + boxW / 2}" y="${boxY + 22}" class="diagram-text" font-weight="700">${glyph} ${esc(name)}</text>
    <text x="${x + boxW / 2}" y="${boxY + 40}" class="diagram-text" font-size="11">${score} pt${score === 1 ? '' : 's'} entering the round</text>`;
  const svg = `<svg viewBox="0 0 640 158" class="pairing-diagram-svg" role="img" aria-label="Diagram of board ${board}: ${esc(w.name)} as White versus ${esc(b.name)} as Black">
    <defs>
      <marker id="${svgId}-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" class="diagram-arrowhead warn" />
      </marker>
    </defs>
    ${wFloated ? floatMark(leftX + boxW / 2, w.score) : ''}
    ${bFloated ? floatMark(rightX + boxW / 2, b.score) : ''}
    ${playerBox(leftX, '♔', w.name, w.score)}
    ${playerBox(rightX, '♚', b.name, b.score)}
    <path d="M ${leftX + boxW} ${boxY + boxH / 2} H ${rightX}" class="diagram-line${warn ? ' warn' : ''}"${d.rematchRound ? ' stroke-dasharray="5 4"' : ''} />
    <text x="${midX}" y="${boxY + boxH / 2 - 8}" class="diagram-label" text-anchor="middle">Board ${board}</text>
    <text x="${midX}" y="${boxY + boxH / 2 + 20}" class="diagram-text" font-size="11"${warn ? ' fill="var(--gold)"' : ''} text-anchor="middle">${d.rematchRound ? `🔁 rematch — also Round ${d.rematchRound}` : '🆕 first meeting'}</text>
    ${d.familyLabel ? `<text x="${midX}" y="${boxY + boxH + 22}" class="diagram-text warn" text-anchor="middle">⚠ family group "${esc(d.familyLabel)}" — paired anyway, no conflict-free option existed</text>` : ''}
  </svg>`;

  const dueLabel = (p: { due: { code: string; why: string } | null }) => (p.due ? `${p.due.code} — ${p.due.why}` : 'no color due yet');
  const gotLabel = (p: { preferenceMet: boolean | null }, color: 'White' | 'Black') =>
    p.preferenceMet == null ? `No prior preference — assigned ${color}` : p.preferenceMet ? `Got the color it was due (${color})` : `Preference not met — assigned ${color} anyway`;
  const colorFlow = `<div class="color-flow">
      <span>${esc(w.name)}: ${esc(dueLabel(w))}</span><b>→</b><span>${esc(gotLabel(w, 'White'))}</span>
      <span>${esc(b.name)}: ${esc(dueLabel(b))}</span><b>→</b><span>${esc(gotLabel(b, 'Black'))}</span>
    </div>`;

  let bracketHtml = '';
  if (d.bracket && d.bracket.length > 2) {
    const chip = (m: NonNullable<typeof d.bracket>[number]) => {
      const paired = m.id === w.id ? ' paired-white' : m.id === b.id ? ' paired-black' : '';
      const floatTag = m.floatedIn ? '<span class="float-arrow" title="Floated down to complete this bracket">⇣</span> ' : '';
      return `<span class="player-chip rank-tag${paired}">${floatTag}#${m.rank} ${esc(m.name)}${m.rating != null ? ` (${m.rating})` : ''}</span>`;
    };
    const half = Math.ceil(d.bracket.length / 2);
    const top = d.bracket.slice(0, half).map(chip).join('');
    const bottom = d.bracket.slice(half).map(chip).join('');
    bracketHtml = `<div class="bracket-panel">
      <div class="bracket-panel-label">Score bracket — ${d.bracketScore} pt${d.bracketScore === 1 ? '' : 's'} (${d.bracket.length} players), ranked by rating — natural pairing crosses top half vs bottom half</div>
      <div class="bracket-half-row">
        <div class="bracket-half">${top}</div>
        <span class="bracket-divider">⇄</span>
        <div class="bracket-half">${bottom}</div>
      </div>
    </div>`;
  }

  return `<div class="pairing-diagram">
    ${svg}
    ${colorFlow}
    <p class="hint" style="margin:6px 0 0;">${esc(d.colorReason ?? '')}</p>
    ${bracketHtml}
  </div>`;
}

/** Whole-round methodology diagram: every player grouped by the score they entered the round
 *  with, a ⇣ marker on whoever floated down to complete an odd bracket, and a note for any
 *  rematch or family-group conflict that couldn't be avoided this round. */
function roundMethodologyHtml(t: Tournament, roundNo: number): string {
  if (isFixedFormat(t)) return ''; // fixed/bracket schedule — no score-group reasoning to show
  const summary = explainRound(t, roundNo);
  if (!summary.groups.length) return '';

  const groupsHtml = summary.groups
    .map((g) => {
      const chips = g.players
        .map((p) => {
          const floatBadge = p.floated
            ? `<span class="float-arrow" title="Floated down from the ${g.score} group to pair against ${esc(p.opponentName ?? '')} (${p.opponentScoreBefore} pt)">⇣</span> `
            : '';
          const byeBadge = p.opponentName == null ? ' <span class="hint">(bye)</span>' : '';
          return `<span class="player-chip${p.floated ? ' floated' : ''}">${floatBadge}${esc(p.name)}${byeBadge}</span>`;
        })
        .join('');
      return `<div class="score-group-row"><div class="score-group-label">${g.score} pt${g.score === 1 ? '' : 's'} <span class="hint">(${g.players.length})</span></div><div class="score-group-players">${chips}</div></div>`;
    })
    .join('');

  const notes: string[] = [];
  for (const r of summary.forcedRematches) {
    notes.push(`${esc(r.aName)} vs ${esc(r.bName)} — rematch from Round ${r.lastRound}, unavoidable this round.`);
  }
  for (const f of summary.forcedFamilyConflicts) {
    notes.push(`${esc(f.aName)} vs ${esc(f.bName)} — both in "${esc(f.label)}", paired anyway because no conflict-free option existed.`);
  }
  const notesHtml = notes.length ? `<p class="hint" style="margin-top:10px;">⚠ ${notes.join(' ')}</p>` : '';

  return `<details class="round-methodology">
    <summary>📊 How this round was paired</summary>
    <p class="hint">Players grouped by the score they entered this round with. ⇣ marks whoever floated down from a higher score group to complete an odd bracket.</p>
    ${groupsHtml}
    ${notesHtml}
  </details>`;
}

/** Round-tab strip so a long event doesn't force scrolling past every earlier round to see the
 *  current one (or vice versa) — defaults to the latest round, remembers whichever round the TD
 *  last picked across re-renders (e.g. after entering a result), and snaps back to latest once a
 *  new round is paired past whatever was being viewed. */
let viewingRoundNo: number | null = null;

function roundBlockHtml(t: Tournament, round: Round): string {
      const isLatestRound = round.number === t.rounds.length;
      // Players currently in an unplayed real game this round — the only valid swap-with-a-bye
      // candidates, since swapping after a result is entered would require un-scoring it. Also
      // doubles as the candidate list for swapping two players across boards, below.
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
          const isExplaining = explainingFor?.round === round.number && explainingFor?.board === pr.board;
          // Round-robin/knockout boards aren't dynamically decided, so there's no reasoning to explain.
          const explainBtn = isFixedFormat(t)
            ? ''
            : `<button class="btn-icon explain-btn" data-round="${round.number}" data-board="${pr.board}" title="Why this pairing?">ⓘ</button>`;
          const explainRow = isExplaining
            ? `<tr class="explain-row"><td></td><td colspan="3">
                ${pairingDiagramHtml(t, round.number, pr.board)}
                <ul class="pattern-list">${explainPairing(t, round.number, pr.board)
                  .map((line) => `<li>${esc(line)}</li>`)
                  .join('')}</ul>
              </td></tr>`
            : '';
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
            return `<tr><td class="num">${pr.board}</td><td colspan="2"><b>${esc(nameWithRatingOf(t, pr.byeId, isLatestRound))}</b></td><td class="mid">${label} ${explainBtn}</td></tr>${explainRow}`;
          }
          const sel = (val: string, cur: GameResult) => `<option value="${val}"${cur === val ? ' selected' : ''}>`;
          // Knockout needs a decisive winner to advance — no draw option, so a tie has to be
          // settled with a playoff/Armageddon game before a result can be entered here at all.
          const isKnockout = tournamentFormat(t) === 'knockout';
          return `<tr>
            <td class="num">${pr.board}</td>
            <td>♔ ${esc(nameWithRatingOf(t, pr.whiteId, isLatestRound))}</td>
            <td>♚ ${esc(nameWithRatingOf(t, pr.blackId, isLatestRound))}</td>
            <td>
              <select class="result-sel" data-round="${round.number}" data-board="${pr.board}">
                <option value=""${pr.result == null ? ' selected' : ''}>— result —</option>
                ${sel('1-0', pr.result)}White wins (1-0)</option>
                ${isKnockout ? '' : `${sel('1/2-1/2', pr.result)}Draw (½-½)</option>`}
                ${sel('0-1', pr.result)}Black wins (0-1)</option>
              </select>
              ${explainBtn}
            </td>
          </tr>${explainRow}`;
        })
        .join('');

      // Correction tools are tucked behind a collapsed panel — they're for fixing a mistake, not
      // part of the normal per-round flow, and showing them inline on every board/bye row was
      // cluttering the common case (just entering results).
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
          ? `<div class="advanced-row"><button class="btn btn-ghost btn-sm redo-round-btn" data-round="${round.number}">🔁 Re-pair this round</button> <span class="hint">Discards these pairings and generates a fresh set — useful if you added a family group, changed a bye request, or withdrew a player after this round was already paired.</span></div>`
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
        ${roundMethodologyHtml(t, round.number)}
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
      const roundNo = parseInt(b.dataset.round!, 10);
      const byeId = parseInt(b.dataset.bye!, 10);
      const ok = addExtraGameForBye(t2, roundNo, byeId, name, rating);
      if (!ok) { alert('Could not add this game — the bye may no longer be available.'); return; }
      addingExtraFor = null;
      save();
      renderAll();
    });
  });

  el.querySelectorAll<HTMLButtonElement>('.redo-round-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const t2 = cur();
      if (!t2) return;
      if (!confirm('Discard this round\'s pairings and generate a fresh set? This re-applies the current family groups, bye requests, and withdrawals — it will not touch any earlier round.')) return;
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

  el.querySelectorAll<HTMLButtonElement>('.explain-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const round = parseInt(b.dataset.round!, 10);
      const board = parseInt(b.dataset.board!, 10);
      explainingFor = explainingFor?.round === round && explainingFor?.board === board ? null : { round, board };
      const t2 = cur();
      if (t2) renderRounds(t2);
    });
  });
}

function renderStandings(t: Tournament) {
  if (!t.rounds.length) { ($('#standings-card') as HTMLElement).hidden = true; return; }
  ($('#standings-card') as HTMLElement).hidden = false;
  const isKnockout = tournamentFormat(t) === 'knockout';
  $('#standings-title').textContent = isKnockout ? 'Bracket results' : 'Standings';
  $('#standings-tiebreak-note').hidden = isKnockout;
  $('#standings').innerHTML = isKnockout ? knockoutPlacementsTableHtml(t) : standingsTableHtml(t);
}

function renderWallChart(t: Tournament) {
  const card = $('#wallchart-card') as HTMLElement;
  if (!t.rounds.length) { card.hidden = true; $('#wallchart').innerHTML = ''; return; }
  card.hidden = false;
  $('#wallchart').innerHTML = wallChartHtml(t);
}

/** Print view: standings for every section (a wall chart for posting). */
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
    else if (isValidTournament(data)) ev = { name: data.name || 'Swiss', sections: [data], active: 0 }; // migrate old single-tournament save
  } catch { ev = null; }
}
try {
  renderAll();
} catch (e) {
  // Belt-and-suspenders alongside the import handler's own validation — if a saved event still
  // turns out to be unrenderable (e.g. state saved by a since-fixed bug), reset rather than leave
  // the TD stuck on a permanently broken page with no way back in short of manually clearing
  // browser storage.
  console.error('Saved tournament data is corrupted — resetting:', e);
  ev = null;
  localStorage.removeItem(STORE_KEY);
  renderAll();
  alert('Your saved tournament data was corrupted and had to be reset. If you have an exported JSON backup, you can re-import it from "⋯ More options".');
}
previewRoster();
