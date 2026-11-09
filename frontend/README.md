# HK Housing Dashboard (frontend)

Static React frontend for the HK Housing Datahub serving snapshot. The first
version covers:

- dataset overview cards
- estate search with district filter, sorting, and pagination
- estate detail panel with latest transaction, 12-month stats, market date, and
  coverage flags

## Stack

- Vite
- React 18
- TypeScript
- Plain CSS (no UI framework)
- Vitest for the pure search/sort/pagination helpers

## Data contract

The app fetches, in order:

```text
{VITE_DASHBOARD_BASE_URL}/dashboard/manifest.json
{VITE_DASHBOARD_BASE_URL}/dashboard/{build_id}/{manifest.files.estate_summary}
```

It never hardcodes a build ID or file name. The published snapshot is described
in [`../docs/serving.md`](../docs/serving.md). Large data files are gzipped; the
loader lets the browser decode R2's `Content-Encoding: gzip`, and falls back to
manual `DecompressionStream` for local servers that return raw `.gz` bytes.

## Quickstart

```bash
cd frontend
npm ci
cp .env.example .env.local
# edit .env.local and set VITE_DASHBOARD_BASE_URL
npm run dev
```

`VITE_DASHBOARD_BASE_URL` must not have a trailing slash. Leave it empty when
the frontend and `/dashboard` are served from the same origin.

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
build environment; Vite bakes it into the bundle.

Deployment options: Cloudflare Pages, Netlify, GitHub Pages, or any static host.
The R2 bucket (or custom domain) must allow public reads and CORS for the
frontend origin. Do not ship write credentials to the frontend.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Current limitations

- Only the overview and estate-search views are implemented.
- No map, district trend charts, or recent-transactions table yet.
- `mart_estate_monthly` and `mart_transaction_recent` are not in the v1 snapshot.
- The snapshot is a batch-refreshed dataset, not a live feed.
- Data is scraped from third-party sources; see the root README for the
  disclaimer.
