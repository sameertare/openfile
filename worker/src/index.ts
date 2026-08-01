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
    // Cloudflare sends these as strings, and can omit them entirely even when it does know the
    // city. parseFloat('') / parseFloat('abc') is NaN, which is not a valid D1 REAL binding — treat
    // anything non-finite as "no coordinates" so it takes the null path cleanly.
    const num = (v: unknown): number | null => {
      if (typeof v !== 'string') return null;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const lat = num(cf?.latitude);
    const lon = num(cf?.longitude);

    try {
      await env.DB.prepare(
        // COALESCE backfills coordinates for a city first seen without them: Cloudflare supplies
        // city/country more reliably than lat/lon, so a plain `count = count + 1` would leave that
        // city's lat/lon null permanently, and the About page skips null-coordinate rows when
        // plotting — the city would keep climbing the table while never once appearing on the map.
        // Argument order also means a later request that lacks coordinates can't wipe good ones.
        `INSERT INTO visits (city, country, lat, lon, count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(city, country) DO UPDATE SET
           count = count + 1,
           lat = COALESCE(excluded.lat, visits.lat),
           lon = COALESCE(excluded.lon, visits.lon)`
      ).bind(city, country, lat, lon).run();
    } catch {
      // The counter is a nice-to-have — a logging hiccup shouldn't break the About page's read below.
    }

    let total = 0;
    let locations: VisitRow[] = [];
    // The row list is capped, so its length stops being the number of distinct cities once the cap
    // is hit — count them separately rather than letting the About page infer it from a truncated
    // array and permanently report exactly the cap as the true total.
    let distinctLocations = 0;
    try {
      const { results } = await env.DB.prepare(
        `SELECT city, country, lat, lon, count FROM visits ORDER BY count DESC LIMIT 300`
      ).all<VisitRow>();
      locations = results ?? [];
      const totals = await env.DB.prepare(
        `SELECT SUM(count) as total, COUNT(*) as distinct_locations FROM visits`
      ).first<{ total: number | null; distinct_locations: number | null }>();
      total = totals?.total ?? 0;
      distinctLocations = totals?.distinct_locations ?? locations.length;
    } catch {
      // Fall through with an empty/zeroed response rather than a 500 — the About page should
      // still render fine without the counter if D1 is briefly unavailable.
    }

    return new Response(JSON.stringify({ total, locations, distinctLocations }), {
      // The page view this request just logged should never be served from an intermediary cache;
      // that would both hide new visits and silently under-count them.
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
