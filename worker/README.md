# OpenFile visit counter — Cloudflare Worker + D1

Backs the visitor counter and location map on the About page. A single request logs one page
view and returns the running aggregate — the classic hit-counter pattern, no per-visitor identity.

**Privacy:** location comes from Cloudflare's own edge geolocation (`request.cf`), which every
request already carries — no external geolocation API is called, and no IP address is ever read,
stored, or logged anywhere in this code. Only a city/country name and that city's approximate
lat/lon are persisted, aggregated into a running count per city. There's no cookie, session, or
any way to tell two visits from the same person apart.

This is a separate deployable from the main static site — it needs its own Cloudflare account and
a few one-time setup steps, since deploying it requires *your* Cloudflare credentials (nothing
here can be deployed on your behalf without them).

## One-time setup

1. Install wrangler if you don't have it: `npm install -g wrangler`
2. `cd worker && npm install`
3. `wrangler login` — opens a browser tab to authorize wrangler against your Cloudflare account.
4. `wrangler d1 create openfile-visits` — creates the database and prints a `database_id`. Copy
   that id into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
5. `npm run db:init` — creates the `visits` table in the new database.
6. `npm run deploy` — deploys the Worker. Wrangler prints the live URL, something like
   `https://openfile-visits.<your-subdomain>.workers.dev`.
7. Open `src/about.ts` in the main project, set `VISIT_API_URL` (near the top of the file) to
   that URL, then rebuild and redeploy the main site as usual.

That's it — the About page will start logging visits and showing them on the map.

## Local development

`npm run dev` runs the Worker locally via `wrangler dev`. Cloudflare's geolocation fields
(`request.cf`) aren't populated for plain local requests — use `wrangler dev --remote` (routes
through Cloudflare's network) if you want real geolocation while testing, or just accept that
local test hits show up as "Unknown" city until deployed. Use `npm run db:init:local` to set up
the schema in wrangler's local D1 emulation for `wrangler dev` (without `--remote`).

## Cost

Comfortably inside Cloudflare's free tier for any realistic traffic this site would see: Workers
free tier is 100,000 requests/day, D1 free tier is 5GB storage and 5 million rows read per day.
