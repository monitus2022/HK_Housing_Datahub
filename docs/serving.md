# Serving Snapshot

The serving layer exports a small, versioned snapshot from the analytics marts.
It is designed for a static dashboard: the frontend fetches a manifest, then the
files the manifest references.

## Build and verify locally

```bash
# Build a local snapshot and print the upload plan; no credentials needed.
python scripts/publish_dashboard.py --dry-run

# Verify the latest local snapshot directory.
python scripts/verify_serving.py --snapshot-dir data/serving/{build_id}
```

Output:

```text
data/serving/{build_id}/
  manifest.json
  overview.json
  estate_summary.json.gz
  district_monthly.json.gz
  transaction_recent.json.gz
  estate_monthly.json.gz
  district_price_bands.json.gz
  segment_summary.json
  rvd_benchmarks.json.gz
  catalog.json
  coverage.json.gz
```

The large data files are gzip-compressed and uploaded with
`Content-Encoding: gzip`; browsers decompress them transparently. `manifest.json`,
`overview.json`, and `catalog.json` remain uncompressed so the frontend can
bootstrap and load the catalogue without extra decoding.

## Published snapshot

Build `20261113T070357Z-8fc5d3` (`schema_version` 6) is the current published
snapshot in the `hk-housing-datahub` bucket. It superseded
`20261112T090805Z-61f72e` as the pointer on 2026-11-13. It carries the refreshed
dataset (transactions through 2026-11-08, rentals through 2026-11-10, market
data through 2026-09-30, 9,750 estates), `catalog.json` (~32 KB across 6
datasets and 23 tables) with `wiki_title` for 824 estates, and adds
`district_price_bands.json.gz` (~340 KB) and `segment_summary.json` (~14 KB).
It includes `transaction_recent.json.gz` (~2.1 MB gzipped for 87,393 display
rows) and `estate_monthly.json.gz` (~1.3 MB), taking the snapshot to ~5.0 MB. The remote
`dashboard/manifest.json` and every referenced file were read back successfully;
the gzip, cache, and CORS headers were verified.

The snapshot is public at <https://hk-housing-datahub.monitus.org>. The frontend
is deployed at <https://hk-housing.monitus.org> and reads the snapshot through
`VITE_DASHBOARD_BASE_URL`. R2 public read and CORS for that frontend origin are
configured; see [`deployment.md`](deployment.md) for the current build/env
status and troubleshooting.

## Publish

```bash
python scripts/publish_dashboard.py --db data/agency/agency_data.db
```

Without `--dry-run`, the publisher:

1. Requires cloud credentials from `.env` (same lazy `CloudStorageSecrets` used
   by the legacy uploader).
2. Validates the bucket name.
3. Uploads versioned data files under `dashboard/{build_id}/`.
4. Uploads `dashboard/{build_id}/manifest.json`.
5. Uploads the short-cache pointer `dashboard/manifest.json` **last**.

Cache headers:

| File | Cache-Control |
|---|---|
| `dashboard/manifest.json` | `public, max-age=60` |
| `dashboard/{build_id}/manifest.json` | `public, max-age=60` |
| `dashboard/{build_id}/*.json` / `*.json.gz` | `public, max-age=31536000, immutable` |

Content types: JSON data is `application/json`; gzip files also carry
`Content-Encoding: gzip`. Credentials are never logged.

## Manifest contract

```json
{
  "schema_version": 7,
  "build_id": "20261201T000000Z-example",
  "generated_at": "2026-12-01T00:00:00+00:00",
  "data_through": {
    "transactions": "2026-11-08",
    "market": "2026-09-30"
  },
  "coverage": {
    "estates": 9750,
    "with_transactions": 6792,
    "with_market": 5531,
    "with_wiki": 824
  },
  "row_counts": {
    "mart_estate_summary": 9750,
    "mart_district_monthly": 19840,
    "mart_estate_monthly": 245017,
    "mart_transaction_recent": 87393,
    "mart_coverage": 9750,
    "mart_district_price_bands": 19791,
    "mart_segment_summary": 43
  },
  "files": {
    "overview": "overview.json",
    "district_monthly": "district_monthly.json.gz",
    "estate_summary": "estate_summary.json.gz",
    "transaction_recent": "transaction_recent.json.gz",
    "estate_monthly": "estate_monthly.json.gz",
    "district_bands": "district_price_bands.json.gz",
    "segment_summary": "segment_summary.json",
    "rvd_benchmarks": "rvd_benchmarks.json.gz",
    "catalog": "catalog.json",
    "coverage": "coverage.json.gz"
  },
  "source": ["HKP", "Wikipedia"]
}
```

The frontend should:

1. Fetch `https://hk-housing-datahub.monitus.org/dashboard/manifest.json`.
2. Read `files` and fetch
   `https://hk-housing-datahub.monitus.org/dashboard/{build_id}/{file}`.
3. Load `estate_summary` and `district_monthly` eagerly for the default
   Overview. Load `transaction_recent` when the top-estates panel approaches
   the viewport; load `estate_monthly`, `district_bands`, `segment_summary`,
   and `catalog` when their views are opened.
4. Use `data_through`, `coverage`, and `row_counts` for display labels and
   freshness warnings. `data_through` covers sale and market dates; rental
   freshness is not a separate field, but rental months are included in the
   district and estate monthly files.
5. Show a clear fallback/error state if the manifest or a referenced file is
   missing. A missing optional file should not take down the rest of the page.

The R2 bucket allows public reads and CORS for the static-site origin. Write
credentials must never be shipped to the frontend.

## Recent transactions export

`mart_transaction_recent` is exported as `transaction_recent.json.gz` (~2.1 MB
gzipped for 87,393 rows). Only display columns are exported: `tx_date`, `price`,
`net_ft_price`, `estate_id`, `estate_name_en`, `district_id`,
`district_name_en`, `area`, `net_area`, and `bedroom`. Internal join keys
(`tx_id`, `building_id`, `unit_id`) stay in SQLite. The manifest can add further
files without changing the existing contract.

## Estate monthly export

`mart_estate_monthly` is exported as `estate_monthly.json.gz`: ~5.1 MB
uncompressed, ~1.3 MB gzipped. It is loaded once, lazily, when an estate view
opens. In a desktop Node 22 check,
gzip decompression plus JSON parse took about 43 ms (median of five runs).

To keep the file compact, months are stored once and each estate maps to a list
of `[month_index, tx_count, avg_net_ft_price, rent_tx_count, avg_net_ft_rent]`
points:

```json
{
  "months": ["1996-01", "1996-02"],
  "estates": {
    "E000004419": [[0, 3, 12000.0, 2, 42.0], [1, 1, 11800.0, 1, 43.5]]
  }
}
```

Months with at least one sale or rental are kept. Missing or non-positive
prices/rents are stored as `0` and the frontend drops them from the matching
series. The file is loaded lazily when an
estate view opens; the frontend only reads the requested estate.

## District price bands export

`mart_district_price_bands` is exported as `district_price_bands.json.gz`:
one row per district × month with sale and rent p25/median/p75 and a
gross-yield proxy. Percentiles use positive net-ft prices and nearest-rank
positions. The frontend loads it in Trends; months without positive
transactions are absent and the chart connects the available months.

## Segment summary export

`mart_segment_summary` is exported as plain `segment_summary.json` (about 14 KB):
trailing-12-month sale and rent medians by bedroom, area band, estate age band,
MTR line, and school net. MTR and school-net rows overlap because an estate can
map to multiple lines or nets; `Unknown` groups cover missing bedroom, area, or
age values. The frontend hides `Unknown` and marks groups under 20
transactions as low sample.

## RVD benchmark export

`rvd_benchmarks.json.gz` is a gzipped object with four arrays: `rents`,
`prices`, `indices`, and `yields`. Rents and prices carry region × property
class × month rows; indices are territory-wide by class; yields are class-only.
All include provisional flags and `NULL` suppressed values. The frontend presents it as a
separate benchmark — never as an estate-level match. If the RVD tables are
absent, the snapshot writes empty arrays and the panel shows an empty state.

Schema 7 adds the RVD benchmark export used by the Trends benchmark panel.
Schema 6 added the monthly district price bands and segment summary. Schema 5
added `catalog.json` and `wiki_title`. The current published build is schema 6;
a schema-6 pointer has no RVD benchmarks, so that panel shows a missing-file
message. A schema-5 pointer has no bands/segments either. A schema-4
pointer also serves no catalogue, so the Catalogue view shows a missing-file
message and its wiki badges stay non-links; older schema-3/2 snapshots without
`estate_monthly` still work, with a section-level message for missing history.

## Data catalogue export

`catalog.json` is a static snapshot of `metadata/catalog.yml` merged with live
SQLite introspection, the latest quality report, and the serving manifest. It
describes each dataset (purpose, layer, source, refresh, licence, owner,
caveats), each table (description, grain, row count, columns, null counts,
foreign keys), and summary freshness/quality metadata. Regenerate the JSON and
the Markdown data cards with:

```bash
python scripts/build_catalog.py --db data/agency/agency_data.db
```

The generator reads the database in read-only mode and fails when a table has
no curated metadata, which keeps the catalogue from drifting behind new tables;
add an entry to `metadata/catalog.yml` before publishing a snapshot that adds a
table. `docs/data-catalog.md` is generated from the same data; edit
`metadata/catalog.yml` rather than the Markdown. Pass `--generated-at` to pin the
timestamp when byte-for-byte reproducible output is needed. The quality report
and manifest merge are best-effort: a missing `data/quality/latest.json` leaves
`quality` null, while the snapshot catalogue always embeds its own manifest. The
frontend loads `catalog.json` lazily from the manifest when the Catalogue view
opens.

## What is not exported yet

Nothing large remains: `mart_estate_monthly` is now exported compactly. A
Parquet export could still be considered for external analytics, but the
dashboard no longer needs it.

## Legacy uploader

`CloudUploadOrchestrator.upload_files_from_data_folder()` now raises unless
constructed with `allow_raw_upload=True`. It used to upload the entire `data/`
tree, including the ~320 MB SQLite database and Chroma store. Use
`scripts/publish_dashboard.py` instead.
