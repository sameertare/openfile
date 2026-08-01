import './style.css';
import { registerServiceWorker } from './pwa';
import { initTheme } from './theme';

registerServiceWorker();
initTheme();

// Set this to the Worker URL printed by `wrangler deploy` in worker/ (see worker/README.md) once
// it's been deployed to your own Cloudflare account — left blank, the visitor card just explains
// that setup step instead of trying to fetch. Nothing here works without a URL of your own; this
// project can't deploy the Worker on your behalf since that needs your Cloudflare credentials.
const VISIT_API_URL = '';

interface VisitLocation {
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  count: number;
}
interface VisitResponse {
  total: number;
  locations: VisitLocation[];
}

// Calibrated against public/world-map.svg's own coordinate space (viewBox "30.767 241.591
// 784.077 458.627") by fitting a straight line through several countries' known geographic
// centers vs. that path's on-screen bounding-box center — this map isn't a strict equirectangular
// projection, so the fit is approximate, but easily close enough to land a dot in the right
// country for a small illustrative visitor map.
const MAP_VIEWBOX = { x: 30.767, y: 241.591, w: 784.077, h: 458.627 };
function lonToX(lon: number): number {
  const x = 2.2768 * lon + 409.84;
  return Math.max(MAP_VIEWBOX.x, Math.min(MAP_VIEWBOX.x + MAP_VIEWBOX.w, x));
}
function latToY(lat: number): number {
  const y = -2.9838 * lat + 530.11;
  return Math.max(MAP_VIEWBOX.y, Math.min(MAP_VIEWBOX.y + MAP_VIEWBOX.h, y));
}

async function loadVisitorMap() {
  const totalEl = document.querySelector('#visitor-total') as HTMLElement;
  const mapEl = document.querySelector('#visitor-map') as HTMLElement;
  const noteEl = document.querySelector('#visitor-note') as HTMLElement;

  if (!VISIT_API_URL) {
    noteEl.textContent = 'Not set up yet — this card needs a small Cloudflare Worker deployed to your own account. See worker/README.md in the repo for the one-time setup steps.';
    return;
  }

  let data: VisitResponse;
  try {
    const resp = await fetch(VISIT_API_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (e) {
    noteEl.textContent = `Visitor counter unavailable right now (${e instanceof Error ? e.message : 'network error'}).`;
    return;
  }

  totalEl.textContent = data.total.toLocaleString();

  let svgText: string;
  try {
    const svgResp = await fetch(`${import.meta.env.BASE_URL}world-map.svg`);
    svgText = await svgResp.text();
  } catch {
    noteEl.textContent = `${data.total.toLocaleString()} page view(s) so far — map unavailable.`;
    return;
  }
  mapEl.innerHTML = svgText;
  const svg = mapEl.querySelector('svg');
  if (!svg) return;

  const maxCount = Math.max(1, ...data.locations.map((l) => l.count));
  for (const loc of data.locations) {
    if (loc.lat == null || loc.lon == null) continue;
    const cx = lonToX(loc.lon);
    const cy = latToY(loc.lat);
    // Radius scales with sqrt(count) so a city's dot AREA (not radius) is proportional to its
    // share of visits — otherwise one very-visited city would visually swallow the whole map.
    const r = 1.4 + 5 * Math.sqrt(loc.count / maxCount);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'visit-dot');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${loc.city}, ${loc.country} — ${loc.count.toLocaleString()} view${loc.count === 1 ? '' : 's'}`;
    circle.appendChild(title);
    svg.appendChild(circle);
  }

  noteEl.textContent = `${data.locations.length.toLocaleString()} distinct location(s). Location is your city, derived from your network's approximate location, not your exact address — nothing more precise is collected or stored, and no cookie or ID ties visits to you personally.`;
}

void loadVisitorMap();
