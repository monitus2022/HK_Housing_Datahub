# HK Housing Dashboard (frontend)

Static React frontend for the HK Housing Datahub serving snapshot. It covers:

- visualization-first market overview with median price/rent/yield KPIs, a
  sale-versus-rent pulse filterable by All Hong Kong or a district and starting
  at their common coverage, a top-10 estates chart by trailing-12-month
  transaction value with All / 1st hand / 2nd hand filtering (2nd hand default
  once sale-type coverage is at least 95%; old or partially backfilled snapshots
  fall back to All),
  a district league table, and a full-width price-versus-yield
  scatter
- estate search with text, district, price, net-ft price, area, bedroom, MTR,
  and school-net filters, sorting, and pagination; filter state lives in the URL
- estate detail panel with latest transaction, 12-month stats, market date,
  coverage flags, monthly price and rent history, and recent transactions
- `W`/Wiki badges link to the estate's Chinese Wikipedia page when the
  snapshot provides a title; older snapshots show a non-link badge
- shareable `?estate=<id>` deep links that open the estate view
- district trends for sale price, rent, and transaction volume with level,
  indexed, and 12-month-change views, plus a multi-district comparison chart
- price-distribution bands (p25/median/p75) for sale or rent, and a
  trailing-12-month all-Hong-Kong segment comparison by bedroom, area, age,
  MTR line, or school net; groups under 20 transactions are marked low sample
- official RVD benchmark chart with price/rent indices, average rents/prices,
  and yields by region and property class where available, explicitly labeled
  as aggregate rather than estate-level data; A–E are plotted together as
  saleable-area classes, with the boundaries shown in the panel
- estate map with district filtering, price-bucketed markers, zoom-aware
  clustering, district-to-list linking, and “Show on map” from the estate
  drawer
- recent-transactions table with search, district/date filters, sorting, and
  pagination; it still shows all sale types (sale-type filtering is currently
  limited to the top-estates chart)
- catalogue view with dataset cards, provenance, freshness, quality, caveats,
  and expandable table/column detail

- **Live deployment:** <https://hk-housing.monitus.org>
- **If the snapshot does not load:** see the deployment troubleshooting in
  [`../docs/deployment.md`](../docs/deployment.md).

## Stack

- Vite
- React 18
- TypeScript
- Leaflet + OpenStreetMap tiles for the map
- Plain CSS (no UI framework)
- Vitest for the pure search, trend, map, transaction, wiki, and activation helpers

## Data contract

The app fetches, in order:

```text
{VITE_DASHBOARD_BASE_URL}/dashboard/manifest.json
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.estate_summary}
```

The default Overview loads `district_monthly` on mount and requests
`transaction_recent` when the top-estates panel approaches the viewport. Estate
history, the transactions table, and the catalogue load their files on demand;
district monthly is shared with the Overview. Each file is cached per build ID
for the life of the page:

```text
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.district_monthly}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.transaction_recent}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.estate_monthly}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.district_bands}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.segment_summary}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.rvd_benchmarks}
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.catalog}
```

It never hardcodes a build ID or file name. The published snapshot is described
in [`../docs/serving.md`](../docs/serving.md). Large data files are gzipped; the
loader lets the browser decode R2's `Content-Encoding: gzip`, and falls back to
manual `DecompressionStream` for local servers that return raw `.gz` bytes. If a
snapshot predates the trends, transactions, estate-history, or catalogue file,
only that section shows an error; the overview and estate search keep working.

Search state is linkable too: `q`, `sort`, `district`, price/area ranges,
`bedrooms`, `mtr`, and `school` are serialized in the query string and restored
on load. Estate views use `?estate=<estate_id>`; opening such a URL loads the
snapshot and opens that estate, and selecting or closing an estate updates the
query string while keeping the search filters. On a missing file, the history and transactions sections show a
section-level message while the estate summary still renders.

The map plots estate coordinates from `estate_summary` over OpenStreetMap
tiles. Nearby estates are grouped into numbered screen-space clusters and split
as you zoom; cluster colour follows the most common price bucket in the group.
Markers are coloured by the 12-month average net-ft price, with the latest
transaction price as a fallback; the legend documents the buckets. Selecting a
district can open the matching estate list, and the estate drawer can jump back
to the map with the estate centred and highlighted; that focus is one-shot and
cleared when you leave the map. Tiles are fetched from
`tile.openstreetmap.org` at runtime and are not bundled or cached by the app;
attribution is shown on the map.

## Quickstart

```bash
cd frontend
npm ci
cp .env.example .env.local
# edit .env.local and set VITE_DASHBOARD_BASE_URL
npm run dev
```

A trailing slash is tolerated (the loader strips it). Leave the variable empty
when the frontend and `/dashboard` are served from the same origin.

`frontend/.env.production` provides the live R2 host as a build-time fallback.
A Cloudflare Pages environment variable with the same name overrides it.

## Local development without R2

Use the repo's snapshot server, which adds CORS and gzip headers:

```bash
# Terminal 1, from the repository root
python scripts/serve_snapshot.py \
  --snapshot-dir data/serving/{build_id} \
  --port 8787

# Terminal 2
cd frontend
echo 'VITE_DASHBOARD_BASE_URL=http://localhost:8787' > .env.local
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`).

## Build and deploy

```bash
cd frontend
npm ci
npm run build
```

The static output is `frontend/dist/`. Set `VITE_DASHBOARD_BASE_URL` in the
build environment; Vite bakes it into the bundle, so changing it requires a new
deployment.

Cloudflare Pages production settings:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **React (Vite)** |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |
| Node version | `22` |
| Environment variable | `VITE_DASHBOARD_BASE_URL=https://hk-housing-datahub.monitus.org` |

The live custom domain is `hk-housing.monitus.org`. The R2 bucket (or custom
domain) must allow public reads and CORS for that origin. Do not ship write
credentials to the frontend.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Current limitations

- The map depends on OpenStreetMap tiles; without network access the markers
  render on a blank background.
- Rent history comes from HKP rental transactions and covers roughly the last
  three years; longer windows show the months that exist.
- Estate history and recent transactions are loaded only when an estate is
  opened; both degrade to a section-level message if the snapshot lacks them.
- The snapshot is a batch-refreshed dataset, not a live feed.
- Data is scraped from third-party sources; see the root README for the
  disclaimer.
