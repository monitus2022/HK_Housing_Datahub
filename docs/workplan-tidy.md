# Datahub Tidy-Up Workplan

> **Agent instruction:** Read this file fully before changing code. Work on a
> per-phase branch `chore/tidy-phase-<N>-<slug>` created from `dev`. Complete
> phases in order. Make one focused PR per phase, run the listed checks, and stop
> to report after each phase. Do not refetch the full dataset. Do not commit
> `data/`, `.env`, databases, logs, or secrets.

## 1. Mission

Turn `HK_Housing_Datahub` from a working prototype into a legible, reliable
portfolio-grade batch data platform:

- A reviewer can understand the architecture and data model in five minutes.
- The pipeline is idempotent and safe to rerun.
- Data quality is checked and reported, not assumed.
- The transformation layer has tests and CI.
- Analytics marts and a small serving layer are produced for a public dashboard.
- The README states what the project does, its scale, its limitations, and how to run it.

This is a **tidy-up**, not a rewrite. Preserve the existing crawler behaviour and
data model unless a change is required for the tasks below.

## 2. Current state (verified 2026-11-09)

Repository: `HK_Housing_Datahub`

- Active branch: `dev` @ `92bc704`. `origin/main` already contains `dev` plus
  the merge commits through PR #12; `origin/main` is 3 commits ahead of `dev`
  and `origin/main..dev` is empty. The local `main` ref is stale (33 commits
  behind `origin/main`), so run `git fetch` and compare against `origin/main`.
  The default branch is `main`.
- There was an uncommitted change in `src/main.py` that enables the RAG
  embedding pipeline and disables the cloud upload. It is preserved in the
  Phase 0 commit; do not silently revert it.
- Entry point: `src/main.py` (pipeline stages are commented in/out).
- Structure:
  - `src/crawlers/agency/*`, `src/crawlers/wiki/*`
  - `src/processors/agency/*`, `src/processors/wiki/*`, `src/processors/rag/embedding.py`
  - `src/models/agency/*`, `src/models/wiki/*`, `src/models/rag/*`
  - `src/orchestrators/*`
  - `src/config/config.yml`, `src/config/settings.py`
  - `docs/db.dbml`, `docs/api_responses/*`, `docs/api_endpoints.md`
- Data currently in `data/agency/agency_data.db` (not committed):
  - 9,748 estates
  - 29,911 buildings
  - 1,229,204 units
  - 1,071,268 transactions
  - 476,986 estate monthly market rows
  - 563,346 unit features
  - 822 wiki estates across 9 partitions; 3,780 Chroma chunks
- Known problems:
  - No `tests/` directory; `.github/workflows/ci-cd.yml` is empty.
  - `bulk_insert_cache_into_db_tables()` uses `bulk_save_objects()` with no upsert.
  - Deduplication uses in-memory `pk_sets` only; reruns are not safe/incremental.
  - No data-quality checks, no run metadata, no orchestration entrypoint.
  - Cloud upload has failed in previous runs (`Invalid endpoint`,
    `Unable to locate credentials`, invalid bucket name).
  - Config instantiates `CloudStorageSecrets()` at import time, so tests/imports
    require cloud credentials. This must be decoupled.
  - `data/` and secrets are correctly gitignored; keep it that way.

## 3. Guardrails

- Do **not** run the full crawl. It is long, network-dependent, and unnecessary.
  Use the existing SQLite DB read-only and the JSON fixtures under
  `docs/api_responses/`.
- Do **not** delete or overwrite `data/agency/agency_data.db`. If a schema or
  data experiment is required, copy it to a temp path first.
- Do **not** change table or column names in a way that breaks the existing DB.
  Add new tables/views instead. If a column must be added, use a migration and
  document it.
- Do **not** add heavy infrastructure (Kafka, Spark, Airflow). A simple
  orchestrator or cron entrypoint is enough.
- Keep the existing public interfaces: `src/main.py`, config keys, model names,
  and orchestrator method names should keep working.
- Do not commit `.env`, `data/`, `logs/`, `*.db`, `venv/`, or `.DS_Store`.
- Pin no new runtime dependency unless necessary. Prefer the standard library,
  existing SQLAlchemy, pandas, boto3, and pydantic.
- If a phase requires a destructive git operation or a live credential, stop and
  report instead of guessing.

## 4. Definition of done

- `pytest` passes locally and in CI without network access or cloud credentials.
- Re-running a fixture batch twice leaves table row counts unchanged.
- A data-quality report is generated, and critical failures cause a non-zero exit.
- Analytics marts exist and are documented.
- A serving snapshot with `manifest.json` is generated; R2 upload supports
  `--dry-run` and works with valid credentials.
- README explains architecture, data volumes, quickstart, serving layer, and
  limitations.
- No secrets or data files are committed.
- `dev` contains the tidy-up; `main` is updated (or a PR to `main` is open).

## 5. Phases

### Phase 0 — Baseline and safety

Tasks:

1. Create branch `chore/tidy-phase-0-baseline` from `dev` (one phase per
   branch; see `AGENTS.md`).
2. Record the current state:
   - `git status`, `git log --oneline -10`.
   - Run a read-only SQLite script that prints table counts and date ranges.
   - Save the numbers in `docs/baseline-stats.md` (no secrets).
3. Open the existing DB read-only and confirm the counts in section 2.
4. Inspect `src/main.py` and decide how to preserve the current uncommitted
   RAG/cloud-upload toggle. Do not silently revert it.

Acceptance:

- Branch exists.
- `docs/baseline-stats.md` contains table counts, date ranges, and coverage.
- No data or secrets changed.

### Phase 1 — Repo presentation and config safety

Tasks:

1. Rewrite `README.md` with:
   - One-paragraph description.
   - Architecture diagram (Mermaid) showing sources → crawlers → processors →
     SQLite/Chroma → marts → serving snapshot → dashboard.
   - Data sources and volumes.
   - Quickstart (venv, requirements, `.env`, debug mode).
   - Pipeline stages and how to run each.
   - Data model summary and a link to `docs/db.dbml`.
   - Current limitations and roadmap.
   - Disclaimer for third-party data.
2. Add `docs/architecture.md` with module responsibilities and data flow.
3. Add `docs/data-dictionary.md` describing each table, key columns, and
   relationships. Reuse `docs/db.dbml`; do not duplicate it blindly.
4. Add `docs/runbook.md` covering:
   - how to run in debug mode,
   - how to resume/rerun,
   - how to inspect quality reports,
   - how to publish serving data,
   - common failures (404 estates, 502 buildings, missing env vars).
5. Fix import-time secret validation:
   - Make `cloud_storage_secrets` lazy or give the fields safe optional defaults.
   - Only require credentials when an upload is actually attempted.
   - Add a clear error message when credentials are missing.
6. Ensure `src/config/settings.py` can be imported with no `.env`.
7. Add `requirements-dev.txt` with `pytest`, `ruff` (optional), and any test-only
   packages. Do not pollute runtime requirements.
8. Update the existing `.env.template` so it documents every required key;
   add `.env.example` only if the project standardizes on that name.

Acceptance:

- `python -c "import sys; sys.path.insert(0, 'src'); import config"` succeeds
  without `.env`.
- README and docs exist and accurately describe the current pipeline.
- No secrets are tracked.

### Phase 2 — Idempotent and incremental database writes

Problem: `bulk_save_objects()` inserts blindly, and `pk_sets` are process-local.
Reruns either duplicate or fail on primary-key conflicts.

Tasks:

1. Add an upsert path in `AgencyProcessor`:
   - Use `sqlalchemy.dialects.sqlite.insert(...).on_conflict_do_update(...)` or
     an equivalent SQLite upsert.
   - Derive conflict keys from the existing `pk_map`.
   - Update non-key columns on conflict.
   - Chunk inserts to avoid parameter limits (e.g., 500 rows per statement).
2. Keep or remove `pk_sets` only after verifying correctness:
   - If kept, seed them from the DB at processor init so they reflect existing rows.
   - If removed, ensure upsert handles duplicates within the same batch.
3. Do not change the existing table definitions or primary keys.
4. Add a `pipeline_runs` table (new table only) with:
   - `run_id` (text primary key)
   - `started_at`, `finished_at`
   - `mode` (debug/full)
   - `status` (running/success/failed)
   - `record_counts_json`
   - `error_message`
   This is optional if it takes more than a small amount of work; the upsert is
   the mandatory part.
5. Add a small `run_id` (UUID or timestamp) generated in the orchestrator and
   logged at the start/end of each run.
6. Ensure `close_session()` is called once at the end of a pipeline, not inside a
   per-partition loop, unless there is a verified reason. If changing this, test
   a multi-partition flow with fixtures.
7. Add tests:
   - Create a temporary SQLite DB with one table.
   - Apply the same batch twice.
   - Assert row count is unchanged and non-key columns are updated.
   - Cover a composite primary key (e.g., `estate_mtr_lines`).
8. Add a test that the `pk_map` keys exist in the SQLAlchemy models.

Acceptance:

- Upsert is used by both estates and buildings processors.
- The rerun test passes.
- No existing DB file is modified during tests.

### Phase 3 — Data quality checks

Tasks:

1. Add `src/quality/checks.py` (or `src/processors/quality.py`).
2. Implement checks against the SQLite DB:
   - Critical:
     - required tables are non-empty,
     - no duplicate primary keys,
     - foreign-key orphans for estate/building/unit/transaction relationships,
     - negative prices, non-positive areas where present,
     - transaction dates outside a sane range.
   - Warning:
     - estate coverage below configured thresholds,
     - estates with no buildings/transactions,
     - missing market data for estates with transactions,
     - large date gaps,
     - null rates above thresholds for required fields.
3. Output:
   - `data/quality/latest.json`
   - `data/quality/{run_id}.json`
   - A human-readable summary in the log and, optionally, `latest.md`.
4. Add a CLI or function:
   - `python -m quality.run --db data/agency/agency_data.db --fail-on critical`
   - Exit non-zero on critical failures.
5. Add tests with synthetic SQLite data: one clean DB and one DB with each
   critical failure.
6. Wire the check into `src/main.py` after the data pipeline and before the
   serving publish. Make it optional via a flag if needed.

Acceptance:

- Running the checks against the existing DB produces a report.
- Critical failures return a non-zero exit code.
- Tests cover at least duplicate PKs, FK orphans, and a clean pass.

### Phase 4 — Tests and CI

Tasks:

1. Add `tests/` with:
   - `test_response_models.py`: parse the JSON fixtures in `docs/api_responses/`
     into the Pydantic response models.
   - `test_table_mapping.py`: map zh/en responses to table dicts; assert keys and
     selected values for estate, buildings, phases, school nets, MTR lines,
     facilities, market info.
   - `test_dedupe.py`: duplicate inputs produce one output.
   - `test_upsert.py`: from Phase 2.
   - `test_quality.py`: from Phase 3.
   - `test_serving.py`: manifest and file layout (from Phase 6).
2. Test the transformation layer with fixtures only. Do not hit the network.
3. Ensure tests do not import modules that require cloud credentials at import
   time. If they do, fix the module rather than patching env vars everywhere.
4. Add `.github/workflows/ci.yml` (or fill the empty `ci-cd.yml`) that:
   - checks out the repo,
   - sets up Python 3.12,
   - installs `requirements.txt` and `requirements-dev.txt`,
   - runs `pytest -q`,
   - optionally runs `ruff check`.
   Do not require secrets.
5. Add a `pytest.ini` or `[tool.pytest.ini_options]` with `testpaths` and
   `pythonpath = src`.
6. Add a minimal `Makefile` or `scripts/check.sh`:
   - `make test`
   - `make quality`
   - `make publish-dry`
   This is optional but improves the runbook.

Acceptance:

- `pytest -q` passes locally with no `.env`.
- CI is green on the branch.
- No network calls in tests.

### Phase 5 — Analytics marts

Tasks:

1. Add `src/analytics/` with SQL files and a builder module.
2. Create these marts as tables or views (materialize for serving):
   - `mart_estate_summary` — one row per estate:
     - estate_id, names, region/subregion/district, lat/lon, first/last op date
     - latest transaction date and price
     - 12-month transaction count, avg net ft price, avg net ft rent
     - latest market month
     - coverage flags (has_market, has_transactions, has_wiki)
   - `mart_district_monthly` — district × month:
     - avg net ft price, avg net ft rent, transaction count, rent transaction
       count, total transaction amount
   - `mart_estate_monthly` — estate × month:
     - avg net ft price, avg net ft rent, transaction count
     - Limit to a documented window if the table is too large (e.g., last 10
       years), or keep all rows for Parquet export.
   - `mart_transaction_recent` — recent transactions (e.g., last 24 months):
     - tx_id, tx_date, price, net_ft_price, estate_id, building_id, unit_id,
       area, net_area, bedroom
   - `mart_coverage` — one row per estate:
     - has_estate_info, has_market, has_transactions, last_tx_date,
       building_count, unit_count, tx_count
3. Normalize dates to calendar dates. The existing DB stores some timestamps as
   `YYYY-MM-DD 16:00:00`; use `date(tx_date)` / `date(record_date)` in SQL and
   document the timezone assumption.
4. Add indexes for the dashboard's common filters:
   - `transactions(tx_date)`, `transactions(unit_id)`
   - `estate_monthly_market_info(estate_id, record_date)`
   - `units(building_id)`
   - `buildings(estate_id)`
5. Add `src/analytics/sql/*.sql` and a builder that executes them in order.
6. Add tests with a small synthetic DB: assert row counts and a few known values.
7. Document each mart's grain, columns, and caveats in `docs/data-dictionary.md`.

Acceptance:

- Running the mart builder against the existing DB produces all five marts.
- Each mart has a documented grain and non-zero rows.
- Tests pass on synthetic data.

### Phase 6 — Serving layer and publish

Tasks:

1. Add `src/serving/` (or `scripts/publish_dashboard.py`) that exports a small
   dashboard snapshot:
   - `data/serving/{build_id}/manifest.json`
   - `overview.json`
   - `district_monthly.json`
   - `estate_summary.json`
   - `coverage.json`
   - Optional, only if needed: `estate_monthly.parquet`,
     `transactions_recent.parquet`
2. Keep the snapshot small. Target:
   - JSON files under ~5 MB total uncompressed where possible.
   - Use Parquet for large tables; JSON for small aggregates.
   - Do not export raw 1M-row tables unless there is a documented reason.
3. `manifest.json` must include:
   - `schema_version`
   - `build_id` (timestamp or content hash)
   - `generated_at`
   - `data_through` (latest transaction/market date)
   - `coverage` (estates, with transactions, with market, with wiki)
   - `row_counts` for each mart
   - `files` mapping logical name → relative path
   - `source` (e.g., `HKP`, `Wikipedia`)
4. Add a publish command:
   - `python scripts/publish_dashboard.py --dry-run` writes local files only.
   - Without `--dry-run`, upload to R2 under `dashboard/{build_id}/...` and
     update `dashboard/manifest.json`.
   - Use boto3. Reuse the existing cloud storage config.
5. Fix the existing cloud upload issues:
   - Require `cloudflare_account_id` when service type is Cloudflare.
   - Validate the bucket name before upload.
   - Skip `.DS_Store` and hidden files.
   - Set `ContentType` and `CacheControl`:
     - manifest: `public, max-age=60`
     - versioned data files: `public, max-age=31536000, immutable`
   - Add a `--dry-run` and a clear error if credentials are missing.
6. Add a `scripts/verify_serving.py` that loads the manifest and checks that
   every referenced file exists and is non-empty.
7. Add tests for manifest generation and file layout. Do not require network.

Acceptance:

- `--dry-run` produces a complete local snapshot.
- `verify_serving.py` passes.
- With valid credentials, a real upload succeeds and the manifest is readable.
- No credentials are logged.

### Phase 7 — Optional: demo/sample data

Tasks:

1. Add `scripts/make_sample_db.py` that creates a small SQLite database (e.g.,
   100 estates, their buildings/units/transactions) from the existing DB.
2. Add a `data/sample/` path to `.gitignore` or commit only a tiny fixture if
   licensing permits. Prefer a download/generation script over committing data.
3. Document how to run the pipeline and dashboard against the sample.
4. Add a `--debug` or `--sample` mode if it reduces friction.

Acceptance:

- A reviewer can run the dashboard from the sample without a full crawl.
- No large data file is committed.

### Phase 8 — Final handoff

Tasks:

1. Update `README.md` with:
   - final architecture and data flow,
   - table counts and coverage,
   - quickstart,
   - serving layer contract,
   - known limitations,
   - link to the dashboard (once live).
2. Add `docs/decisions.md` with short ADR-style notes:
   - SQLite for local/portfolio vs. Postgres for production.
   - In-memory cache + upsert vs. staging tables.
   - Precomputed marts vs. live queries.
   - R2 serving layer vs. a live API.
3. Add `docs/roadmap.md`:
   - incremental crawls,
   - RVD integration,
   - better Wikipedia coverage,
   - text-to-SQL (only if pursued),
   - monitoring/alerts.
4. Run all checks and record the results in `docs/baseline-stats.md`.
5. Open a PR from the Phase 8 branch → `dev`. After human review, a human may
   merge `dev` → `main` or open a second PR. Agents never merge `main` or
   force-push `main`.

Acceptance:

- All checks pass.
- The docs accurately describe the code.
- A reviewer can follow the README from clone to dashboard snapshot.

## 6. Suggested commit/PR sequence

1. `docs: add architecture, data dictionary, runbook, baseline stats`
2. `fix: make cloud secrets lazy and imports credential-free`
3. `feat: idempotent upserts for agency writes`
4. `feat: data quality checks and reports`
5. `test: add fixture-based tests and CI`
6. `feat: analytics marts for dashboard`
7. `feat: serving snapshot and R2 publish`
8. `docs: finalize README, decisions, roadmap`

Keep each change reviewable. If a phase grows beyond ~300 lines of production
code, split it.

## 7. What not to do

- Do not rewrite the crawlers or change their request behaviour.
- Do not refetch all 9,748 estates or 29,911 buildings.
- Do not add a web API for the dashboard in this workplan.
- Do not add Kafka, Spark, Airflow, or a full dbt project unless explicitly
  requested later.
- Do not commit the SQLite DB, ChromaDB, logs, or `.env`.
- Do not silently change table names, column names, or primary keys.
- Do not fake quality results or metrics.

## 8. Dashboard serving contract (for the separate frontend work)

The Datahub workplan ends at producing and publishing the serving snapshot. The
frontend can then fetch:

```text
https://<r2-public-host>/dashboard/manifest.json
https://<r2-public-host>/dashboard/{build_id}/overview.json
https://<r2-public-host>/dashboard/{build_id}/district_monthly.json
https://<r2-public-host>/dashboard/{build_id}/estate_summary.json
https://<r2-public-host>/dashboard/{build_id}/coverage.json
```

Rules:

- The frontend fetches `manifest.json` first, then the files referenced by it.
- Manifest is short-cache; data files are immutable and long-cache.
- CORS on the R2 bucket must allow the static site origin.
- The frontend should bundle a fallback snapshot or show a clear error if the
  fetch fails.
- Never expose write credentials in the frontend.
- Do not query the raw SQLite database from the browser.

## 9. First action for the agent

Start with Phase 0. Report:

- current branch and `git status`,
- table counts and date ranges,
- the uncommitted `src/main.py` change,
- any blockers (missing credentials, failing imports).

Then proceed to Phase 1 only after the baseline is recorded.
