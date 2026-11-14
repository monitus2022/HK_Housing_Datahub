# Runbook

Operational notes for running, resuming, and troubleshooting the datahub. For
architecture and schema details, see
[`architecture.md`](architecture.md) and
[`data-dictionary.md`](data-dictionary.md).

## Current entrypoint

`src/main.py` is a manual toggle board. The current state is:

- **Enabled:** read-only data-quality checks, then the RAG embedding pipeline.
- **Disabled:** agency pipeline, wiki pipeline, cloud upload.

That is why `python src/main.py` reports quality and processes wiki embeddings,
but does not refresh the SQLite database. The quality step is report-only in
`main.py`; use `scripts/run_quality.py --fail-on critical` to gate.

**RAG reruns are idempotent.** The embedding pipeline writes chunks with Chroma
`upsert()` and, after a complete run, deletes stored IDs that are not in the
current wiki source. Chunk IDs are a SHA-1 of estate name, section title, and
chunk index, so edited text refreshes in place and removed sections disappear.
If any wiki file fails to load, pruning is skipped so valid chunks are not
deleted; the log reports which files failed. Pruning is also skipped when a
run produces no chunks at all, which usually signals a schema drift rather
than an empty corpus. See issue #17.

## Local setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Only needed for cloud upload; local data processing works without it.
cp .env.template .env
```

The reference data is in `data/` and is gitignored. The agency database is about
518 MB.

## Run the stages

The orchestrator methods can be called directly from Python with `src` on the
path. Run from the repo root.

### Agency pipeline (network, long)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import AgencyOrchestrator

orchestrator = AgencyOrchestrator(
    debug_mode=False,
    keep_latest_transaction_only=False,
)
orchestrator.run_estates_info_data_pipeline()
PY
```

### Wiki pipeline (network, writes partition JSON)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import WikiOrchestrator

WikiOrchestrator().run_estate_wiki_data_pipeline()
PY
```

### RAG embeddings (CPU; rebuild caveat above)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import RAGOrchestrator

RAGOrchestrator().run_text_embedding_pipeline()
PY
```

### Legacy cloud upload (disabled by default)

The raw uploader now refuses to run unless explicitly enabled:

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import CloudUploadOrchestrator

CloudUploadOrchestrator(allow_raw_upload=True).upload_files_from_data_folder()
PY
```

It walks all of `data/`, including the SQLite database and Chroma store, and
skips hidden files/directories. It is not the serving path. Use
`scripts/publish_dashboard.py` for the versioned snapshot, and do not point the
raw uploader at a public bucket.

## Frontend development and deployment

Live: <https://hk-housing.monitus.org>

```bash
# Serve a local snapshot with CORS/gzip headers
python scripts/serve_snapshot.py \
  --snapshot-dir data/serving/{build_id} \
  --port 8787

# In another terminal
cd frontend
cp .env.example .env.local
# set VITE_DASHBOARD_BASE_URL=http://localhost:8787
npm ci
npm run dev
```

Cloudflare Pages production settings: React (Vite), root `frontend`, build
`npm ci && npm run build`, output `dist`, Node 22, and
`VITE_DASHBOARD_BASE_URL=https://hk-housing-datahub.monitus.org`. Vite bakes the
variable at build time, so changing it requires a redeploy. The snapshot host
is <https://hk-housing-datahub.monitus.org>; full setup, CORS, and
troubleshooting: [`deployment.md`](deployment.md).

## Pipeline progress and status

The agency pipeline logs one INFO line after each estate/building partition:

```text
estate info: partition 32/98 (33%), 3,200/9,750 items, elapsed 24m 10s, ETA 49m 28s
```

Console output and `logs/hk_housing_datahub.log` use `LOG_LEVEL` (default
`INFO`). Export it in the shell (the logger is configured before `.env` is
loaded, so a `.env` entry will not take effect). `LOG_LEVEL=DEBUG` restores the
full payload dumps. A failure line names the stage, partition, and current
estate/building id.

Watch a running crawl:

```bash
tail -f logs/hk_housing_datahub.log
```

The same progress is mirrored to `data/agency/pipeline_status.json` and updated
atomically after each partition:

```bash
cat data/agency/pipeline_status.json
```

It contains `run_id`, `mode`, `status` (`running`/`success`/`failed`), `stage`,
`partition`, `partitions`, `items_done`, `items_total`, `percent`,
`started_at`, `updated_at`, `finished_at`, `elapsed_seconds` (run),
`stage_elapsed_seconds`, `eta_seconds`, and `error`. The ETA is computed from
the current stage's elapsed time, so it resets when the run moves from estates
to buildings. The file is safe to read from another process and lives under the
gitignored `data/` tree. A failure to write it logs a warning and never aborts
the crawl.

## Debug mode

`AgencyOrchestrator(debug_mode=True)` limits the estate list to the first 20
estates. It still makes live network requests and still writes to the configured
database, so use a copy if you do not want to touch the reference DB.

```python
orchestrator = AgencyOrchestrator(debug_mode=True)
```

For a truly offline smoke test, use the payload fixtures under
`docs/api_responses/` and the processor methods directly. The current `tests/`
suite covers response parsing, table mapping, duplicate-input dedupe, upserts,
run metadata, quality checks, mart builds, pipeline progress/status reporting,
and serving manifest/publish planning, all with fixtures and temporary SQLite
databases.

## Resume and rerun behaviour

Current behaviour:

- Estate IDs are cached in `data/agency/estate_ids.txt`. If the file exists and
  `force_refetch_estate_ids` is false, the crawler reuses it.
- Agency writes use SQLite upserts keyed on the model primary key. Rerunning a
  partition leaves row counts unchanged and refreshes non-key columns. Duplicate
  keys inside one batch are handled by the upsert.
- The old process-local `pk_sets` deduplication was removed; duplicate inputs
  are now absorbed by the upsert instead of growing an in-memory set.
- `close_session()` is called once at the end of the agency pipeline, not inside
  the per-partition building loop.
- Each pipeline run gets a UUID and a row in `pipeline_runs` with start/end
  timestamps, mode, status, record counts, and any error message.
- RAG writes are idempotent: chunks are upserted, and IDs that disappeared from
  the wiki source are pruned after a complete run (issue #17).
- Wiki partition files are overwritten per partition, but the aggregated file
  is overwritten at the end of a successful run.

Reruns against the same SQLite database are safe for the agency tables. RAG
reruns converge to the current wiki source; they no longer need a fresh Chroma
path.

## Inspect data

Read-only table counts and coverage:

```bash
python3 scripts/baseline_stats.py
```

Ad-hoc SQL (read-only):

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("file:data/agency/agency_data.db?mode=ro", uri=True)
for row in con.execute("select count(*) from transactions"):
    print(row)
PY
```

## Quality reports

Run the checks (read-only):

```bash
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical
```

Outputs:

```text
data/quality/latest.json
data/quality/{run_id}.json
data/quality/latest.md
```

The JSON report contains a `summary` block and a `checks` array. Exit code `1`
means the selected gate failed; `2` means the database is missing. Use
`--fail-on warning` to gate on warnings too, or `--fail-on none` for a
report-only run.

`src/main.py` calls the checks in report-only mode before the RAG step. The
refreshed reference DB reports 0 critical findings and three warnings
(non-positive areas, estate coverage, transaction estates without market
data). Older databases can still have the 160 `buildings.phase_id ->
phases.phase_id` orphans cleared by the repair below. See
[`quality.md`](quality.md) for the check list and thresholds.

### Repair orphan phase IDs

A non-null `buildings.phase_id` must reference a real `P…` phase (it is `NULL`
for estates with no phase). Older ingests copied the API's pseudo-phase id
(often the estate id) into `phase_id`, leaving `E…` orphans. The mapper no
longer does this. Repair an existing database with:

```bash
# Back up first: --apply nulls rows.
cp data/agency/agency_data.db data/agency/agency_data.db.bak

# Inspect only; prints the orphan count and affected estates.
python scripts/repair_orphan_phase_ids.py --db data/agency/agency_data.db

# Null the orphan values in one transaction.
python scripts/repair_orphan_phase_ids.py --db data/agency/agency_data.db --apply

# Confirm the critical gate is clear.
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical
```

The script is idempotent and only nulls `phase_id` values with no matching
`phases` row. On a pre-refresh database it reports 160 rows across 10 estates;
the refreshed reference DB reports 0 and leaves the three warnings unchanged.
Exit codes: `0` means no orphans remain (including a clean DB), `1` means
orphans remain (for example a dry run on a pre-refresh database), and `2`
means the database is missing, unreadable, or lacks the `buildings`/`phases`
tables.

## Build analytics marts

The mart builder writes derived tables and indexes to the agency database:

```bash
python scripts/build_marts.py --db data/agency/agency_data.db --wiki-dir data/wiki
# or
make marts
```

It rebuilds:

```text
mart_estate_summary       one row per estate
mart_district_monthly     district x month
mart_estate_monthly       estate x month (full sale history + ~3y rent, ~245k rows)
mart_transaction_recent   last 24 months
mart_coverage             one row per estate
mart_district_price_bands district x month p25/median/p75 for sale and rent
mart_segment_summary      trailing-12-month medians by segment
```

The builder drops and recreates the `mart_*` tables and creates idempotent raw
and mart indexes. Existing rows and values are preserved; missing raw tables and
nullable additive columns (currently transaction sale type) may be added. `has_wiki` comes from the wiki JSON estate names; missing wiki
data simply sets it to 0. Windows end at the later of the latest sale and rental dates in the
snapshot. Grains and columns are in
[`data-dictionary.md`](data-dictionary.md#analytics-marts).

## Refresh RVD benchmarks

The Rating and Valuation Department publishes five historical XLS workbooks.
Download and replace the benchmark tables:

```bash
python scripts/fetch_rvd.py --db data/agency/agency_data.db --source-dir data/rvd
# parse files already in data/rvd without downloading
python scripts/fetch_rvd.py --db data/agency/agency_data.db --source-dir data/rvd --skip-download
```

This writes `rvd_rents`, `rvd_prices`, `rvd_indices`, and `rvd_yields` with a
full refresh. The importer refuses to replace the tables when the parsed row
counts are suspiciously low, so a broken or changed workbook cannot silently
empty the benchmarks. The files are official aggregate benchmarks, not HKP
transaction records; grains and caveats are in
[`data-dictionary.md`](data-dictionary.md#rvd-benchmarks).

## Backfill transaction sale types

HKP sale types (`mkt_type`: 1 first hand, 2 second hand, MH group) are stored
on new ingests. Existing rows need a targeted building-level refetch:

```bash
# Trial: fetch two buildings, report matches, do not update
python scripts/backfill_sale_types.py --db data/agency/agency_data.db \
  --limit-buildings 2 --dry-run --delay 0

# Full backfill (about 30k buildings; rate-limited by --delay)
cp data/agency/agency_data.db data/agency/agency_data.db.pre-sale-types.bak
python scripts/backfill_sale_types.py --db data/agency/agency_data.db --delay 0.1
```

The script updates existing transactions by `tx_id`, never inserts rows, and
reports `source_updates`, `matched`, `updated`, `unmatched`, and
`remaining_null`. `updated` counts matched rows touched (SQLite rowcount), so a
rerun still reports updates even though the values are unchanged; data is
idempotent. Dry runs do not alter the schema. This is not a full estate or wiki
crawl.

## Build and publish serving data

Build the local snapshot without credentials:

```bash
python scripts/publish_dashboard.py --db data/agency/agency_data.db --dry-run
# or
make publish-dry
```

Output is written under `data/serving/{build_id}/`:

```text
manifest.json
overview.json
estate_summary.json.gz
district_monthly.json.gz
transaction_recent.json.gz
estate_monthly.json.gz
coverage.json.gz
```

Verify every manifest reference:

```bash
python scripts/verify_serving.py --snapshot-dir data/serving/{build_id}
```

Publish to the configured bucket:

```bash
python scripts/publish_dashboard.py --db data/agency/agency_data.db
```

The publisher needs cloud credentials, uploads versioned files first, then
`dashboard/{build_id}/manifest.json`, and finally the short-cache
`dashboard/manifest.json` pointer. Data files are cached immutably; the manifest
is cached for 60 seconds. Gzip data files are uploaded with
`Content-Encoding: gzip`. See [`serving.md`](serving.md) for the full contract.

The legacy raw-data uploader now raises unless constructed with
`allow_raw_upload=True`; use the serving publisher instead.

## Tests and checks

```bash
# Test environment (core + dev; includes ChromaDB, no embedding model)
pip install -r requirements-core.txt -r requirements-dev.txt

# Available now
python3 scripts/baseline_stats.py
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none
python scripts/fetch_rentals.py --db data/agency/agency_data.db
python scripts/build_marts.py --db data/agency/agency_data.db
python scripts/publish_dashboard.py --db data/agency/agency_data.db --dry-run
pytest -q
ruff check src tests

# Shortcuts
make test
make lint
make quality
make quality-strict
make marts
make publish-dry
```

`tests/` contains 115 tests: Phase 2–6, catalogue, wiki, RVD, and backfill coverage (upserts, run
metadata, quality checks, response models, table mapping, duplicate-input dedupe, synthetic mart
builds, serving manifest/publish planning), phase-id mapping and repair, plus
offline RAG storage tests for upsert/prune idempotency. The boto3-only
legacy-upload gate test skips because
CI does not install the cloud extra. The CI workflow
(`.github/workflows/ci-cd.yml`) installs core + dev (including ChromaDB),
checks that `config` imports without `.env`, compiles, runs `pytest`, and runs
ruff on the touched modules.

## Release handoff

Before merging `dev` → `main`:

```bash
make test
make lint
make quality
make marts
make publish-dry
python scripts/verify_serving.py --snapshot-dir data/serving/{build_id}
```

Optionally publish:

```bash
python scripts/publish_dashboard.py --db data/agency/agency_data.db
```

A human performs the `dev` → `main` merge. Agents never merge `main` or
force-push it. Architecture decisions and remaining work are in
[`decisions.md`](decisions.md) and [`roadmap.md`](roadmap.md).

## Common failures

| Symptom | Likely cause | Action |
|---|---|---|
| `ModuleNotFoundError: config` | `src` is not on `sys.path` | Run from the repo root with `sys.path.insert(0, "src")`, or use `python src/main.py` (which puts `src` on the path). |
| `Missing cloud storage credentials` | Upload attempted without `.env` keys | Set `cloud_storage_access_key_id`, `cloud_storage_secret_access_key`, and `cloudflare_account_id` (for R2) in `.env`. Local processing does not need them. |
| RAG rerun leaves chunks from a wiki file that failed to load | Pruning is skipped when any input file fails | Fix the failing file (see the logged filename) and rerun; valid chunks are untouched |
| Quality gate exits 1 with `buildings.phase_id -> phases.phase_id` orphans | Building rows use a source "phase" that is not a real phase | Run `python scripts/repair_orphan_phase_ids.py --db data/agency/agency_data.db --apply` (back up first); the mapper no longer writes pseudo-phase ids. |
| `database is locked` | Concurrent SQLite writers | Use one writer at a time; WAL helps readers but does not allow concurrent writers. |
| Estate returns 404 | Estate removed or unavailable | The crawler logs and skips; rerun later or inspect the ID list. |
| Building returns 502 | Source API transient failure | The shared request wrapper retries 3 times with a 2 s pause; rerun the building partition later. |
| No wiki page found | Title variation/disambiguation/HK check failed | Inspect the estate name; the crawler tries Chinese title variations and skips ambiguous pages. |
| Wiki partition is empty | All estates in the partition failed | Check the logs and network; rerun that partition after fixing the source issue. |
| `.env` missing | Local config | Not required for imports or local processing; copy `.env.template` only when using cloud upload. |

## Logs

Logs go to the console and to `logs/hk_housing_datahub.log`. Both use
`LOG_LEVEL` (default `INFO`; set `LOG_LEVEL=DEBUG` for payload dumps). `logs/`
is gitignored.

## Safety rules

- Do not commit `data/`, `*.db`, `.env`, `logs/`, `venv/`, or `.DS_Store`.
- Do not run the full crawl just to test a transformation; use fixtures.
- Do not modify the reference `agency_data.db`; copy it first.
- Do not upload the raw `data/` tree to a public bucket.
- Do not merge a PR to `main` from an agent session; a human does that.
