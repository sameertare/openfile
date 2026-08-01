import './style.css';
import type { Tournament } from './swissEngine';
import { standingsTableHtml, currentRoundPairingsHtml } from './swissViews';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const STORE_KEY = 'openfile-swiss';

interface SwissEvent { name: string; sections: Tournament[]; active: number; }

const titleEl = $('#wd-title');
const metaEl = $('#wd-meta');
const bodyEl = $('#wd-body');
const sectionSelect = $('#wd-section-select') as HTMLSelectElement;
const fullscreenBtn = $('#wd-fullscreen-btn') as HTMLButtonElement;

/** Which section index the TD has picked to display — separate from the editor's own `active`
 *  section, since the wall display and the laptop the TD is entering results on are different tabs
 *  and may reasonably want to show different sections. Not persisted; resets to the event's active
 *  section on reload, which is the sensible default for "just opened the display." */
let shownSection = 0;
let lastRaw: string | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function loadEvent(): SwissEvent | null {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.sections)) return null;
    return data as SwissEvent;
  } catch {
    return null;
  }
}

function render() {
  const ev = loadEvent();
  if (!ev || !ev.sections.length) {
    titleEl.textContent = '🏆 Wall Display';
    metaEl.textContent = '';
    sectionSelect.hidden = true;
    bodyEl.innerHTML = `<div class="walldisplay-empty">No tournament found in this browser yet. Set one up in <a href="swiss.html">Swiss Pairings</a> on this device, then reopen this page.</div>`;
    return;
  }

  // Resolve the section to show without ever trusting a stored index blindly. The editor writes
  // `active` and never deletes sections, so it's normally in range — but this page has no way to
  // know that, and unlike swiss.ts's boot path there's no render-and-reset backstop here to recover
  // from a bad value. An out-of-range index would make `t` below undefined and throw on t.rounds,
  // blanking a display that's typically on a projector in a tournament hall with no UI to fix it.
  const inRange = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < ev.sections.length;
  shownSection = inRange(shownSection) ? shownSection : inRange(ev.active) ? ev.active : 0;

  sectionSelect.hidden = ev.sections.length < 2;
  if (ev.sections.length > 1) {
    sectionSelect.innerHTML = ev.sections
      .map((s, i) => `<option value="${i}"${i === shownSection ? ' selected' : ''}>${esc(s.name)}</option>`)
      .join('');
  }

  const t = ev.sections[shownSection];
  titleEl.textContent = `🏆 ${ev.name}`;
  const roundNo = t.rounds.length;
  const roundStr = roundNo ? `Round ${roundNo} of ${t.totalRounds}` : `${t.totalRounds} round(s) planned — not yet paired`;
  metaEl.textContent = `${t.players.filter((p) => !p.withdrawn).length} players · ${roundStr} · updated ${new Date().toLocaleTimeString()}`;

  bodyEl.innerHTML = `<div class="walldisplay-grid">
    <section class="walldisplay-panel"><h2>Current round</h2>${currentRoundPairingsHtml(t)}</section>
    <section class="walldisplay-panel"><h2>Standings</h2>${standingsTableHtml(t)}</section>
  </div>`;
}

/** This page runs unattended on a projector/second screen — an uncaught render error would leave a
 *  blank or frozen board in front of a whole tournament hall, with no controls to recover and
 *  nobody at a keyboard. Show what went wrong instead, and keep the refresh loop alive so the
 *  display self-heals as soon as the TD's next edit lands. */
function safeRender() {
  try {
    render();
  } catch (e) {
    console.error('Wall display render failed:', e);
    metaEl.textContent = '';
    bodyEl.innerHTML = `<div class="walldisplay-empty">Could not display this tournament. Check it in <a href="swiss.html">Swiss Pairings</a> — this screen updates again automatically once it's fixed.</div>`;
  }
}

sectionSelect.addEventListener('change', () => {
  shownSection = parseInt(sectionSelect.value, 10) || 0;
  safeRender();
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? '⛶ Exit fullscreen' : '⛶ Fullscreen';
});

// Cross-tab live update: fires in this tab whenever another tab (the TD's laptop, entering
// pairings/results in Swiss Pairings) writes to the same localStorage key. Doesn't fire for writes
// made in this same tab, which is fine — this page never writes to STORE_KEY itself.
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY || e.key === null) safeRender();
});

// Belt-and-suspenders poll, in case a browser/kiosk shell doesn't deliver storage events reliably
// (e.g. some embedded/signage browsers). Cheap — just a string comparison most ticks.
setInterval(() => {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    safeRender();
  }
}, 4000);

lastRaw = localStorage.getItem(STORE_KEY);
safeRender();
