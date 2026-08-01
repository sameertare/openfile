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

  if (shownSection >= ev.sections.length) shownSection = ev.active;
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

sectionSelect.addEventListener('change', () => {
  shownSection = parseInt(sectionSelect.value, 10) || 0;
  render();
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
  if (e.key === STORE_KEY || e.key === null) render();
});

// Belt-and-suspenders poll, in case a browser/kiosk shell doesn't deliver storage events reliably
// (e.g. some embedded/signage browsers). Cheap — just a string comparison most ticks.
setInterval(() => {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    render();
  }
}, 4000);

lastRaw = localStorage.getItem(STORE_KEY);
render();
