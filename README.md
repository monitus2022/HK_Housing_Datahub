# HK Housing Datahub

An ETL and data-platform project for Hong Kong housing data. It crawls public
estate, building, unit, transaction, and monthly market data from the Hong Kong
Property (HKP) APIs and estate pages from Wikipedia, normalizes it into a
relational SQLite model, and builds text embeddings for retrieval-augmented
applications. The long-term goal is a small, reproducible analytics and serving
layer for a public dashboard.

> **Status:** backend tidy-up complete through Phase 8. The static frontend is a
> separate project. See [`docs/workplan-tidy.md`](docs/workplan-tidy.md),
> [`docs/decisions.md`](docs/decisions.md), and
> [`docs/roadmap.md`](docs/roadmap.md). The ML workplan is deferred.

## What it does

- Crawls HKP estate IDs, bilingual estate details, building/unit/transaction
  data, and monthly estate market statistics.
- Crawls Chinese Wikipedia estate pages, extracts section text and tables, and
  stores partition JSON files.
- Loads agency data into a normalized SQLite schema.
- Chunks wiki text and stores Sentence Transformer embeddings in ChromaDB.
- Provides read-only baseline and quality audits, five materialized analytics
  marts, and a versioned serving snapshot published to R2 for a static
  dashboard.

## Architecture

```mermaid
flowchart LR
    subgraph Sources
        HKP[HKP APIs]
        WIKI[Wikipedia API]
        RVD[RVD publications<br/>planned]
    end

    subgraph Ingestion
        AC[Agency crawlers]
        WC[Wiki crawler]
    end

    subgraph Processing
        AP[Agency processors]
        WP[Wiki processor]
        EP[Embedding pipeline]
    end

    subgraph Storage
        DB[(SQLite<br/>agency_data.db)]
        JSON[(Wiki JSON<br/>partitions)]
        CH[(ChromaDB<br/>embeddings)]
    end

    subgraph Serving
        MART[Analytics marts]
        SNAP[Versioned snapshot<br/>R2]
        DASH[Static dashboard<br/>separate frontend]
    end

    HKP --> AC --> AP --> DB
    WIKI --> WC --> WP --> JSON
    JSON --> EP --> CH
    DB --> MART --> SNAP --> DASH
    RVD -. planned .-> DB
```

More detail: [`docs/architecture.md`](docs/architecture.md).

## Data sources and current scale

| Source | Data | Current snapshot |
|---|---|---:|
| HKP | Estates | 9,748 |
| HKP | Buildings | 29,911 |
| HKP | Units | 1,229,204 |
| HKP | Transactions | 1,071,268 |
| HKP | Estate monthly market rows | 476,986 |
| HKP | Unit feature rows | 563,346 |
| Wikipedia (zh) | Estates with wiki data | 822 across 9 partitions |
| ChromaDB | Embedded wiki chunks | 3,780 |

Transaction dates span 1996-01 to 2025-10-21; monthly market data spans
1996-12 to 2025-08. The database snapshot is about 320 MB. Full coverage and
reproduction details are in [`docs/baseline-stats.md`](docs/baseline-stats.md).

Data sources:

- [Hong Kong Property](https://www.hkp.com.hk/zh-hk/list/estate)
- [Wikipedia](https://www.wikipedia.org/)
- [Rating and Valuation Department (RVD)](https://www.rvd.gov.hk/en/publications/property_market_statistics.html)
  — not implemented yet.

API payload notes: [`docs/api_endpoints.md`](docs/api_endpoints.md).

## Quickstart

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# For a test/CI-only environment without the optional RAG/cloud stack:
# pip install -r requirements-core.txt -r requirements-dev.txt

# Optional: copy the template and fill credentials only if you will upload.
cp .env.template .env

python src/main.py
```

**Current entrypoint:** `src/main.py` runs the read-only data-quality checks,
then the RAG embedding pipeline. The agency pipeline, wiki pipeline, and cloud
upload are commented out. The quality step is report-only in `main.py`; use
`scripts/run_quality.py --fail-on critical` to gate. See
[`docs/runbook.md`](docs/runbook.md) for how to run each stage and for the
known RAG rerun caveat.

### Debug mode

`AgencyOrchestrator(debug_mode=True)` limits the estate list to the first 20
estates for a faster run. It still uses the network and writes to the configured
database, so point it at a copy if you do not want to touch the reference data.
See [`docs/runbook.md`](docs/runbook.md#debug-mode) for the example and caveats.

### Docker

The repository includes a `Dockerfile` and `docker-compose.yml`:

```bash
docker-compose up --build
```

The compose file mounts `./data` and `./logs` into the container. `.dockerignore`
keeps `.env`, `data/`, `logs/`, `venv/`, and local databases out of the image
build context.

### Local data

The `data/` directory is ignored by git. A populated local checkout contains:

```text
data/
  agency/agency_data.db      # SQLite raw model (~320 MB in the reference snapshot)
  agency/estate_ids.txt      # estate ID cache
  wiki/wiki_data_partition_*.json
  chroma_db/                 # ChromaDB persistence
```

If you do not have the data, you can run the crawler (slow, network-dependent)
or use the reference payloads in `docs/api_responses/` for transformation tests.

## Pipeline stages

1. **Agency estates and market data** — fetch estate IDs, then bilingual estate
   info and monthly market statistics in partitions of 100.
2. **Agency buildings, units, and transactions** — fetch transaction data by
   building ID and map units, features, and transactions into the SQLite model.
3. **Wikipedia** — fetch estate pages, section wikitext, and tables; flush each
   partition to JSON.
4. **RAG embeddings** — clean and chunk wiki text, embed with
   `paraphrase-multilingual-MiniLM-L12-v2`, and store in ChromaDB.
5. **Serving snapshot** — build a versioned snapshot from the marts and publish
   it with `scripts/publish_dashboard.py`. The legacy raw uploader is gated
   behind `allow_raw_upload=True`.

The phase plan, guardrails, and acceptance criteria are in
[`docs/workplan-tidy.md`](docs/workplan-tidy.md).

## Data model

The data model has the following groups:

| Group | Tables |
|---|---|
| Location hierarchy | `regions`, `subregions`, `districts` |
| Estates | `estates`, `estate_school_nets`, `estate_facilities`, `estate_mtr_lines`, `estate_monthly_market_info` |
| Buildings | `phases`, `buildings` |
| Units and transactions | `units`, `unit_features`, `transactions` |
| Lookup | `facilities` |
| Run metadata | `pipeline_runs` |
| Analytics marts | `mart_estate_summary`, `mart_district_monthly`, `mart_estate_monthly`, `mart_transaction_recent`, `mart_coverage` |

- ER diagram: [`docs/db.dbml`](docs/db.dbml)
- Column-level dictionary and caveats: [`docs/data-dictionary.md`](docs/data-dictionary.md)

Key caveats: the `transactions` table has no transaction-type column and is
treated as sale transactions; `net_area` is null or non-positive for about
24.6% of units; `bedroom` is missing for about 48%; and `estate_mtr_lines` keeps
only the first MTR line per estate.

## Serving layer

The backend publishes a small versioned snapshot to R2:

```text
dashboard/manifest.json
dashboard/{build_id}/overview.json
dashboard/{build_id}/estate_summary.json.gz
dashboard/{build_id}/district_monthly.json.gz
dashboard/{build_id}/coverage.json.gz
```

The manifest is authoritative; the frontend fetches it first and then the files
in `manifest.files`. Data files are gzip-compressed, immutable, and long-cached;
the manifest pointer is short-cached. The manifest includes build ID, data-through
dates, coverage, and mart row counts.

Build/verify/publish:

```bash
make publish-dry
python scripts/verify_serving.py --snapshot-dir data/serving/{build_id}
python scripts/publish_dashboard.py --db data/agency/agency_data.db
```

Full contract: [`docs/serving.md`](docs/serving.md). A static frontend has **not**
been built yet; public R2 access and CORS still need to be configured for it.

## Repository layout

```text
src/
  crawlers/       # agency and wiki HTTP clients
  processors/     # response-to-table mapping, wiki parsing, RAG embeddings
  models/         # Pydantic response/output models and SQLAlchemy tables
  orchestrators/  # pipeline entry points
  analytics/      # mart builder and ordered SQL files
  quality/        # read-only data-quality checks and reports
  serving/        # versioned snapshot builder, verifier, and publisher
  config/         # YAML config, Pydantic settings, env loading
  main.py         # current runnable entry point
docs/             # workplans, decisions, roadmap, API docs, schema, runbooks
scripts/          # baseline, quality, mart, and serving CLIs
data/             # local data, ignored
```

## Configuration

- Runtime configuration: [`src/config/config.yml`](src/config/config.yml)
- Environment template: [`.env.template`](.env.template)
- Settings: `src/config/settings.py`

Cloud credentials are **lazy**: importing the config, constructing the upload
orchestrator, and running local data processing do not require `.env`. The
serving publish path validates credentials only when an upload is attempted and
raises a clear error naming the missing keys. The legacy raw-data uploader is
gated behind `allow_raw_upload=True`.

## Checks

```bash
# Read-only database audit
python3 scripts/baseline_stats.py

# Data quality (read-only; writes data/quality/)
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

# Analytics marts (writes mart_* tables and indexes to the DB)
python scripts/build_marts.py --db data/agency/agency_data.db

# Serving snapshot (local build only; no credentials)
python scripts/publish_dashboard.py --db data/agency/agency_data.db --dry-run
python scripts/verify_serving.py --snapshot-dir data/serving/{build_id}

# Dev tooling: pytest and ruff
pip install -r requirements-dev.txt

# Fixture/DB tests: upserts, run metadata, quality, mapping, marts, serving
pytest -q

# Lint the files touched by the tidy-up so far
ruff check src/main.py src/analytics src/quality src/serving src/processors/agency src/models/agency/sql_db.py src/orchestrators scripts tests

# Optional shortcuts
make test
make lint
make quality
make marts
make publish-dry
```

`tests/` contains the Phase 2–6 tests (57 total): upserts, run metadata,
quality checks, response-model parsing, table mapping, duplicate-input dedupe,
synthetic mart builds, and serving manifest/publish planning. The
boto3-only legacy-upload gate test is skipped in the core-only CI environment.
The CI workflow
in `.github/workflows/ci-cd.yml` installs `requirements-core.txt` +
`requirements-dev.txt` and runs the same tests and lint. Quality details are in
[`docs/quality.md`](docs/quality.md); mart grains are in
[`docs/data-dictionary.md`](docs/data-dictionary.md#analytics-marts); the
serving contract is in [`docs/serving.md`](docs/serving.md).

## Known limitations

- Scraped third-party data; not an official or authoritative source.
- RVD integration is not implemented.
- The transaction table has no sale/rent type; it is treated as sales.
- Significant nulls: `net_area` (302,139 units null or `<= 0`), `bedroom`
  (591,313 null), missing coordinates (632 estates), missing `first_op_date`
  (892 estates).
- Agency SQLite writes are idempotent as of Phase 2: they use SQLite upserts and
  record run metadata in `pipeline_runs`. Rerunning a partition leaves row
  counts unchanged and refreshes non-key columns.
- RAG reruns are not idempotent: Chroma `collection.add()` skips IDs that
  already exist, so changed chunks are not refreshed. Use a fresh collection or
  `upsert` for a rebuild. Tracked in issue #17.
- The reference DB currently has 160 `buildings.phase_id -> phases.phase_id`
  orphan rows. The quality CLI with `--fail-on critical` exits non-zero until
  the mapping or data is repaired; `src/main.py` runs the checks in report-only
  mode.
- The legacy raw uploader is disabled by default; when explicitly enabled it
  walks all of `data/`, including the SQLite database and Chroma store. Do not
  point it at a public bucket.
- No live API. The serving layer is a versioned snapshot, not a query service.
- No frontend is included in this repository. The R2 bucket still needs public
  read access (or a custom domain) and CORS for the frontend origin.
- The reference snapshot ends 2025-10-21; the project does not run on a
  schedule yet.
- CI installs core dependencies only; the optional RAG and cloud-upload code is
  not exercised in CI.
- The 12- and 24-month mart windows are relative to the latest transaction date
  in the snapshot, not today. `has_wiki` is an exact Chinese-name match.
- `mart_estate_monthly` (~592k rows) and `mart_transaction_recent` (~73k rows)
  are not in the v1 serving snapshot; a future Parquet export can add them.
- The v1 snapshot gzips its three large JSON files (~950 KB total). The
  frontend must use the manifest `files` mapping rather than hardcoding names.
- The data is not inflation-adjusted and the ML work is deferred.

## Roadmap

1. Phase 0–8: baseline, repo presentation, config safety, idempotent upserts,
   quality checks, tests/CI, analytics marts, serving snapshot/publish, and
   final handoff. *(implemented; see PRs #24–#30 and the Phase 8 PR)*
2. Phase 7: optional sample database. *(deferred)*
3. Frontend and R2 public access/CORS.
4. Incremental crawls, RVD integration, monitoring, and Parquet serving
   exports. See [`docs/roadmap.md`](docs/roadmap.md).
5. ML: hedonic price model, deferred from `docs/workplan-ml.md`.

Architecture trade-offs are recorded in
[`docs/decisions.md`](docs/decisions.md).

## Disclaimer

All data listed in examples is public and owned by Hong Kong Property. This
project is for educational and non-commercial use only. Please refer to the
[HKP Terms of Service](https://www.hkp.com.hk/disclaim.html). The maintainers
make no warranty about accuracy, completeness, or fitness for any purpose.
