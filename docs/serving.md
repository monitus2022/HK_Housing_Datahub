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
  coverage.json.gz
```

The three large JSON files are gzip-compressed and uploaded with
`Content-Encoding: gzip`; browsers decompress them transparently. `manifest.json`
and `overview.json` remain uncompressed so the frontend can bootstrap easily.

## Published snapshot

The Phase 6 build `20261109T164834Z-ea1321` was published to the
`hk-housing-datahub` bucket on 2026-11-10. The remote `dashboard/manifest.json`
and every referenced file were read back successfully, and the gzip/cache
headers were verified.

The frontend is deployed at <https://hk-housing.monitus.org> and reads the
snapshot through `VITE_DASHBOARD_BASE_URL`. The R2 bucket/custom domain must
allow public reads and CORS for that frontend origin. See
[`deployment.md`](deployment.md).

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
  "schema_version": 1,
  "build_id": "20261109T155827Z-abc123",
  "generated_at": "2026-11-09T15:58:27+00:00",
  "data_through": {
    "transactions": "2025-10-21",
    "market": "2025-08-31"
  },
  "coverage": {
    "estates": 9748,
    "with_transactions": 6638,
    "with_market": 5292,
    "with_wiki": 825
  },
  "row_counts": {
    "mart_estate_summary": 9748,
    "mart_district_monthly": 19352,
    "mart_estate_monthly": 591904,
    "mart_transaction_recent": 72900,
    "mart_coverage": 9748
  },
  "files": {
    "overview": "overview.json",
    "district_monthly": "district_monthly.json.gz",
    "estate_summary": "estate_summary.json.gz",
    "coverage": "coverage.json.gz"
  },
  "source": ["HKP", "Wikipedia"]
}
```

The frontend should:

1. Fetch `https://<r2-public-host>/dashboard/manifest.json`.
2. Read `files` and fetch `https://<r2-public-host>/dashboard/{build_id}/{file}`.
3. Use `data_through`, `coverage`, and `row_counts` for display labels and
   freshness warnings.
4. Show a clear fallback/error state if the manifest or a referenced file is
   missing.

The R2 bucket needs public read access (or a custom domain) and CORS for the
static-site origin. Write credentials must never be shipped to the frontend.

## What is not exported yet

`mart_estate_monthly` (~592k rows) and `mart_transaction_recent` (~73k rows) are
not in the v1 snapshot. They are good candidates for a future Parquet export if
the dashboard needs full estate-monthly history or a recent-transactions table.
The manifest can add them without changing the existing file contract.

## Legacy uploader

`CloudUploadOrchestrator.upload_files_from_data_folder()` now raises unless
constructed with `allow_raw_upload=True`. It used to upload the entire `data/`
tree, including the ~320 MB SQLite database and Chroma store. Use
`scripts/publish_dashboard.py` instead.
