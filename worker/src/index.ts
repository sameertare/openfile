/**
 * Backs the visitor counter/map on the About page. A single GET logs one page view and returns
 * the running aggregate — classic hit-counter semantics (no per-visitor identity, no cookies, no
 * session tracking). Location comes from Cloudflare's own edge geolocation (`request.cf`), which
 * every request already carries for free — no external geolocation API call, and no IP address is
 * ever read, stored, or logged by this code. Only a city/country name and that city's approximate
 * lat/lon are persisted, aggregated as a running count per city.
 */

export interface Env {
  DB: D1Database;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface VisitRow {
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  count: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/visit') {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf;
    const city = (cf?.city as string | undefined) || 'Unknown';
    const country = (cf?.country as string | undefined) || 'XX';
    const lat = typeof cf?.latitude === 'string' ? parseFloat(cf.latitude) : null;
    const lon = typeof cf?.longitude === 'string' ? parseFloat(cf.longitude) : null;

    try {
      await env.DB.prepare(
        `INSERT INTO visits (city, country, lat, lon, count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(city, country) DO UPDATE SET count = count + 1`
      ).bind(city, country, lat, lon).run();
    } catch {
      // The counter is a nice-to-have — a logging hiccup shouldn't break the About page's read below.
    }

    let total = 0;
    let locations: VisitRow[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT city, country, lat, lon, count FROM visits ORDER BY count DESC LIMIT 300`
      ).all<VisitRow>();
      locations = results ?? [];
      const totalRow = await env.DB.prepare(`SELECT SUM(count) as total FROM visits`).first<{ total: number }>();
      total = totalRow?.total ?? 0;
    } catch {
      // Fall through with an empty/zeroed response rather than a 500 — the About page should
      // still render fine without the counter if D1 is briefly unavailable.
    }

    return new Response(JSON.stringify({ total, locations }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};
