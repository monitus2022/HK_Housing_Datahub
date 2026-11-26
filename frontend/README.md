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
- estate search with text, region, subregion, district, price, net-ft price,
  area, bedroom, MTR, and school-net filters, sorting, and pagination; filter
  state lives in the URL
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
- estate drawer shows an RVD regional benchmark for the estate's region and
  saleable-area class, labeled as an official aggregate with the net-area vs
  saleable-area caveat; estates without a recorded net area show a short note
  instead of benchmark stats
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

## Brand assets

`public/favicon.svg` is the source of truth for the housing mark; the header
renders the same geometry inline via `src/components/HousingMark.tsx` so the tab
and page stay in sync.

The PNG fallbacks (`favicon-32.png`, `apple-touch-icon.png`) are rasterised from
the SVG: render the SVG at 180×180 on a transparent background with any
browser/SVG rasteriser, save that as `apple-touch-icon.png`, then downscale it to
32×32 for `favicon-32.png`. Regenerate both only when the mark changes.

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

Search state is linkable too: `q`, `sort`, `region`, `subregion`, `district`,
price/area ranges, `bedrooms`, `mtr`, `school`, and `maxAge` are serialized in
the query string and restored on load. Links that carry only `district` back-fill their
region and subregion from the checked-in geography model, so the cascade opens
at the right level. Estate views use `?estate=<estate_id>`; opening such a URL loads the
snapshot and opens that estate, and selecting or closing an estate updates the
query string while keeping the search filters. On a missing file, the history and transactions sections show a
section-level message while the estate summary still renders.

Place names resolve through `src/lib/gazetteer.ts`, which layers abbreviations,
direction words and typo tolerance over the geography model. It is deliberately
conservative: `TKO` resolves to the Tseung Kwan O subregion, `KT` returns both
Kwun Tong and Kowloon Tong as candidates instead of picking one, `east` asks
which region unless the cascade already anchors it, `tuen wan` asks rather than
choosing between Tsuen Wan and Tuen Mun, and `shenzhen` is refused rather than
fuzzily matched to a Hong Kong estate. `make gazetteer` regenerates
`src/lib/gazetteer.json` from the estate mart plus its MTR-line and school-net
tables; `make gazetteer-check` fails when the artifact drifts.

### Natural-language search

`src/lib/lexicon.ts` parses one sentence into one query spec
(`2 bedroom flat in TKO`, `3 room under 6m in Sha Tin`, `cheapest 2 bed in Kwun
Tong`, `near the island line`, `school net 41`). Chinese works too: `兩房 in
大埔`, `600萬以下`, `最平`, `港島綫`, `40校網`. Estate names are recognised from
the estate list the dashboard already holds (`太古城 兩房 under 6m`): the name
becomes the text query and the other slots still apply. It is deterministic and runs in
the browser: no network call, no model and no dependency. Each submit **replaces**
the current filters — one utterance is one query, so a previous query cannot
silently narrow the new one — and the result area always discloses what happened:

- `Interpreted as:` lists every slot, with `(default)` marking a vague phrase such
  as `middle size` (400–700 ft², from the snapshot quartiles).
- `Ignored:` names concepts that are understood but have no data behind them
  (sea view, quiet, pet policy, parking, "near MTR" beyond line membership), and
  is shown even when nothing else in the sentence applied. `新盤` (primary
  market) is one of these: the data has no new-launch flag, so it says so rather
  than pretending a recent build is a new launch.
- `new` / `新樓` applies a building-age filter of 5 years, marked `(default)`
  like a vague size. `newest` and `最新` are still sort words, not age filters.
  The rule is a real five years, not a calendar bucket, and an estate with no
  recorded first-occupation date is excluded rather than assumed recent (about
  9% of the snapshot).
- `Unrecognised:` lists words that were not used, so nothing is dropped quietly.
- An ambiguous place asks instead of guessing and offers hint buttons; clicking a
  hint rewrites the URL through the normal filter serializer, so the result stays
  a single, shareable query. A direction such as `east` is refined in two steps:
  pick the region, then the subregion inside it.
- A place outside Hong Kong refuses the whole sentence and leaves the current
  results untouched. A bare `Tung Chung` is a district, never the railway line.

Two limits worth knowing:

- `school net 41` sets the net **name** ("Kowloon City"), because the filter
  matches names and several nets share one. It therefore covers every Kowloon
  City net, not only 41, and the disclosure says so.
- Bedroom and area filters use the latest transaction. Most estates have no
  bedroom value in the snapshot, so a bedroom filter deliberately shows a much
  smaller result set.

The box is behind a build-time flag, **off by default**:

```bash
VITE_FEATURE_NL_SEARCH=true npm run build
```

Cloudflare Pages sets the variable per environment. With the flag off the form
and the parser are tree-shaken out of the bundle, but `gazetteer.json` is still
imported for its module-level index. With the flag on the feature adds about
19.9 kB raw / 6.8 kB gzipped over the flag-off build (419.86 kB / 123.75 kB off,
439.84 kB / 130.52 kB on, measured at head). The flag is a build-time rollout switch, not a
code-splitting boundary.

An estate name in the sentence is applied as the `q` text query, which is a
substring match over estate names, district names and estate ids — so `太古城`
narrows to it, and `太古城 兩房` narrows further. That is the one case where the
parser sets free text; every other slot stays a structured filter.
Vague sizes (`small`, `middle size`, `大單位`) apply a band derived from the
snapshot quartiles, marked `(default)`, and offer neighbouring bands as hints so
the choice can be corrected without retyping; choosing a hint replaces the band
and drops the `(default)` mark. The size bands and the labelling plan are
written up in
[`docs/nl-search-development.md`](../docs/nl-search-development.md).

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
