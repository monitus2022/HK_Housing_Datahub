# Baseline Statistics — 2026-11-09

Reference snapshot for the tidy-up workplan. All database queries were
read-only against `data/agency/agency_data.db`. No data or secrets were
modified.

> **Refresh note (2026-11-10):** the reference DB was replaced with a fully
> recrawled copy after this baseline was recorded. Numbers below are the
> recorded Phase 0–8 baseline unless a section says otherwise; current counts
> and dates are in [`serving.md`](serving.md) and [`../README.md`](../README.md).

> **Snapshot note:** this file records the Phase 0 state. Phases 1–6
> subsequently made cloud-storage secrets lazy, added `.dockerignore`,
> reconciled the schema diagram, added idempotent agency upserts, added the
> `pipeline_runs` table, added read-only quality checks and reports, added
> fixture tests, lazy orchestrator imports, a core/RAG/cloud requirements
> split, and CI, added the five analytics marts and dashboard indexes, and
> added the versioned serving snapshot and publisher. See the README for
> current behavior; the numbers below remain the historical baseline snapshot.

- Repository: `monitus2022/HK_Housing_Datahub`
- Base branch: `dev` @ `92bc704`. `origin/main` contains `dev` plus the merge
  commits through PR #12: `origin/main` is 3 commits ahead of `dev`, and
  `origin/main..dev` is empty. The local `main` ref was stale (33 commits behind
  `origin/main`); compare against `origin/main` after `git fetch`.
- Working tree at snapshot time: `src/main.py` modified; both workplans
  untracked
- Database: `data/agency/agency_data.db` (~320 MB)
- Python: 3.12 (see `Dockerfile`)

## Table counts

| Table | Rows |
|---|---:|
| regions | 3 |
| subregions | 20 |
| districts | 60 |
| estates | 9,748 |
| estate_school_nets | 9,219 |
| estate_facilities | 4,257 |
| estate_mtr_lines | 798 |
| estate_monthly_market_info | 476,986 |
| facilities | 9 |
| phases | 516 |
| buildings | 29,911 |
| units | 1,229,204 |
| unit_features | 563,346 |
| transactions | 1,071,268 |

## Date ranges

| Table | Column | Min | Max |
|---|---|---|---|
| transactions | tx_date | 1996-01-01 16:00:00 | 2025-10-21 16:00:00 |
| estate_monthly_market_info | record_date | 1996-12-31 16:00:00 | 2025-08-31 16:00:00 |

The `16:00:00` component is a timezone artifact. Normalize with `date(...)` in
analytics SQL and document the assumption.

## Estate coverage

Total estates: **9,748**.

| Coverage | Estates | Share |
|---|---:|---:|
| Has buildings | 9,748 | 100.0% |
| Has transactions | 6,638 | 68.1% |
| Has monthly market data | 5,292 | 54.3% |
| Has school net data | 9,219 | 94.6% |
| Has MTR line data | 798 | 8.2% |
| Has facility data | 1,089 | 11.2% |
| Has `first_op_date` | 8,856 | 90.8% |
| Has coordinates | 9,116 | 93.5% |

## Unit and transaction coverage

| Metric | Value |
|---|---:|
| Units | 1,229,204 |
| Units with `net_area > 0` | 927,065 (75.4%) |
| Units with `bedroom` present | 637,891 (51.9%) |
| Units with feature rows | 338,394 (27.5%) |
| Units with more than one transaction | 351,373 |
| Transactions | 1,071,268 |
| Transactions with `price > 0` and `net_area > 0` | 1,056,973 (98.7%) |
| Distinct units with transactions | 719,895 |
| Transactions in 2024 or later | 69,302 |
| Transactions in 2025 | 33,140 |

Price per net sq ft for rows with `price > 0` and `net_area > 0`:
median ~8,020; p1 ~1,868; p99 ~30,597; max ~1,890,482.

## Wiki and Chroma

- Wiki partitions: 9 files under `data/wiki/` (~2.6 MB)
- Wiki estates: 822
- Chroma embeddings: 3,780 in `data/chroma_db/` (~44 MB)
- Partition sizes: 381, 115, 66, 60, 26, 4, 79, 88, 3

## Current entrypoint state

`src/main.py` currently:

- runs the RAG embedding pipeline;
- has the agency and wiki pipelines commented out;
- has the cloud upload commented out.

This was an uncommitted local choice and is preserved intentionally in the
Phase 0 commit. RAG reruns are idempotent: chunks are written with Chroma
`upsert()` and IDs that are no longer in the wiki source are pruned after a
complete run. Chunk IDs are a SHA-1 of estate name, section title, and chunk
index, so edited text refreshes in place. Pruning is skipped when any input
file fails to load or when a run produces no chunks (issue #17).

## Known gaps confirmed at snapshot time

- ~~No `tests/` directory.~~ Fixed in Phase 2: `tests/test_upsert.py` covers
  upserts, composite keys, `pk_map` consistency, and run metadata.
- ~~`.github/workflows/ci-cd.yml` is empty (CI is Phase 4).~~ Fixed in Phase 4:
  the workflow installs core + dev deps, verifies config import, compiles, runs
  pytest, and lints the touched modules.
- ~~`bulk_insert_cache_into_db_tables()` uses `bulk_save_objects()` with no
  upsert.~~ Fixed in Phase 2: writes use SQLite upserts keyed on the model
  primary key.
- ~~Deduplication uses process-local `pk_sets` only.~~ Fixed in Phase 2:
  `pk_sets` were removed; duplicate keys are absorbed by the upsert.
- ~~`src/config/settings.py` instantiates `CloudStorageSecrets()` at import time,
  so importing the config requires cloud credentials.~~ Fixed in Phase 1:
  credential fields are optional and validated only on upload.
- ~~The old cloud uploader walks all of `data/`, including the SQLite DB and
  Chroma store.~~ Fixed in Phase 6: raw upload is gated behind
  `allow_raw_upload=True` and hidden files/directories are skipped.
- ~~No `.dockerignore`; the Dockerfile uses `COPY . .`.~~ Fixed in Phase 1.

## Reproduce

The committed script prints every database metric in this document:

```bash
python3 scripts/baseline_stats.py
```

It opens the agency database with SQLite's `mode=ro` URI and the Chroma
database read-only, so it cannot modify either one. Pass `--db PATH` to point
at a different copy of the agency database; the wiki and Chroma paths are
resolved from the current working directory, so run it from the repo root.

## Final handoff and post-release checks — 2026-11-11

- **Tests:** `pytest -q` → 93 passed, including 9 offline RAG idempotency tests
  against a temporary Chroma store (issue #17). A core-only venv without
  `chromadb` skips the RAG test module and the boto3 legacy-upload test.
- **Lint:** `ruff check src/main.py src/logger.py src/analytics src/quality src/serving
  src/processors/agency src/processors/rag src/models/agency/sql_db.py
  src/models/agency/outputs.py src/orchestrators scripts tests` → all checks
  passed.
- **CI:** green on the Phase 6 PR (#30); the Phase 8 PR runs the same workflow.
- **Merged phase PRs:** #24 (Phase 0), #25 (Phase 1), #26 (Phase 2), #27
  (Phase 3), #28 (Phase 4), #29 (Phase 5), #30 (Phase 6).
- **Marts on the reference DB (pre-refresh):** estate summary 9,748;
  district monthly 19,352; estate monthly 591,904; recent transactions
  72,900; coverage 9,748.
- **Quality (pre-refresh):** status `fail`; 1 critical (160
  `buildings.phase_id -> phases.phase_id` orphans) and 3 warnings
  (non-positive areas, estate coverage, transaction estates without market
  data). The mapper no longer writes pseudo-phase ids, and
  `scripts/repair_orphan_phase_ids.py --apply` clears the existing rows; on a
  DB copy the repair leaves status `warn` with 0 critical. The local entrypoint
  runs quality in report-only mode.
- **Serving:** build `20261111T194346Z-f4ee06` (`schema_version` 4), ~4.6 MB;
  verifier passed; all eight files uploaded to the `hk-housing-datahub` bucket
  and the remote manifest read back successfully. Gzip `Content-Encoding`,
  cache, and CORS headers verified. It carries refreshed data (transactions
  through 2026-11-08, rentals through 2026-11-10, market through 2026-09-30,
  9,750 estates),
  `transaction_recent.json.gz` (~2.1 MB gzipped for 87,393 rows), and
  `estate_monthly.json.gz` (~1.3 MB). Earlier builds remain in the bucket.
- **Frontend:** `frontend/` Vite + React + TypeScript, deployed at
  <https://hk-housing.monitus.org>; snapshot host
  <https://hk-housing-datahub.monitus.org>. R2 public read and CORS for the
  frontend origin are verified. `npm run typecheck`, `npm test` (76 tests), and
  `npm run build` pass; `npm audit` reports zero vulnerabilities. Production
  smoke test on the refreshed snapshot verified 9,750 estates, the district
  sale and volume trend chart (latest Nov 2026), the 9,117-marker map, and
  87,393 recent transactions with pagination, with zero console errors.
  Cloudflare Pages/R2 setup is in [`deployment.md`](deployment.md).
- **Branch state:** `main` contains `dev` through release PR #66; no PRs are
  open.
- **Not committed:** `data/`, databases, `.env`, logs, venv, and secrets.
- **Remaining backlog:** optional Phase 7 sample DB; optional Parquet export
  for external analytics; incremental crawls, RVD, and monitoring (see
  [`roadmap.md`](roadmap.md)). The phase-id repair remains available for older
  databases; the refreshed DB reports 0 orphans.
